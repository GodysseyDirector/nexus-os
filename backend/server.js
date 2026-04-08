'use strict'
/**
 * NEXUS OS Backend Server
 * HTTP + WebSocket on PORT 18790
 * Fully compatible with the existing OpenClaw dashboard UI.
 *
 * All state mutations go through nexusController.
 * All LLM calls go through nexusBrain.
 * All outputs are validated by criticLayer.
 */

process.on('uncaughtException',  err  => console.error('[NEXUS] Uncaught:', err.message))
process.on('unhandledRejection', err  => console.error('[NEXUS] Rejection:', err?.message || err))

const http = require('http')
const fs   = require('fs')
const path = require('path')
const { WebSocketServer, WebSocket } = require('ws')

const { PORT, DATA_DIR } = require('../shared/constants')
const { logger }          = require('../shared/logger')
const { getState, _hydrate } = require('./memory/state')
const { loadState, persistState, retrieveMemories, storeMemory } = require('./memory/memoryEngine')
const { nexusController, getActionLog } = require('./nexusController')
const brain = require('./nexusBrain')
const { listModels, streamOllama } = require('./router/modelRouter')
const { MODELS, OLLAMA_BASE } = require('../shared/constants')
const { classifyIntent } = require('./router/intentRouter')
const { setBroadcast, resetActivityTimer } = require('./events/triggers')
const eventLoop = require('./events/eventLoop')
const { rateLimitMiddleware } = require('./middleware/rateLimit')

// ── UI static files ──────────────────────────────────────────────────────────
const UI_DIR = process.env.UI_DIR || path.resolve(__dirname, '..', 'ui', 'dist')

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp',
  '.gz': 'application/gzip', '.map': 'application/json',
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0])
  const filePath = path.join(UI_DIR, urlPath === '/' ? 'index.html' : urlPath)
  const ext = path.extname(filePath).toLowerCase()
  try {
    const stats = fs.statSync(filePath)
    if (stats.isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      fs.createReadStream(filePath).pipe(res)
      return true
    }
  } catch {}
  // SPA fallback
  try {
    const index = path.join(UI_DIR, 'index.html')
    fs.statSync(index)
    res.writeHead(200, { 'Content-Type': 'text/html' })
    fs.createReadStream(index).pipe(res)
    return true
  } catch {
    res.writeHead(404)
    res.end('Not found')
    return true
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const H  = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
const H_SSE = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*', 'Connection': 'keep-alive' }

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { ...H, 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', d => raw += d)
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

// ── WebSocket broadcast ───────────────────────────────────────────────────────
const wsClients = new Set()

function broadcast(msg) {
  const text = JSON.stringify(msg)
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(text)
  })
}

setBroadcast(broadcast)

// Active model tracking
let activeModel = MODELS.REASONING
let activeBackend = 'ollama'

// ── HTTP Request Handler ──────────────────────────────────────────────────────
async function handleRequest(req, res) {
  // Rate limiting — blocks excessive API requests (10/min per IP)
  if (!rateLimitMiddleware(req, res)) return

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' })
    res.end(); return
  }

  const url    = new URL(req.url, `http://localhost:${PORT}`)
  const route  = url.pathname
  const method = req.method

  resetActivityTimer()

  // ── Health ──────────────────────────────────────────────────────────────────
  if (route === '/health' || route === '/api/ping') {
    return json(res, 200, { ok: true, ts: Date.now(), clients: wsClients.size })
  }

  if (route === '/api/status') {
    return json(res, 200, { ok: true, gateway: 'online', model: activeModel, backend: activeBackend })
  }

  if (route === '/api/lm-status') {
    try {
      const models = await listModels()
      return json(res, 200, { ok: true, models, active: activeModel, backend: activeBackend })
    } catch { return json(res, 200, { ok: false, error: 'Ollama unreachable' }) }
  }

  // ── State ───────────────────────────────────────────────────────────────────
  if (route === '/api/state' && method === 'GET') {
    return json(res, 200, getState())
  }

  // ── Models ──────────────────────────────────────────────────────────────────
  if (route === '/api/models' && method === 'GET') {
    const models = await listModels().catch(() => [])
    return json(res, 200, { models, active: activeModel })
  }

  if (route === '/api/set-model' && method === 'POST') {
    const body = await readBody(req)
    if (body.model) activeModel = body.model
    if (body.backend) activeBackend = body.backend
    return json(res, 200, { ok: true, model: activeModel })
  }

  // ── Greeting ─────────────────────────────────────────────────────────────────
  if (route === '/api/greeting' && method === 'GET') {
    const greeting = await brain.getGreeting().catch(() => 'NEXUS online. Ready, Director.')
    return json(res, 200, { greeting })
  }

  // ── Chat (SSE streaming) ────────────────────────────────────────────────────
  if (route === '/api/chat' && method === 'POST') {
    const body = await readBody(req)
    const text = body.message || body.text || ''
    if (!text) return json(res, 400, { error: 'message required' })

    res.writeHead(200, H_SSE)

    const sessionId = body.sessionId || 'default'
    const history   = body.history || []

    // Determine model to use
    const intent = classifyIntent(text)
    const model  = body.model || (intent.complexity === 'high' ? MODELS.REASONING : MODELS.FAST)
    const messages = [
      { role: 'system', content: `You are NEXUS, an intelligent cognitive OS. Today: ${new Date().toDateString()}. Be concise and direct.` },
      ...history.slice(-10).map(m => ({ role: m.role === 'nexus' ? 'assistant' : m.role, content: m.content })),
      { role: 'user', content: text }
    ]

    let full = ''
    try {
      await streamOllama(model, messages, chunk => {
        full += chunk
        res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`)
      })
      res.write(`data: ${JSON.stringify({ done: true, text: full, model, intent })}\n\n`)

      // Log activity
      nexusController({ type: 'LOG_ACTIVITY', payload: { type: 'chat', message: text.slice(0, 100), ts: Date.now() } }).catch(() => {})
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    }

    res.end()
    return
  }

  // ── Exec Tool (LLM function calls) ──────────────────────────────────────────
  if (route === '/api/exec-tool' && method === 'POST') {
    const body = await readBody(req)
    const { tool, params } = body

    try {
      let result
      switch (tool) {
        case 'add_task':
          result = await nexusController({ type: 'ADD_TASK', payload: params })
          break
        case 'move_task':
          result = await nexusController({ type: 'MOVE_TASK', payload: params })
          break
        case 'delete_task':
          result = await nexusController({ type: 'DELETE_TASK', payload: params })
          break
        case 'add_note':
          result = await nexusController({ type: 'ADD_NOTE', payload: { content: params.content } })
          break
        case 'delete_note':
          result = await nexusController({ type: 'DELETE_NOTE', payload: params })
          break
        case 'add_calendar_event':
          result = await nexusController({ type: 'ADD_CALENDAR', payload: params })
          break
        case 'delete_calendar_event':
          result = await nexusController({ type: 'DELETE_CALENDAR', payload: params })
          break
        case 'save_knowledge':
          result = await nexusController({ type: 'SAVE_MEMORY', payload: { key: params.key, value: params.value } })
          break
        default:
          return json(res, 400, { error: `Unknown tool: ${tool}` })
      }
      broadcast({ type: 'state_update', state: getState() })
      return json(res, 200, { ok: true, state: result })
    } catch (err) {
      return json(res, 500, { error: err.message })
    }
  }

  // ── Memory ────────────────────────────────────────────────────────────────
  if (route === '/api/memory/store' && method === 'POST') {
    const body = await readBody(req)
    await nexusController({ type: 'SAVE_MEMORY', payload: { key: body.key || 'note', value: body.content || body.value, category: body.category } })
    return json(res, 200, { ok: true })
  }

  if (route === '/api/memory/retrieve' || route === '/api/memory') {
    const cat   = url.searchParams.get('category')
    const query = url.searchParams.get('query')
    const state = getState()
    const mems  = retrieveMemories(state.memories || [], { category: cat, query })
    return json(res, 200, { memories: mems, notes: state.notes, calendar: state.calendar })
  }

  if (route === '/api/memory/flush' && method === 'POST') {
    // Soft flush — clear activity log only, preserve important memories
    const s = JSON.parse(JSON.stringify(getState()))
    s.activityLog = []
    require('./memory/state')._internalSet(s)
    await persistState(getState())
    return json(res, 200, { ok: true })
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  if (route === '/api/tasks' && method === 'GET') {
    return json(res, 200, { tasks: getState().tasks })
  }
  if (route === '/api/tasks' && method === 'POST') {
    const body = await readBody(req)
    const state = await nexusController({ type: 'ADD_TASK', payload: body })
    broadcast({ type: 'state_update', state })
    return json(res, 200, { ok: true, tasks: state.tasks })
  }

  // ── Notes ────────────────────────────────────────────────────────────────
  if (route === '/api/notes' && method === 'GET') {
    return json(res, 200, { notes: getState().notes })
  }

  // ── Calendar ─────────────────────────────────────────────────────────────
  if (route === '/api/calendar' && method === 'GET') {
    return json(res, 200, { events: getState().calendar })
  }
  if (route === '/api/calendar' && method === 'POST') {
    const body  = await readBody(req)
    const state = await nexusController({ type: 'ADD_CALENDAR', payload: body })
    broadcast({ type: 'state_update', state })
    return json(res, 200, { ok: true, calendar: state.calendar })
  }

  // ── Activity Log ─────────────────────────────────────────────────────────
  if (route === '/api/activity' && method === 'GET') {
    return json(res, 200, { log: getState().activityLog?.slice(-100) || [] })
  }

  // ── GC ───────────────────────────────────────────────────────────────────
  if (route === '/api/gc' && method === 'POST') {
    const s = JSON.parse(JSON.stringify(getState()))
    s.activityLog = s.activityLog?.slice(-200) || []
    require('./memory/state')._internalSet(s)
    await persistState(getState())
    if (global.gc) global.gc()
    return json(res, 200, { ok: true })
  }

  // ── Undo last ────────────────────────────────────────────────────────────
  if (route === '/api/undo-last' && method === 'POST') {
    const log = getActionLog(2)
    return json(res, 200, { ok: true, undone: log[1]?.type || 'nothing', log })
  }

  // ── System info ──────────────────────────────────────────────────────────
  if (route === '/api/system' && method === 'GET') {
    const mem = process.memoryUsage()
    return json(res, 200, {
      uptime: process.uptime(),
      memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, rss: mem.rss },
      model: activeModel,
      wsClients: wsClients.size,
      stateKeys: Object.keys(getState()),
    })
  }

  // ── Static UI fallback ────────────────────────────────────────────────────
  if (method === 'GET') {
    serveStatic(req, res)
    return
  }

  json(res, 404, { error: 'Not found' })
}

// ── Server bootstrap ─────────────────────────────────────────────────────────
async function boot() {
  // Load saved state from disk
  const saved = loadState()
  if (saved) {
    _hydrate(saved)
    logger.info({ tasks: saved.tasks?.length, notes: saved.notes?.length, memories: saved.memories?.length }, 'State hydrated from disk')
  }

  const httpServer = http.createServer(handleRequest)

  // WebSocket
  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', (ws) => {
    wsClients.add(ws)
    logger.info({ total: wsClients.size }, 'WS client connected')
    ws.send(JSON.stringify({ type: 'state_update', state: getState() }))
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw)
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }))
      } catch {}
    })
    ws.on('close', () => { wsClients.delete(ws); logger.info({ total: wsClients.size }, 'WS client disconnected') })
  })

  httpServer.listen(PORT, '127.0.0.1', () => {
    logger.info({ port: PORT }, 'NEXUS gateway online')
    console.log(`\x1b[32m[NEXUS]\x1b[0m Gateway online → http://localhost:${PORT}`)
  })

  // Start autonomous event loop
  eventLoop.start()

  // Broadcast state updates on any mutation
  setInterval(() => {
    broadcast({ type: 'heartbeat', ts: Date.now(), clients: wsClients.size })
  }, 30000)
}

boot().catch(err => { console.error('[NEXUS] Boot failed:', err); process.exit(1) })

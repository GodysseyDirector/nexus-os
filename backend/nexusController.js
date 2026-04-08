'use strict'
/**
 * NEXUS Controller — the ONLY gateway for state mutations.
 *
 * Flow: validate → critic → apply mutation → persist → log → fire brain
 *
 * RULE: Nothing mutates state directly. Everything goes through here.
 */
const { getState, _internalSet } = require('./memory/state')
const { persistState, storeMemory } = require('./memory/memoryEngine')
const { insertLog, insertTask }     = require('./memory/sqlite')
const { calculatePriority }         = require('./priorityEngine')
const { validate, validatePayload } = require('../shared/schemaValidator')
const { criticCheck } = require('./router/criticLayer')
const { logger } = require('../shared/logger')
const brain = require('./nexusBrain')

// Action log (in-memory, last 500)
const actionLog = []

/**
 * Apply an action through the full pipeline.
 * @param {{ type: string, payload: any }} action
 * @returns {Promise<object>} Updated state snapshot
 */
async function nexusController(action, opts = {}) {
  // 0. Fast guard — catches null/undefined/non-object before anything else
  if (!action || typeof action !== 'object') {
    throw new Error('[Controller] Invalid action: must be an object')
  }
  if (!action.type || typeof action.type !== 'string' || !action.type.trim()) {
    throw new Error('[Controller] Invalid action: missing or empty type')
  }

  // 1. Schema validation
  const schemaCheck = validate(action)
  if (!schemaCheck.ok) throw new Error(`[Schema] ${schemaCheck.error}`)

  // 2. Payload validation
  if (action.payload) {
    const payloadCheck = validatePayload(action.type, action.payload)
    if (!payloadCheck.ok) throw new Error(`[Payload] ${payloadCheck.error}`)
  }

  // 3. Critic check
  const criticResult = criticCheck(action)
  if (!criticResult.ok) throw new Error(`[Critic] ${criticResult.error}`)

  // 4. Apply mutation
  const current = getState()
  const updated  = applyMutation(current, action)
  _internalSet(updated)

  // 5. Log action — in-memory + SQLite (durable)
  const logEntry = { type: action.type, ts: Date.now(), payload: action.payload }
  actionLog.push(logEntry)
  if (actionLog.length > 500) actionLog.shift()
  logger.info({ type: action.type }, 'State mutation applied')
  insertLog(action.type, action.payload, 'nexusController')

  // 5b. For ADD_TASK, also write to SQLite tasks table with priority score
  if (action.type === 'ADD_TASK' && action.payload) {
    const p = action.payload
    const taskForPriority = { urgency: 1, importance: 1, createdAt: Date.now() }
    insertTask({
      content:    p.title || p.content || 'Untitled',
      title:      p.title,
      category:   p.tag || p.category || 'general',
      priority:   Math.round(calculatePriority(taskForPriority)),
      source:     'nexusController',
    })
  }

  // 6. Persist to disk (async, non-blocking)
  persistState(getState()).catch(err => logger.error({ err: err.message }, 'Persist failed'))

  // 7. Fire brain loop (async, non-blocking)
  brain.fire({ type: action.type, payload: action }).catch(err =>
    logger.warn({ err: err.message }, 'Brain loop error (non-fatal)')
  )

  return getState()
}

/**
 * Pure state mutation — no side effects, no I/O.
 */
function applyMutation(state, action) {
  const s = JSON.parse(JSON.stringify(state)) // deep clone
  const p = action.payload
  const now = new Date().toISOString()
  const id = () => Date.now() + Math.random().toString(36).slice(2, 6)

  switch (action.type) {
    // ── Tasks ───────────────────────────────────────────────────────────────
    case 'ADD_TASK':
      s.tasks.push({ id: id(), title: p.title, priority: p.priority || 'medium',
                     column: 'todo', tag: p.tag || 'general', createdAt: now })
      break
    case 'UPDATE_TASK':
      s.tasks = s.tasks.map(t => t.id === p.id ? { ...t, ...p } : t)
      break
    case 'DELETE_TASK':
      s.tasks = s.tasks.filter(t => t.id !== p.id &&
        !(p.title_hint && t.title.toLowerCase().includes(p.title_hint.toLowerCase())))
      break
    case 'MOVE_TASK':
      s.tasks = s.tasks.map(t =>
        t.title.toLowerCase().includes((p.title_hint || '').toLowerCase())
          ? { ...t, column: p.to_column } : t)
      break

    // ── Notes ───────────────────────────────────────────────────────────────
    case 'ADD_NOTE':
      s.notes.push({ id: id(), text: p.content, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                     date: new Date().toLocaleDateString(), createdAt: now })
      break
    case 'DELETE_NOTE':
      s.notes = s.notes.filter(n =>
        !(p.content_hint && n.text.toLowerCase().includes(p.content_hint.toLowerCase())))
      break

    // ── Calendar ────────────────────────────────────────────────────────────
    case 'ADD_CALENDAR':
      s.calendar.push({ id: id(), title: p.title, isoDate: p.isoDate,
                        time: p.time || '', type: p.type || 'meeting', notes: p.notes || '', createdAt: now })
      break
    case 'DELETE_CALENDAR':
      s.calendar = s.calendar.filter(e =>
        !(p.title_hint && e.title.toLowerCase().includes(p.title_hint.toLowerCase())))
      break

    // ── Goals ───────────────────────────────────────────────────────────────
    case 'ADD_GOAL':
      s.goals.push({ id: id(), text: p.text, createdAt: now })
      break
    case 'DELETE_GOAL':
      s.goals = s.goals.filter(g => g.id !== p.id)
      break

    // ── Memory ──────────────────────────────────────────────────────────────
    case 'SAVE_MEMORY':
      s.memories = storeMemory(s.memories, { key: p.key, content: p.value,
                                              category: p.category || 'general', source: 'nexus' })
      break
    case 'DELETE_MEMORY':
      s.memories = s.memories.filter(m => m.id !== p.id)
      break

    // ── Activity ────────────────────────────────────────────────────────────
    case 'LOG_ACTIVITY':
      s.activityLog = [...(s.activityLog || []).slice(-499), { ...p, ts: now }]
      break

    // ── Insights ────────────────────────────────────────────────────────────
    case 'SET_INSIGHTS':
      s.insights = { ...s.insights, ...p }
      break
  }

  return s
}

/** Get recent action log */
function getActionLog(limit = 50) {
  return actionLog.slice(-limit).reverse()
}

module.exports = { nexusController, getActionLog }

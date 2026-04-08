'use strict'
/**
 * supervisor.js — NEXUS System Supervisor (Self-Healing Core)
 *
 * Manages all service processes with automatic restart on crash.
 * Wraps the existing systemLauncher's spawn logic with:
 *   - Crash detection + exponential backoff restart (max 5 restarts)
 *   - Per-service health tracking
 *   - Graceful shutdown (SIGTERM with SIGKILL fallback)
 *
 * Architecture:
 *   Electron Main → supervisor.startAll() → [backend, whisper, tts, ollama]
 *                                             ↑ auto-restarts on exit
 *
 * Exported:
 *   startAll()      — start all managed services
 *   stopAll()       — gracefully stop all services
 *   getHealth()     — returns health snapshot for all services
 *   restartService(name) — manually restart one service
 */

const { spawn, execSync } = require('child_process')
const http  = require('http')
const path  = require('path')
const fs    = require('fs')
const { app } = require('electron')

const MAX_RESTARTS   = 5
const BASE_DELAY_MS  = 2_000
const MAX_DELAY_MS   = 30_000

// Service registry: name → ServiceRecord
const _services = new Map()

// ── Path helpers ──────────────────────────────────────────────────────────────

function resourcePath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '..', ...parts)
}

function findNode() {
  const candidates = [
    app.isPackaged
      ? path.join(process.resourcesPath, 'bundled', 'node')
      : path.join(__dirname, '..', 'bundled', 'node'),
    process.env.NODE_BINARY,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ].filter(Boolean)
  for (const c of candidates) {
    try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c } catch {}
  }
  try { return execSync('which node', { encoding: 'utf8' }).trim() } catch {}
  return 'node'
}

function findPython() {
  for (const c of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3', 'python']) {
    try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c } catch {}
  }
  return 'python3'
}

// ── Core spawn + restart ──────────────────────────────────────────────────────

/**
 * _startService(config) — internal; spawns and registers a managed process.
 *
 * config: {
 *   name:     string            — unique identifier
 *   cmd:      string            — executable path
 *   args:     string[]          — arguments
 *   cwd:      string            — working directory
 *   env?:     object            — extra env vars
 *   healthPort?: number         — if set, supervisor will verify this port on startup
 *   critical?: boolean          — if true, Electron quits if maxRestarts exceeded
 * }
 */
function _startService(config) {
  const existing = _services.get(config.name)
  const restarts = existing?.restarts ?? 0

  if (restarts >= MAX_RESTARTS) {
    console.error(`[supervisor] ${config.name} exceeded max restarts (${MAX_RESTARTS}) — giving up`)
    if (config.critical) app.quit()
    return
  }

  // Exponential backoff
  const delay = restarts === 0
    ? 0
    : Math.min(BASE_DELAY_MS * Math.pow(2, restarts - 1), MAX_DELAY_MS)

  const record = {
    config,
    proc:      null,
    restarts,
    status:    'starting',
    startedAt: Date.now(),
    stoppedAt: null,
    intentionalStop: false,
  }
  _services.set(config.name, record)

  setTimeout(() => {
    console.log(`[supervisor] Starting ${config.name}${restarts > 0 ? ` (restart #${restarts})` : ''}...`)

    const proc = spawn(config.cmd, config.args, {
      cwd:   config.cwd,
      env:   { ...process.env, ...(config.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    record.proc   = proc
    record.status = 'running'

    proc.stdout?.on('data', d => process.stdout.write(`[${config.name}] ${d}`))
    proc.stderr?.on('data', d => process.stderr.write(`[${config.name}] ${d}`))

    proc.on('exit', (code, signal) => {
      record.status    = 'stopped'
      record.stoppedAt = Date.now()

      if (record.intentionalStop) {
        console.log(`[supervisor] ${config.name} stopped intentionally`)
        return
      }

      console.warn(`[supervisor] ${config.name} exited (code=${code}, signal=${signal}) — scheduling restart...`)
      record.restarts++
      _startService({ ...config })
    })
  }, delay)
}

// ── Public API ────────────────────────────────────────────────────────────────

async function startAll() {
  const node   = findNode()
  const python = findPython()
  const PORT   = parseInt(process.env.PORT || '18790', 10)

  // 1. Backend (critical — Electron window waits for it)
  _startService({
    name:       'backend',
    cmd:        node,
    args:       ['server.js'],
    cwd:        resourcePath('backend'),
    env:        { PORT: String(PORT) },
    healthPort: PORT,
    critical:   true,
  })

  // Wait for backend before continuing
  await _waitForPort(PORT)
  console.log('[supervisor] Backend online ✓')

  // 2. Ollama (non-critical — LLM features degrade gracefully)
  const ollamaBin = _findBin('ollama')
  if (ollamaBin) {
    const alreadyUp = await _portOpen(11434)
    if (!alreadyUp) {
      _startService({
        name: 'ollama',
        cmd:  ollamaBin,
        args: ['serve'],
        cwd:  process.env.HOME || '/',
      })
      await new Promise(r => setTimeout(r, 3_000))
    } else {
      console.log('[supervisor] Ollama already running ✓')
    }
  }

  // 3. Whisper STT (optional)
  const whisperDir = resourcePath('python-services', 'whisper-stt')
  if (fs.existsSync(path.join(whisperDir, 'app.py'))) {
    _startService({
      name: 'whisper',
      cmd:  python,
      args: ['app.py'],
      cwd:  whisperDir,
      env:  { WHISPER_PORT: '8765' },
    })
  }

  // 4. Piper TTS (optional)
  const ttsDir = resourcePath('python-services', 'tts-engine')
  if (fs.existsSync(path.join(ttsDir, 'app.py'))) {
    _startService({
      name: 'tts',
      cmd:  python,
      args: ['app.py'],
      cwd:  ttsDir,
      env:  { TTS_PORT: '8766' },
    })
  }

  console.log('[supervisor] All services started ✓')
}

function stopAll() {
  console.log('[supervisor] Shutting down all services...')
  for (const [name, record] of _services) {
    record.intentionalStop = true
    try {
      record.proc?.kill('SIGTERM')
      // SIGKILL after 3s if still alive
      setTimeout(() => {
        try { record.proc?.kill('SIGKILL') } catch {}
      }, 3_000)
    } catch (err) {
      console.warn(`[supervisor] Could not stop ${name}:`, err.message)
    }
  }
}

function restartService(name) {
  const record = _services.get(name)
  if (!record) throw new Error(`Unknown service: ${name}`)
  record.intentionalStop = true
  record.proc?.kill('SIGTERM')
  setTimeout(() => {
    record.restarts = 0        // reset backoff for manual restart
    _startService({ ...record.config })
  }, 1_000)
}

function getHealth() {
  const out = {}
  for (const [name, r] of _services) {
    out[name] = {
      status:    r.status,
      restarts:  r.restarts,
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt,
      pid:       r.proc?.pid ?? null,
    }
  }
  return out
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _waitForPort(port, retries = 40, delay = 500) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      const req = http.get(`http://127.0.0.1:${port}/health`, res => {
        if (res.statusCode < 500) return resolve()
        if (n > 0) setTimeout(() => check(n - 1), delay)
        else reject(new Error(`Port ${port} never became healthy`))
      })
      req.on('error', () => {
        if (n > 0) setTimeout(() => check(n - 1), delay)
        else reject(new Error(`Port ${port} unreachable`))
      })
      req.setTimeout(800, () => req.destroy())
    }
    check(retries)
  })
}

function _portOpen(port) {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/api/tags`, res => {
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => { req.destroy(); resolve(false) })
  })
}

function _findBin(name) {
  try { return execSync(`which ${name}`, { encoding: 'utf8' }).trim() } catch { return null }
}

module.exports = { startAll, stopAll, restartService, getHealth }

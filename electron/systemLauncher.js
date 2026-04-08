'use strict'
/**
 * System Launcher — starts all services in the correct order.
 * Called by Electron main process on app.whenReady().
 */
const { spawn, execSync } = require('child_process')
const http  = require('http')
const path  = require('path')
const fs    = require('fs')
const { app } = require('electron')

const PORT         = parseInt(process.env.PORT || '18790', 10)
const WHISPER_PORT = 8765
const TTS_PORT     = 8766

const procs = []

// ── Node binary detection ────────────────────────────────────────────────────
function findNode() {
  const candidates = [
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

// ── Python binary detection ──────────────────────────────────────────────────
function findPython() {
  const candidates = ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3', 'python3', 'python']
  for (const c of candidates) {
    try { execSync(`"${c}" --version`, { stdio: 'ignore' }); return c } catch {}
  }
  return 'python3'
}

// ── Resource path resolution ─────────────────────────────────────────────────
function resourcePath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '..', ...parts)
}

// ── Wait for a port to respond ────────────────────────────────────────────────
function waitForPort(port, retries = 40, delay = 500) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      const req = http.get(`http://127.0.0.1:${port}/health`, res => {
        if (res.statusCode < 500) return resolve()
        if (n > 0) setTimeout(() => check(n - 1), delay)
        else reject(new Error(`Port ${port} unhealthy after retries`))
      })
      req.on('error', () => {
        if (n > 0) setTimeout(() => check(n - 1), delay)
        else reject(new Error(`Port ${port} unreachable after retries`))
      })
      req.setTimeout(800, () => req.destroy())
    }
    check(retries)
  })
}

function spawnProc(label, cmd, args, cwd, env = {}) {
  console.log(`[NEXUS] Starting ${label}...`)
  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', d => process.stdout.write(`[${label}] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`[${label}] ${d}`))
  proc.on('exit', code => console.log(`[${label}] exited: ${code}`))
  procs.push(proc)
  return proc
}

// ── Service starters ─────────────────────────────────────────────────────────
async function startBackend() {
  const node      = findNode()
  const serverDir = resourcePath('backend')
  spawnProc('gateway', node, ['server.js'], serverDir, { PORT: String(PORT) })
  await waitForPort(PORT)
  console.log('[NEXUS] Gateway online ✓')
}

async function startPythonServices() {
  const python = findPython()

  // Whisper STT
  const whisperDir = resourcePath('python-services', 'whisper-stt')
  if (fs.existsSync(path.join(whisperDir, 'app.py'))) {
    spawnProc('whisper', python, ['app.py'], whisperDir, { WHISPER_PORT: String(WHISPER_PORT) })
    // Don't wait — whisper loads models slowly; it will be ready when needed
    console.log('[NEXUS] Whisper STT starting (async)...')
  }

  // Piper TTS
  const ttsDir = resourcePath('python-services', 'tts-engine')
  if (fs.existsSync(path.join(ttsDir, 'app.py'))) {
    spawnProc('tts', python, ['app.py'], ttsDir, { TTS_PORT: String(TTS_PORT) })
    console.log('[NEXUS] Piper TTS starting (async)...')
  }
}

async function startOllama() {
  // Check if Ollama is already running
  try {
    await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:11434/api/tags', res => {
        if (res.statusCode === 200) resolve()
        else reject()
      })
      req.on('error', reject)
      req.setTimeout(1000, () => { req.destroy(); reject() })
    })
    console.log('[NEXUS] Ollama already running ✓')
    return
  } catch {}

  // Try to start Ollama
  const ollamaBin = execSync('which ollama 2>/dev/null', { encoding: 'utf8' }).trim() || 'ollama'
  if (ollamaBin) {
    spawnProc('ollama', ollamaBin, ['serve'], process.env.HOME || '/', {})
    // Give it 5s to start
    await new Promise(r => setTimeout(r, 5000))
    console.log('[NEXUS] Ollama started ✓')
  } else {
    console.warn('[NEXUS] Ollama not found — LLM features will be unavailable')
  }
}

// ── Full system boot ─────────────────────────────────────────────────────────
async function bootAll() {
  await startOllama()
  await startBackend()
  await startPythonServices()
  console.log('[NEXUS] All systems online ✓')
}

// ── Graceful shutdown ────────────────────────────────────────────────────────
function shutdownAll() {
  console.log('[NEXUS] Shutting down all services...')
  procs.forEach(p => { try { p.kill('SIGTERM') } catch {} })
}

module.exports = { bootAll, shutdownAll, startBackend, startPythonServices, startOllama }

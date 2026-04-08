'use strict'
/**
 * agentLoop.js — NEXUS Autonomous Agent Loop
 *
 * Continuously runs registered agents every CYCLE_MS (5s).
 * Agents are lightweight async objects with a run() method.
 * Each agent runs independently — one crashing does not stop the others.
 *
 * Built-in agents:
 *   task-monitor   — flags overdue/stale tasks, promotes priority
 *   health-monitor — checks service health, logs anomalies
 *   memory-pruner  — trims old logs from SQLite to prevent DB bloat
 *
 * External agents can be added via registerAgent().
 *
 * Exported:
 *   registerAgent(agent)  — adds an agent to the loop
 *   startAgentLoop()      — begins the interval
 *   stopAgentLoop()       — clears the interval
 *   getAgentStatus()      — returns status of all registered agents
 */

const { logger }           = require('../../shared/logger')
const { insertLog, getTasks, updateTask, queryLogs } = require('../memory/sqlite')
const { calculatePriority } = require('../priorityEngine')

const CYCLE_MS = 5_000     // 5s main loop
const agents   = []
let   _timer   = null

// ── Agent registry ────────────────────────────────────────────────────────────

/**
 * registerAgent(agent)
 * @param {{ name: string, run: () => Promise<void> }} agent
 */
function registerAgent(agent) {
  if (!agent?.name || typeof agent?.run !== 'function') {
    throw new Error('[agentLoop] Agent must have { name, run }')
  }
  // Prevent duplicate registration
  if (agents.find(a => a.name === agent.name)) return
  agents.push({ ...agent, _lastRun: 0, _errors: 0, _running: false })
  logger.info({ name: agent.name }, '[agentLoop] Agent registered')
}

// ── Main tick ─────────────────────────────────────────────────────────────────

async function _tick() {
  for (const agent of agents) {
    if (agent._running) continue  // skip if previous run hasn't finished

    agent._running = true
    agent._lastRun = Date.now()

    try {
      await agent.run()
      agent._errors = 0
    } catch (err) {
      agent._errors++
      logger.warn({ name: agent.name, err: err.message, errors: agent._errors },
        '[agentLoop] Agent error')
      insertLog('AGENT_ERROR', { name: agent.name, err: err.message }, 'agentLoop')
    } finally {
      agent._running = false
    }
  }
}

function startAgentLoop() {
  if (_timer) return
  _registerBuiltins()
  _timer = setInterval(_tick, CYCLE_MS)
  _timer.unref?.()   // don't block process exit
  logger.info('[agentLoop] Started — %d agents', agents.length)
}

function stopAgentLoop() {
  if (_timer) { clearInterval(_timer); _timer = null }
}

function getAgentStatus() {
  return agents.map(({ name, _lastRun, _errors, _running }) => ({
    name, lastRun: _lastRun, errors: _errors, running: _running
  }))
}

// ── Built-in agents ───────────────────────────────────────────────────────────

function _registerBuiltins() {

  // ── Task monitor: re-scores tasks and flags overdue ones ──────────────────
  registerAgent({
    name: 'task-monitor',
    run: async () => {
      const tasks = getTasks({ status: 'open', limit: 100 })
      for (const task of tasks) {
        const score = calculatePriority(task)
        if (Math.abs(score - (task.priority ?? 0)) > 1) {
          updateTask(task.id, { status: 'open', priority: Math.round(score) })
        }
      }
      if (tasks.length > 0) {
        insertLog('TASK_MONITOR', { checked: tasks.length }, 'task-monitor')
      }
    },
  })

  // ── Health monitor: checks key services ──────────────────────────────────
  registerAgent({
    name: 'health-monitor',
    run: async () => {
      const http = require('http')
      const ports = [
        { name: 'gateway',  port: parseInt(process.env.PORT || '18790', 10) },
        { name: 'ollama',   port: 11434 },
        { name: 'whisper',  port: 8765 },
        { name: 'tts',      port: 8766 },
      ]

      for (const { name, port } of ports) {
        await new Promise(resolve => {
          const req = http.get(`http://127.0.0.1:${port}/health`, res => {
            const ok = res.statusCode < 500
            if (!ok) {
              insertLog('SERVICE_UNHEALTHY', { name, port, status: res.statusCode }, 'health-monitor')
              logger.warn({ name, port }, '[health-monitor] Service unhealthy')
            }
            resolve()
          })
          req.on('error', () => {
            // Service not responding — log but don't throw (supervisor handles restart)
            insertLog('SERVICE_DOWN', { name, port }, 'health-monitor')
            resolve()
          })
          req.setTimeout(1500, () => { req.destroy(); resolve() })
        })
      }
    },
  })

  // ── Memory pruner: keeps logs table under 10k rows ───────────────────────
  registerAgent({
    name: 'memory-pruner',
    _interval: 60 * 60 * 1000,   // only run every 60 min (not every 5s)
    _lastActualRun: 0,
    run: async function () {
      const now = Date.now()
      if (now - this._lastActualRun < this._interval) return
      this._lastActualRun = now

      const { db } = require('../memory/sqlite')
      const count = db.prepare('SELECT COUNT(*) as n FROM logs').get().n
      if (count > 10_000) {
        const trim = count - 8_000
        db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?)').run(trim)
        insertLog('MEMORY_PRUNED', { removed: trim, remaining: 8_000 }, 'memory-pruner')
        logger.info({ removed: trim }, '[memory-pruner] Pruned old logs')
      }
    },
  })
}

module.exports = { registerAgent, startAgentLoop, stopAgentLoop, getAgentStatus }

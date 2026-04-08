'use strict'
/**
 * agentLoop.js — NEXUS Autonomous Agent Loop (Decision-Driven)
 *
 * Every CYCLE_MS (5s):
 *   1. buildContext()    — snapshot of tasks, insights, health
 *   2. decide(context)   — Decision Engine picks the best action
 *   3. execute(plan)     — Execution Engine runs it (unless IDLE)
 *
 * Utility agents (task-monitor, health-monitor, memory-pruner) still run on
 * their own sub-timers via registerAgent(). They handle housekeeping;
 * the Decision Engine handles autonomous behavior.
 *
 * Goal agents (ProductivityAgent, TaskExecutionAgent, RecoveryAgent) are
 * registered directly with the Decision Engine and evaluated each cycle.
 *
 * Exported:
 *   registerAgent(agent)   — register a utility agent (housekeeping)
 *   startAgentLoop()       — start the loop
 *   stopAgentLoop()        — stop the loop
 *   getAgentStatus()       — status of all registered utility agents
 */

const { logger }          = require('../../shared/logger')
const { insertLog, getTasks, updateTask } = require('../memory/sqlite')
const { calculatePriority }               = require('../priorityEngine')
const { buildContext }                    = require('../contextBuilder')
const { decide, registerGoalAgent }       = require('../decisionEngine')
const { execute }                         = require('../executionEngine')

const CYCLE_MS = 5_000
const agents   = []
let   _timer   = null

// ── Global tick mutex — prevents any overlap between full cycles ──────────────
let _tickRunning = false

// ── Utility agent registry (housekeeping agents) ──────────────────────────────

function registerAgent(agent) {
  if (!agent?.name || typeof agent?.run !== 'function') {
    throw new Error('[agentLoop] Utility agent must have { name, run }')
  }
  if (agents.find(a => a.name === agent.name)) return
  agents.push({ ...agent, _lastRun: 0, _errors: 0, _running: false })
  logger.info({ name: agent.name }, '[agentLoop] Utility agent registered')
}

// ── Decision-driven main tick ─────────────────────────────────────────────────

let _decisionRunning = false

async function _decisionTick() {
  if (_decisionRunning) return
  _decisionRunning = true

  try {
    const context  = buildContext()
    const plan     = await decide(context)

    if (plan.type !== 'IDLE') {
      const result = await execute(plan)

      // Feed result back to goal agent that produced the plan
      if (plan.source) {
        const { _goalAgents } = require('../decisionEngine')   // internal ref
        const agent = (_goalAgents ?? []).find(a => a.name === plan.source)
        if (agent) {
          try {
            result.success
              ? agent.onSuccess?.(result, context)
              : agent.onError?.(new Error(result.error), context)
            agent._actCount  = (agent._actCount  ?? 0) + 1
            agent._lastActAt = Date.now()
          } catch {}
        }
      }

      // Broadcast decision to UI
      if (typeof global._nexusBroadcast === 'function' && plan.type !== 'LOG') {
        global._nexusBroadcast({
          type:     'AGENT_DECISION',
          decision: plan.type,
          source:   plan.source,
          ts:       Date.now(),
        })
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, '[agentLoop] Decision tick error')
    insertLog('AGENT_LOOP_ERROR', { err: err.message }, 'agentLoop')
  } finally {
    _decisionRunning = false
  }
}

// ── Utility agent tick (housekeeping) ─────────────────────────────────────────

async function _utilityTick() {
  for (const agent of agents) {
    if (agent._running) continue
    agent._running = true
    agent._lastRun = Date.now()
    try {
      await agent.run()
      agent._errors = 0
    } catch (err) {
      agent._errors++
      logger.warn({ name: agent.name, err: err.message }, '[agentLoop] Utility agent error')
      insertLog('AGENT_ERROR', { name: agent.name, err: err.message }, 'agentLoop')
    } finally {
      agent._running = false
    }
  }
}

// ── Start / stop ──────────────────────────────────────────────────────────────

function startAgentLoop() {
  if (_timer) return

  _registerUtilityAgents()
  _registerGoalAgents()

  // Decision-driven tick (every 5s) — global mutex prevents overlap
  _timer = setInterval(async () => {
    if (_tickRunning) return   // drop tick if previous cycle still running
    _tickRunning = true
    try {
      await _decisionTick()
      await _utilityTick()
    } finally {
      _tickRunning = false
    }
  }, CYCLE_MS)
  _timer.unref?.()

  logger.info('[agentLoop] Started — %d utility agents, %d goal agents registered',
    agents.length, require('../decisionEngine').getDecisionLog ? '?' : 0)
}

function stopAgentLoop() {
  if (_timer) { clearInterval(_timer); _timer = null }
}

function getAgentStatus() {
  return agents.map(({ name, _lastRun, _errors, _running }) => ({
    name, lastRun: _lastRun, errors: _errors, running: _running, type: 'utility',
  }))
}

// ── Register goal agents with Decision Engine ─────────────────────────────────

function _registerGoalAgents() {
  const { ProductivityAgent }  = require('./goals/ProductivityAgent')
  const { TaskExecutionAgent } = require('./goals/TaskExecutionAgent')
  const { RecoveryAgent }      = require('./goals/RecoveryAgent')

  registerGoalAgent(new RecoveryAgent())       // priority 10 — always first
  registerGoalAgent(new TaskExecutionAgent())  // priority 7
  registerGoalAgent(new ProductivityAgent())   // priority 6
}

// ── Register utility/housekeeping agents ──────────────────────────────────────

function _registerUtilityAgents() {

  // Task monitor — re-scores task priorities
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
    },
  })

  // Health monitor — writes service status to global for RecoveryAgent
  registerAgent({
    name: 'health-monitor',
    run: async () => {
      const http = require('http')
      const services = [
        { name: 'gateway', port: parseInt(process.env.PORT || '18790', 10) },
        { name: 'ollama',  port: 11434 },
        { name: 'whisper', port: 8765 },
        { name: 'tts',     port: 8766 },
      ]
      const unhealthy = []
      const statusMap = {}

      for (const svc of services) {
        const up = await new Promise(resolve => {
          const req = http.get(`http://127.0.0.1:${svc.port}/health`, res => {
            resolve(res.statusCode < 500)
          })
          req.on('error', () => resolve(false))
          req.setTimeout(1500, () => { req.destroy(); resolve(false) })
        })
        statusMap[svc.name] = up ? 'healthy' : 'down'
        if (!up) {
          unhealthy.push(svc.name)
          insertLog('SERVICE_DOWN', { name: svc.name, port: svc.port }, 'health-monitor')
        }
      }

      // Expose health state globally so contextBuilder can read it
      global._nexusSystemHealth = { unhealthyServices: unhealthy, services: statusMap }
    },
  })

  // Memory pruner — hourly, keeps logs under 10k rows
  registerAgent({
    name:              'memory-pruner',
    _pruneInterval:    60 * 60 * 1000,
    _lastPruneAt:      0,
    run: async function () {
      if (Date.now() - this._lastPruneAt < this._pruneInterval) return
      this._lastPruneAt = Date.now()
      const { db } = require('../memory/sqlite')
      const count = db.prepare('SELECT COUNT(*) as n FROM logs').get().n
      if (count > 10_000) {
        const trim = count - 8_000
        db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY timestamp ASC LIMIT ?)').run(trim)
        insertLog('MEMORY_PRUNED', { removed: trim }, 'memory-pruner')
        logger.info({ removed: trim }, '[memory-pruner] Pruned old logs')
      }
    },
  })
}

module.exports = { registerAgent, startAgentLoop, stopAgentLoop, getAgentStatus }

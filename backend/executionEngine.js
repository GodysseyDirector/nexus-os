'use strict'
/**
 * executionEngine.js — NEXUS Execution Engine
 *
 * Separates THINKING (brain/planning) from DOING (execution).
 *
 * All agent plans and brain-generated action intents route through execute().
 * The engine validates the plan, runs it against the controller, and returns
 * a structured result — never throws (callers always get a response object).
 *
 * Flow:
 *   Brain → { type, payload } ActionPlan → executionEngine.execute() → Controller → DB log
 *
 * Exported:
 *   execute(actionPlan)       → Promise<ExecutionResult>
 *   getExecutionLog()         → ExecutionResult[]
 */

const { nexusController } = require('./nexusController')
const { insertLog }       = require('./memory/sqlite')
const { logger }          = require('../shared/logger')

// ── Execution log (in-memory, last 200, mirrored to SQLite) ──────────────────
const _execLog   = []
const EXEC_CAP   = 200

function _logExec(result) {
  _execLog.push({ ...result, ts: Date.now() })
  if (_execLog.length > EXEC_CAP) _execLog.shift()
  insertLog('EXECUTION', result, 'executionEngine')
}

// ── Action handlers ───────────────────────────────────────────────────────────
// Each handler receives payload and returns { success, data? }
// Handlers may call the controller, external APIs, or trigger UI events.

const HANDLERS = {
  async ADD_TASK(payload) {
    const result = await nexusController(
      { type: 'ADD_TASK', payload },
      { skipBrain: true }   // avoid re-entering brain loop
    )
    return { success: true, data: result }
  },

  async COMPLETE_TASK(payload) {
    const result = await nexusController(
      { type: 'COMPLETE_TASK', payload },
      { skipBrain: true }
    )
    return { success: true, data: result }
  },

  async ADD_NOTE(payload) {
    const result = await nexusController(
      { type: 'ADD_NOTE', payload },
      { skipBrain: true }
    )
    return { success: true, data: result }
  },

  async SCHEDULE_EVENT(payload) {
    const result = await nexusController(
      { type: 'SCHEDULE_EVENT', payload },
      { skipBrain: true }
    )
    return { success: true, data: result }
  },

  async SPEAK(payload) {
    // Broadcast to any connected WS clients via global broadcast (set by server.js)
    if (typeof global._nexusBroadcast === 'function') {
      global._nexusBroadcast({ type: 'SPEAK', text: payload?.text ?? payload })
    }
    return { success: true }
  },

  async OPEN_PANEL(payload) {
    if (typeof global._nexusBroadcast === 'function') {
      global._nexusBroadcast({ type: 'OPEN_PANEL', panel: payload?.panel ?? payload })
    }
    return { success: true }
  },

  async LOG(payload) {
    insertLog(payload?.type ?? 'AGENT_LOG', payload, 'agent')
    return { success: true }
  },
}

/**
 * execute(actionPlan) → Promise<ExecutionResult>
 *
 * @param {{ type: string, payload?: any, source?: string }} actionPlan
 * @returns {{ success: boolean, data?: any, error?: string, type: string, ts: number }}
 */
async function execute(actionPlan) {
  const { type, payload, source = 'brain' } = actionPlan ?? {}

  if (!type || typeof type !== 'string') {
    const result = { success: false, error: 'invalid_plan', type: 'UNKNOWN', ts: Date.now() }
    _logExec(result)
    return result
  }

  const handler = HANDLERS[type]
  if (!handler) {
    logger.warn({ type }, '[executionEngine] Unknown action type')
    const result = { success: false, error: `unknown_action:${type}`, type, ts: Date.now() }
    _logExec(result)
    return result
  }

  try {
    logger.debug({ type, source }, '[executionEngine] Executing')
    const handlerResult = await handler(payload)
    const result = { success: true, type, ts: Date.now(), ...handlerResult }
    _logExec(result)
    return result
  } catch (err) {
    logger.error({ type, err: err.message }, '[executionEngine] Execution failed')
    const result = { success: false, error: err.message, type, ts: Date.now() }
    _logExec(result)
    return result
  }
}

/** Returns a copy of the in-memory execution log. */
function getExecutionLog() {
  return [..._execLog]
}

module.exports = { execute, getExecutionLog }

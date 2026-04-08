'use strict'
/**
 * decisionEngine.js — NEXUS Executive Brain
 *
 * The central authority. Every 5-second cycle it receives the full system
 * context and returns a single ActionPlan — or IDLE — for the execution engine.
 *
 * Decision priority (highest wins):
 *   1. Recovery     — unhealthy services override everything
 *   2. Goal agents  — sorted by agent.priority (desc), first that evaluates → acts
 *   3. Insight triggers — LOW_PRODUCTIVITY, ANOMALY_SPIKE from insight engine
 *   4. Task queue   — surface top-priority task if agents are quiet
 *   5. IDLE         — nothing to do
 *
 * Exported:
 *   decide(context)           → Promise<ActionPlan>
 *   registerGoalAgent(agent)  → void
 *   getDecisionLog()          → DecisionEntry[]
 */

const { topN }            = require('./priorityEngine')
const { insertLog }       = require('./memory/sqlite')
const { logger }          = require('../shared/logger')

// ── Goal agent registry ───────────────────────────────────────────────────────
const _goalAgents = []

function registerGoalAgent(agent) {
  if (!agent?.name || typeof agent?.evaluate !== 'function' || typeof agent?.act !== 'function') {
    throw new Error('[decisionEngine] GoalAgent must have { name, evaluate, act }')
  }
  if (_goalAgents.find(a => a.name === agent.name)) return
  _goalAgents.push(agent)
  // Sort by priority descending so highest-priority agents are evaluated first
  _goalAgents.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  logger.info({ name: agent.name, priority: agent.priority }, '[decisionEngine] Goal agent registered')
}

// ── Decision log (in-memory, last 100) ───────────────────────────────────────
const _decisionLog = []

function _log(entry) {
  _decisionLog.push({ ...entry, ts: Date.now() })
  if (_decisionLog.length > 100) _decisionLog.shift()
  insertLog('DECISION', entry, 'decisionEngine')
}

// ── Main decision function ────────────────────────────────────────────────────

/**
 * decide(context) → Promise<ActionPlan>
 *
 * @param {Context} context — from contextBuilder.buildContext()
 * @returns {{ type: string, payload?: any, source: string }}
 */
async function decide(context) {
  const { tasks, insights, systemHealth } = context

  // ── 1. Recovery check (highest priority) ─────────────────────────────────
  const unhealthy = systemHealth?.unhealthyServices ?? []
  if (unhealthy.length > 0) {
    const recoveryAgent = _goalAgents.find(a => a.name === 'recovery')
    if (recoveryAgent) {
      try {
        const shouldAct = await recoveryAgent.evaluate(context)
        if (shouldAct) {
          const plan = await recoveryAgent.act(context)
          if (plan) {
            _log({ decision: plan.type, agent: recoveryAgent.name, reason: 'unhealthy_services' })
            return { ...plan, source: recoveryAgent.name }
          }
        }
      } catch (err) {
        logger.warn({ err: err.message }, '[decisionEngine] RecoveryAgent evaluation failed')
      }
    }
  }

  // ── 2. Goal agents (priority-sorted) ─────────────────────────────────────
  for (const agent of _goalAgents) {
    if (agent.name === 'recovery') continue   // already checked above

    try {
      const shouldAct = await agent.evaluate(context)
      if (!shouldAct) continue

      const plan = await agent.act(context)
      if (!plan) continue

      _log({ decision: plan.type, agent: agent.name })
      logger.debug({ type: plan.type, agent: agent.name }, '[decisionEngine] Goal agent acting')
      return { ...plan, source: agent.name }

    } catch (err) {
      agent._errorCount = (agent._errorCount ?? 0) + 1
      logger.warn({ name: agent.name, err: err.message }, '[decisionEngine] Agent error — skipping')
    }
  }

  // ── 3. Insight triggers ───────────────────────────────────────────────────
  const triggers = insights.triggers ?? []

  if (triggers.includes('LOW_PRODUCTIVITY')) {
    _log({ decision: 'ACTIVATE_PRODUCTIVITY_AGENT', reason: 'insight_trigger' })
    return { type: 'ACTIVATE_PRODUCTIVITY_AGENT', source: 'decisionEngine' }
  }

  if (triggers.includes('ANOMALY_SPIKE')) {
    _log({ decision: 'LOG', reason: 'anomaly_spike' })
    return {
      type:    'LOG',
      payload: { type: 'ANOMALY_SPIKE_DETECTED', triggers, ts: Date.now() },
      source:  'decisionEngine',
    }
  }

  // ── 4. Passive task surface ───────────────────────────────────────────────
  if (tasks.length > 0) {
    const top = tasks[0]
    _log({ decision: 'EXECUTE_TASK', taskId: top.id, score: top.priorityScore })
    return {
      type:    'EXECUTE_TASK',
      payload: { task: top, source: 'decisionEngine', ts: Date.now() },
      source:  'decisionEngine',
    }
  }

  // ── 5. Idle ───────────────────────────────────────────────────────────────
  _log({ decision: 'IDLE' })
  return { type: 'IDLE', source: 'decisionEngine' }
}

function getDecisionLog() {
  return [..._decisionLog]
}

module.exports = { decide, registerGoalAgent, getDecisionLog }

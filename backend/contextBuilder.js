'use strict'
/**
 * contextBuilder.js — NEXUS Context Builder
 *
 * Assembles a unified system snapshot every cycle so the Decision Engine
 * and all Goal Agents reason from a consistent, single source of truth.
 *
 * Context shape:
 *   {
 *     tasks:         Task[]          — open tasks ranked by priority
 *     insights:      InsightReport   — latest behavioral insights (or empty)
 *     systemHealth:  HealthMap       — per-service status (from global)
 *     agentStatus:   AgentStatus[]   — which agents are running / erroring
 *     recentLogs:    LogEntry[]      — last 50 system events
 *     time:          number          — current ms timestamp
 *     hour:          number          — 0–23
 *   }
 *
 * buildContext() is synchronous — all data comes from in-memory SQLite.
 * It is safe to call every 5 seconds without I/O cost.
 */

const { getTasks, queryLogs, getInsights } = require('./memory/sqlite')
const { topN }                             = require('./priorityEngine')
const { getAgentStatus }                   = require('./agents/agentLoop')

/**
 * buildContext() → Context
 */
function buildContext() {
  // Open tasks ranked by priority (top 20)
  const rawTasks = getTasks({ status: 'open',   limit: 50 })
  const pending  = getTasks({ status: 'pending', limit: 50 })
  const allActive = [...rawTasks, ...pending]
  const tasks    = topN(allActive, 20)

  // Most recent insight report (first row from insights table)
  const insightRows = getInsights({ limit: 1 })
  const insights    = insightRows.length > 0 ? insightRows[0].data : {
    behaviorScore: 1,
    anomalies:    [],
    triggers:     [],
    frequentActions: {},
  }
  // Ensure triggers is always an array
  if (!Array.isArray(insights.triggers)) insights.triggers = []

  // System health from global (set by health-monitor agent)
  const systemHealth = global._nexusSystemHealth ?? {
    unhealthyServices: [],
    services: {},
  }

  // Agent status
  let agentStatus = []
  try { agentStatus = getAgentStatus() } catch {}

  // Recent system events
  const recentLogs = queryLogs({ limit: 50 })

  return {
    tasks,
    insights,
    systemHealth,
    agentStatus,
    recentLogs,
    time: Date.now(),
    hour: new Date().getHours(),
  }
}

module.exports = { buildContext }

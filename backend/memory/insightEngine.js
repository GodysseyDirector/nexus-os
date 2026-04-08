'use strict'
/**
 * insightEngine.js — NEXUS Intelligence Layer
 *
 * Runs every 24 hours and analyzes the SQLite logs table to produce
 * behavioral insights. Insights are stored back into the insights table
 * and surfaced via /api/insights.
 *
 * What it detects:
 *   frequentActions  — which action types are called most often
 *   anomalies        — action spikes or silent periods
 *   behaviorScore    — overall system activity health (0–1)
 *   topErrors        — most common error types
 *   peakHour         — hour of day with most activity
 *
 * Exported:
 *   generateInsights()    — run analysis now, returns insight object
 *   startInsightCycle()   — auto-run every 24h
 *   stopInsightCycle()    — cancel the cycle
 */

const { queryLogs, insertInsight, getInsights } = require('./sqlite')
const { logger } = require('../../shared/logger')

const CYCLE_MS = 24 * 60 * 60 * 1000   // 24h

let _timer = null

// ── Analysis ──────────────────────────────────────────────────────────────────

/**
 * generateInsights() → InsightReport
 *
 * Analyzes the last 1000 log entries.
 */
function generateInsights() {
  const logs = queryLogs({ limit: 1000 })

  if (logs.length === 0) {
    return { frequentActions: {}, anomalies: [], behaviorScore: 0, topErrors: [], peakHour: null }
  }

  // ── Frequency map ─────────────────────────────────────────────────────────
  const freq = {}
  const errFreq = {}
  const hourCounts = new Array(24).fill(0)

  for (const entry of logs) {
    freq[entry.type] = (freq[entry.type] ?? 0) + 1

    if (entry.type === 'AGENT_ERROR' || entry.type === 'EXECUTION_FAIL') {
      const errType = entry.payload?.type ?? entry.type
      errFreq[errType] = (errFreq[errType] ?? 0) + 1
    }

    if (entry.timestamp) {
      const hour = new Date(entry.timestamp).getHours()
      hourCounts[hour]++
    }
  }

  // ── Anomaly detection ─────────────────────────────────────────────────────
  const anomalies = []
  const mean  = logs.length / Object.keys(freq).length
  for (const [type, count] of Object.entries(freq)) {
    if (count > mean * 5) {
      anomalies.push({ type, count, reason: 'spike' })
    }
  }

  // Gap detection — if last log is > 10 min old, flag it
  const lastTs = logs[0]?.timestamp ?? 0
  if (Date.now() - lastTs > 10 * 60 * 1000) {
    anomalies.push({ type: 'SILENCE', duration: Date.now() - lastTs, reason: 'no_activity' })
  }

  // ── Behavior score ────────────────────────────────────────────────────────
  const successCount = logs.filter(l => !l.type.includes('ERROR') && !l.type.includes('FAIL')).length
  const behaviorScore = Math.round((successCount / logs.length) * 100) / 100

  // ── Top errors ────────────────────────────────────────────────────────────
  const topErrors = Object.entries(errFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }))

  // ── Peak hour ─────────────────────────────────────────────────────────────
  const peakHour = hourCounts.indexOf(Math.max(...hourCounts))

  const insight = {
    frequentActions: freq,
    anomalies,
    behaviorScore,
    topErrors,
    peakHour,
    generatedAt: Date.now(),
    sampleSize: logs.length,
  }

  // Persist to DB
  insertInsight({
    category: 'behavioral',
    data:     insight,
    score:    behaviorScore,
  })

  logger.info({ behaviorScore, anomalies: anomalies.length }, '[insightEngine] Insights generated')
  return insight
}

function startInsightCycle() {
  if (_timer) return
  // Run once on startup (after 5s to let services settle)
  setTimeout(() => {
    try { generateInsights() } catch (err) {
      logger.warn({ err: err.message }, '[insightEngine] Initial run failed')
    }
  }, 5_000)

  _timer = setInterval(() => {
    try { generateInsights() } catch (err) {
      logger.warn({ err: err.message }, '[insightEngine] Cycle failed')
    }
  }, CYCLE_MS)
  _timer.unref?.()
}

function stopInsightCycle() {
  if (_timer) { clearInterval(_timer); _timer = null }
}

module.exports = { generateInsights, startInsightCycle, stopInsightCycle, getInsights }

'use strict'
/**
 * Memory Compression Engine
 * Runs every 24h — summarizes activity logs, detects patterns, generates insights.
 * Uses the fast model to produce summaries without hammering reasoning model.
 */
const { logger } = require('../../shared/logger')

let lastRun = 0
const INTERVAL = 24 * 60 * 60 * 1000 // 24h

/**
 * Compress logs into a summary object.
 * Called by eventLoop on schedule.
 */
async function compressMemory(logs, modelRouter) {
  if (!logs || logs.length === 0) return null
  if (Date.now() - lastRun < INTERVAL) return null

  logger.info('Memory compression starting')
  lastRun = Date.now()

  try {
    const recent = logs.slice(-200)
    const text = recent.map(l => `[${l.time || ''}] ${l.type || ''}: ${l.message || JSON.stringify(l)}`).join('\n')

    const prompt = `Analyze these activity logs and return a JSON object with:
- summary: 2-3 sentence summary of recent activity
- patterns: array of up to 5 recurring behavior patterns
- insights: array of up to 3 actionable insights

Logs:
${text}

Return valid JSON only.`

    const response = await modelRouter.callFast(prompt)
    const parsed = extractJSON(response)

    return {
      summary:  parsed?.summary  || 'Activity logged.',
      patterns: parsed?.patterns || [],
      insights: parsed?.insights || [],
      compressedAt: new Date().toISOString(),
      logsCompressed: recent.length,
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Memory compression failed')
    return null
  }
}

function extractJSON(text) {
  try {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } catch {}
  return null
}

module.exports = { compressMemory }

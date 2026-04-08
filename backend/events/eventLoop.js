'use strict'
/**
 * Autonomous Event Loop — runs every 30s.
 * Executes all registered triggers and runs memory compression every 24h.
 */
const { allTriggers } = require('./triggers')
const { compressMemory } = require('../memory/compressor')
const { getState, _internalSet } = require('../memory/state')
const { persistState } = require('../memory/memoryEngine')
const modelRouter = require('../router/modelRouter')
const { logger } = require('../../shared/logger')

const TICK_MS   = 30_000  // 30 seconds
const COMPRESS_MS = 24 * 60 * 60 * 1000 // 24h

let _timer = null
let _lastCompress = 0

function runTriggers(triggers) {
  for (const trigger of triggers) {
    try { trigger() } catch (err) {
      logger.warn({ trigger: trigger.name, err: err.message }, 'Trigger error (non-fatal)')
    }
  }
}

async function tick() {
  logger.debug('Event loop tick')

  // Run all triggers
  runTriggers(allTriggers)

  // Memory compression every 24h
  if (Date.now() - _lastCompress > COMPRESS_MS) {
    const state  = getState()
    const result = await compressMemory(state.activityLog || [], modelRouter)
    if (result) {
      const s = JSON.parse(JSON.stringify(state))
      s.insights = { ...s.insights, compression: result }
      _internalSet(s)
      persistState(getState()).catch(() => {})
      _lastCompress = Date.now()
      logger.info({ logsCompressed: result.logsCompressed }, 'Memory compression complete')
    }
  }
}

function start() {
  if (_timer) return
  logger.info('Event loop started (30s interval)')
  _timer = setInterval(() => tick().catch(err => logger.error({ err: err.message }, 'Event loop error')), TICK_MS)
  if (_timer.unref) _timer.unref() // Don't keep process alive just for event loop
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null }
}

module.exports = { start, stop }

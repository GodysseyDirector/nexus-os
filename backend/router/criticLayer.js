'use strict'
/**
 * Critic Layer — validates actions and LLM outputs before they affect state.
 * Every state mutation + every LLM response passes through here.
 */
const { logger } = require('../../shared/logger')

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /drop\s+table/i,
  /delete\s+all/i,
  /format\s+disk/i,
  /system\s*\(\s*["'`]/i,
  /exec\s*\(\s*["'`]/i,
]

/** Validate an action before controller applies it */
function criticCheck(action) {
  if (!action || typeof action !== 'object') return reject('Action must be an object')
  if (!action.type) return reject('Action.type is required')

  // Check payload for dangerous content
  if (action.payload) {
    const payloadStr = JSON.stringify(action.payload)
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(payloadStr)) {
        logger.warn({ type: action.type }, 'Critic: dangerous payload blocked')
        return reject(`Dangerous pattern detected in payload`)
      }
    }
  }

  // State-mutating actions need a valid payload
  const mutatorsRequiringPayload = [
    'ADD_TASK', 'ADD_NOTE', 'ADD_CALENDAR', 'ADD_GOAL', 'SAVE_MEMORY'
  ]
  if (mutatorsRequiringPayload.includes(action.type) && !action.payload) {
    return reject(`${action.type} requires a payload`)
  }

  return approve()
}

/** Validate an LLM response before it's sent to the client */
function criticCheckResponse(text) {
  if (!text || typeof text !== 'string') return reject('Empty response')
  if (text.length > 32000) return reject('Response too long')

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      logger.warn('Critic: dangerous content in LLM response blocked')
      return reject('Response contained unsafe content')
    }
  }

  return approve(text)
}

function approve(data) { return { ok: true, data } }
function reject(reason) { return { ok: false, error: reason } }

module.exports = { criticCheck, criticCheckResponse }

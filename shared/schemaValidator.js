'use strict'

const VALID_TYPES = new Set([
  'ADD_TASK', 'UPDATE_TASK', 'DELETE_TASK', 'MOVE_TASK',
  'ADD_NOTE', 'DELETE_NOTE',
  'ADD_CALENDAR', 'DELETE_CALENDAR',
  'ADD_GOAL', 'DELETE_GOAL',
  'LOG_ACTIVITY', 'SET_INSIGHTS',
  'CHAT', 'COMMAND',
  'SAVE_MEMORY', 'DELETE_MEMORY',
])

/**
 * Validate an action before it enters the controller.
 * Returns { ok: true } or { ok: false, error: string }
 */
function validate(action) {
  if (!action || typeof action !== 'object') return { ok: false, error: 'Action must be an object' }
  if (!action.type)                          return { ok: false, error: 'Action.type is required' }
  if (!VALID_TYPES.has(action.type))         return { ok: false, error: `Unknown action type: ${action.type}` }
  if (action.mutatesState && !action.payload) return { ok: false, error: 'State-mutating action requires payload' }
  return { ok: true }
}

/**
 * Validate that a payload for a given type has required fields.
 */
function validatePayload(type, payload) {
  const rules = {
    ADD_TASK:      ['title'],
    ADD_NOTE:      ['content'],
    ADD_CALENDAR:  ['title', 'isoDate'],
    SAVE_MEMORY:   ['key', 'value'],
    CHAT:          ['text'],
    COMMAND:       ['text'],
  }
  const required = rules[type] || []
  for (const field of required) {
    if (!payload || payload[field] == null) return { ok: false, error: `${type} requires field: ${field}` }
  }
  return { ok: true }
}

module.exports = { validate, validatePayload }

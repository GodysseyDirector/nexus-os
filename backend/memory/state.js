'use strict'
/**
 * NEXUS Core State — single source of truth.
 * NO direct mutation from outside this module.
 * ALL writes go through nexusController.
 */

let _state = {
  calendar:    [],
  tasks:       [],
  notes:       [],
  goals:       [],
  memories:    [],
  activityLog: [],
  systemEvents:[],
  insights:    {},
  agents:      [],
  lastUpdated: Date.now(),
}

/** Read-only frozen snapshot */
const getState = () => Object.freeze(JSON.parse(JSON.stringify(_state)))

/** Internal write — ONLY nexusController may call this */
const _internalSet = (nextState) => {
  _state = { ...nextState, lastUpdated: Date.now() }
}

/** Merge partial state (for hydration from disk) */
const _hydrate = (saved) => {
  _state = {
    ..._state,
    ...saved,
    lastUpdated: Date.now(),
  }
}

module.exports = { getState, _internalSet, _hydrate }

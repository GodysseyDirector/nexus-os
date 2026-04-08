'use strict'
/**
 * Autonomous Triggers — checked every 30s by the event loop.
 * Each trigger inspects state and may fire controller actions or push WS events.
 */
const { getState } = require('../memory/state')
const { nexusController } = require('../nexusController')
const { logger } = require('../../shared/logger')

let _broadcast = null // set by server

function setBroadcast(fn) { _broadcast = fn }

function push(type, payload) {
  if (_broadcast) _broadcast({ type, payload, ts: Date.now() })
}

// ── Triggers ─────────────────────────────────────────────────────────────────

/** Remind about tasks overdue or stuck in-progress */
function checkPendingTasks() {
  const state = getState()
  const inProgress = (state.tasks || []).filter(t => t.column === 'inProgress')
  const old = inProgress.filter(t => {
    if (!t.createdAt) return false
    const age = Date.now() - new Date(t.createdAt).getTime()
    return age > 48 * 60 * 60 * 1000 // 48h in inProgress
  })
  if (old.length > 0) {
    push('nexus-toast', { message: `${old.length} task${old.length > 1 ? 's' : ''} stuck in progress for 48h+`, type: 'warn' })
    logger.info({ count: old.length }, 'Aging tasks trigger fired')
  }
}

/** Check calendar for events in the next 60 minutes */
function checkCalendarEvents() {
  const state = getState()
  const now = Date.now()
  const soon = (state.calendar || []).filter(e => {
    try {
      const eventDate = new Date(`${e.isoDate}T${to24h(e.time) || '00:00'}`)
      const diff = eventDate.getTime() - now
      return diff > 0 && diff < 60 * 60 * 1000 // next 60 min
    } catch { return false }
  })
  if (soon.length > 0) {
    soon.forEach(e => {
      push('nexus-toast', { message: `Upcoming: ${e.title} at ${e.time || e.isoDate}`, type: 'info' })
    })
  }
}

/** Detect if system has been idle > 2h — push gentle nudge */
let lastActivity = Date.now()
function resetActivityTimer() { lastActivity = Date.now() }

function detectInactivity() {
  const idle = Date.now() - lastActivity
  if (idle > 2 * 60 * 60 * 1000) {
    push('nexus-toast', { message: 'Director, you have been inactive for 2h. Anything to review?', type: 'info' })
    lastActivity = Date.now() // reset so it doesn't spam
  }
}

/** Escalate tasks that have been in todo for 7+ days */
function escalateAgingTasks() {
  const state = getState()
  const aged = (state.tasks || []).filter(t => {
    if (t.column !== 'todo' || !t.createdAt) return false
    return Date.now() - new Date(t.createdAt).getTime() > 7 * 24 * 60 * 60 * 1000
  })
  if (aged.length > 0) {
    push('nexus-toast', { message: `${aged.length} task${aged.length > 1 ? 's' : ''} queued for 7+ days`, type: 'warn' })
  }
}

function to24h(timeStr) {
  if (!timeStr) return null
  const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i)
  if (!m) return null
  let h = parseInt(m[1]), min = m[2], ampm = m[3]
  if (ampm?.toUpperCase() === 'PM' && h < 12) h += 12
  if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${min}`
}

module.exports = {
  allTriggers: [checkPendingTasks, checkCalendarEvents, detectInactivity, escalateAgingTasks],
  resetActivityTimer,
  setBroadcast,
}

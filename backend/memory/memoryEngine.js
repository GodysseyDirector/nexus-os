'use strict'
const fs   = require('fs')
const path = require('path')
const { DATA_DIR, STATE_FILE } = require('../../shared/constants')
const { logger } = require('../../shared/logger')

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

/** Persist state to disk */
async function persistState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to persist state')
  }
}

/** Load state from disk (returns null if no saved state) */
function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null
    const raw = fs.readFileSync(STATE_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not load saved state — starting fresh')
    return null
  }
}

/** Store a memory entry */
function storeMemory(memories, entry) {
  const id = Date.now()
  const record = { id, ...entry, createdAt: new Date().toISOString() }
  // Deduplicate by content
  const exists = memories.find(m => m.content === entry.content)
  if (exists) return memories
  return [...memories.slice(-999), record]
}

/** Retrieve memories, optionally filtered */
function retrieveMemories(memories, { category, limit = 50, query } = {}) {
  let results = [...memories]
  if (category) results = results.filter(m => m.category === category)
  if (query)    results = results.filter(m => JSON.stringify(m).toLowerCase().includes(query.toLowerCase()))
  return results.slice(-limit).reverse()
}

module.exports = { persistState, loadState, storeMemory, retrieveMemories }

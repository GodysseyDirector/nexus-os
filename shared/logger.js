'use strict'
const fs   = require('fs')
const path = require('path')
const { DATA_DIR, LOG_FILE } = require('./constants')

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN    = LEVELS[process.env.LOG_LEVEL || 'info']

function write(level, meta, msg) {
  if (LEVELS[level] < MIN) return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta }) + '\n'
  process.stdout.write(line)
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

const logger = {
  debug: (meta, msg) => write('debug', typeof meta === 'string' ? {} : meta, msg || meta),
  info:  (meta, msg) => write('info',  typeof meta === 'string' ? {} : meta, msg || meta),
  warn:  (meta, msg) => write('warn',  typeof meta === 'string' ? {} : meta, msg || meta),
  error: (meta, msg) => write('error', typeof meta === 'string' ? {} : meta, msg || meta),
}

module.exports = { logger }

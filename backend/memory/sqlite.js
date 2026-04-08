'use strict'
/**
 * sqlite.js — NEXUS Persistent Memory (SQLite)
 *
 * Replaces the flat JSON log with a queryable, durable SQLite database.
 * All heavy memory operations (logs, tasks, insights) flow through here.
 *
 * The DB file lives in DATA_DIR alongside state.json so it survives updates.
 * Tables are created on first boot (idempotent).
 *
 * Exported API:
 *   db          — raw better-sqlite3 instance for advanced queries
 *   insertLog   — write a system/brain log entry
 *   queryLogs   — retrieve logs with optional type filter + limit
 *   insertTask  — persist a task
 *   getTasks    — retrieve tasks ordered by priority desc
 *   updateTask  — update task fields
 *   deleteTask  — remove a task by id
 *   insertInsight — store a generated insight
 *   getInsights   — retrieve recent insights
 */

const Database = require('better-sqlite3')
const path     = require('path')
const fs       = require('fs')
const { DATA_DIR } = require('../../shared/constants')

// ── DB init ───────────────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = path.join(DATA_DIR, 'nexus.db')
const db      = new Database(DB_PATH)

// WAL mode for concurrent reads without blocking writes
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT    NOT NULL,
    title      TEXT,
    category   TEXT    DEFAULT 'general',
    status     TEXT    DEFAULT 'open',
    priority   INTEGER DEFAULT 0,
    urgency    INTEGER DEFAULT 1,
    importance INTEGER DEFAULT 1,
    source     TEXT    DEFAULT 'user',
    createdAt  INTEGER NOT NULL,
    updatedAt  INTEGER
  );

  CREATE TABLE IF NOT EXISTS logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    type      TEXT    NOT NULL,
    payload   TEXT,
    source    TEXT    DEFAULT 'system',
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS insights (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    category  TEXT,
    data      TEXT    NOT NULL,
    score     REAL    DEFAULT 0,
    createdAt INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_type      ON logs(type);
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
`)

// ── Prepared statements (compiled once, reused) ───────────────────────────────
const _stmts = {
  insertLog:     db.prepare('INSERT INTO logs (type, payload, source, timestamp) VALUES (?, ?, ?, ?)'),
  queryLogs:     db.prepare('SELECT * FROM logs WHERE (? IS NULL OR type = ?) ORDER BY timestamp DESC LIMIT ?'),
  insertTask:    db.prepare('INSERT INTO tasks (content, title, category, priority, urgency, importance, source, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  getTasks:      db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC LIMIT ?'),
  updateTask:    db.prepare('UPDATE tasks SET status = ?, priority = ?, updatedAt = ? WHERE id = ?'),
  deleteTask:    db.prepare('DELETE FROM tasks WHERE id = ?'),
  insertInsight: db.prepare('INSERT INTO insights (category, data, score, createdAt) VALUES (?, ?, ?, ?)'),
  getInsights:   db.prepare('SELECT * FROM insights ORDER BY createdAt DESC LIMIT ?'),
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * insertLog(type, payload, source?)
 * Writes a system or brain log entry. Payload is JSON-serialized.
 */
function insertLog(type, payload, source = 'system') {
  _stmts.insertLog.run(type, JSON.stringify(payload ?? {}), source, Date.now())
}

/**
 * queryLogs({ type?, limit? }) → LogEntry[]
 */
function queryLogs({ type = null, limit = 100 } = {}) {
  return _stmts.queryLogs.all(type, type, limit)
    .map(row => ({ ...row, payload: _safeParse(row.payload) }))
}

/**
 * insertTask(task) → { id }
 * task: { content, title?, category?, priority?, urgency?, importance?, source? }
 */
function insertTask(task) {
  const info = _stmts.insertTask.run(
    task.content,
    task.title   ?? task.content.slice(0, 80),
    task.category   ?? 'general',
    task.priority   ?? 0,
    task.urgency    ?? 1,
    task.importance ?? 1,
    task.source     ?? 'user',
    Date.now()
  )
  return { id: info.lastInsertRowid }
}

/**
 * getTasks({ status?, limit? }) → Task[]
 */
function getTasks({ status = 'open', limit = 50 } = {}) {
  return _stmts.getTasks.all(status, limit)
}

/**
 * updateTask(id, { status?, priority? })
 */
function updateTask(id, { status = 'open', priority = 0 } = {}) {
  _stmts.updateTask.run(status, priority, Date.now(), id)
}

/**
 * deleteTask(id)
 */
function deleteTask(id) {
  _stmts.deleteTask.run(id)
}

/**
 * insertInsight(insight)
 * insight: { category?, data, score? }
 */
function insertInsight(insight) {
  _stmts.insertInsight.run(
    insight.category ?? 'general',
    typeof insight.data === 'string' ? insight.data : JSON.stringify(insight.data),
    insight.score ?? 0,
    Date.now()
  )
}

/**
 * getInsights({ limit? }) → Insight[]
 */
function getInsights({ limit = 20 } = {}) {
  return _stmts.getInsights.all(limit)
    .map(row => ({ ...row, data: _safeParse(row.data) }))
}

function _safeParse(str) {
  try { return JSON.parse(str) } catch { return str }
}

module.exports = { db, insertLog, queryLogs, insertTask, getTasks, updateTask, deleteTask, insertInsight, getInsights }

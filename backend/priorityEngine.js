'use strict'
/**
 * priorityEngine.js — NEXUS Priority Engine
 *
 * Converts raw task/event attributes into a single numeric priority score.
 * Higher score = should be handled sooner.
 *
 * Score components (max ~30):
 *   urgency    (1–5) × 2.0  → up to 10
 *   importance (1–5) × 3.0  → up to 15
 *   age bonus              → up to  5  (tasks get more urgent over time)
 *   overdue penalty        → +10 if past deadline
 *
 * Exported:
 *   calculatePriority(task) → number
 *   scoreAndSort(tasks)     → tasks[] sorted high→low
 *   rankTasks(tasks)        → tasks[] with .priorityScore added
 */

const MAX_AGE_BONUS = 5

/**
 * calculatePriority(task) → number
 *
 * @param {{
 *   urgency?:    number,    — 1 (low) to 5 (critical), default 1
 *   importance?: number,    — 1 (low) to 5 (critical), default 1
 *   createdAt?:  number,    — ms timestamp
 *   dueAt?:      number,    — ms timestamp (optional)
 * }} task
 * @returns {number}
 */
function calculatePriority(task) {
  const urgency    = Math.min(Math.max(task.urgency    ?? 1, 1), 5)
  const importance = Math.min(Math.max(task.importance ?? 1, 1), 5)

  // Age bonus — ramps from 0 to MAX_AGE_BONUS over 7 days
  const age      = task.createdAt ? Date.now() - task.createdAt : 0
  const ageBonus = Math.min(age / (7 * 24 * 60 * 60 * 1000) * MAX_AGE_BONUS, MAX_AGE_BONUS)

  // Overdue — if past due date, add flat penalty
  const overduePenalty = (task.dueAt && task.dueAt < Date.now()) ? 10 : 0

  return (urgency * 2.0) + (importance * 3.0) + ageBonus + overduePenalty
}

/**
 * rankTasks(tasks) → tasks[] with .priorityScore attached, sorted high→low
 */
function rankTasks(tasks) {
  return tasks
    .map(t => ({ ...t, priorityScore: calculatePriority(t) }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
}

/**
 * scoreAndSort(tasks) → sorted tasks[] (priorityScore not attached)
 * Lighter version when you only need the order.
 */
function scoreAndSort(tasks) {
  return [...tasks].sort((a, b) => calculatePriority(b) - calculatePriority(a))
}

/**
 * topN(tasks, n) → top N highest-priority tasks
 */
function topN(tasks, n = 5) {
  return rankTasks(tasks).slice(0, n)
}

module.exports = { calculatePriority, rankTasks, scoreAndSort, topN }

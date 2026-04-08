'use strict'
/**
 * TaskExecutionAgent.js
 *
 * Goal: Ensure the highest-priority open task is always being worked on.
 *
 * Triggers when:
 *   - There is at least one open/pending task in the queue
 *   - The top task has not been surfaced recently (cooldown)
 *
 * Action: EXECUTE_TASK — surfaces the top-priority task for immediate attention.
 * The execution engine broadcasts it to the UI and logs it.
 *
 * This agent is intentionally passive — it surfaces, it does not delete or modify.
 * Priority: 7 (higher than ProductivityAgent so it runs first)
 * Cooldown: 2 minutes (shows top task to user periodically)
 */

const { GoalAgent } = require('./GoalAgent')

const COOLDOWN_MS = 2 * 60 * 1000   // 2 min

class TaskExecutionAgent extends GoalAgent {
  constructor() {
    super('task-execution', 'Surface and execute the highest-priority task', 7)
    this._lastExecutedId = null
    this._lastExecutedAt = 0
  }

  async evaluate({ tasks }) {
    if (tasks.length === 0) return false

    const topTask = tasks[0]

    // Don't surface the same task twice within the cooldown window
    if (
      topTask.id === this._lastExecutedId &&
      Date.now() - this._lastExecutedAt < COOLDOWN_MS
    ) return false

    return true
  }

  async act({ tasks }) {
    const topTask = tasks[0]
    this._lastExecutedId = topTask.id
    this._lastExecutedAt = Date.now()

    return {
      type:    'EXECUTE_TASK',
      payload: {
        task:   topTask,
        source: 'TaskExecutionAgent',
        ts:     Date.now(),
      },
    }
  }

  onSuccess(result) {
    console.log('[TaskExecutionAgent] Task surfaced:', result?.data?.task?.title ?? result)
  }
}

module.exports = { TaskExecutionAgent }

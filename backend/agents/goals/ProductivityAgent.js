'use strict'
/**
 * ProductivityAgent.js
 *
 * Goal: Improve task completion rate when system productivity is low.
 *
 * Triggers when:
 *   - behaviorScore drops below 0.5 (more than half of actions are errors/failures)
 *   - OR the LOW_PRODUCTIVITY trigger is set by the insight engine
 *   - OR there are > 10 open tasks with no recent completions
 *
 * Action: REPRIORITIZE_TASKS — re-scores all open tasks and promotes
 * the highest-value ones so the agent loop and user both see what matters most.
 *
 * Cooldown: 5 minutes (prevents thrashing on a persistently low score)
 */

const { GoalAgent } = require('./GoalAgent')

const SCORE_THRESHOLD = 0.5
const TASK_THRESHOLD  = 10
const COOLDOWN_MS     = 5 * 60 * 1000   // 5 min

class ProductivityAgent extends GoalAgent {
  constructor() {
    super('productivity', 'Improve task completion rate and system productivity', 6)
    this._lastReprioritized = 0
  }

  async evaluate({ insights, tasks }) {
    // Don't act if we just did
    if (Date.now() - this._lastReprioritized < COOLDOWN_MS) return false

    const lowScore    = (insights.behaviorScore ?? 1) < SCORE_THRESHOLD
    const lowTrigger  = insights.triggers?.includes('LOW_PRODUCTIVITY')
    const manyTasks   = tasks.length > TASK_THRESHOLD

    return lowScore || lowTrigger || manyTasks
  }

  async act({ tasks }) {
    this._lastReprioritized = Date.now()

    return {
      type:    'REPRIORITIZE_TASKS',
      payload: {
        taskCount: tasks.length,
        source:    'ProductivityAgent',
        ts:        Date.now(),
      },
    }
  }

  onSuccess(result) {
    console.log('[ProductivityAgent] Tasks reprioritized:', result)
  }
}

module.exports = { ProductivityAgent }

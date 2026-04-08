'use strict'
/**
 * GoalAgent.js — Base class for all NEXUS Goal-Driven Agents
 *
 * A GoalAgent is an autonomous unit with a stated goal.
 * Each cycle the Decision Engine asks:
 *   1. agent.evaluate(context)  → boolean: should I act right now?
 *   2. agent.act(context)       → ActionPlan | null: what do I do?
 *
 * The returned ActionPlan is forwarded to the Execution Engine.
 *
 * Subclass contract:
 *   - evaluate() MUST return boolean (or Promise<boolean>)
 *   - act()      MUST return { type: string, payload?: any } or null
 *   - Neither method should throw — handle errors internally and return false/null
 *
 * Optional overrides:
 *   - onSuccess(result, context) — called after execution succeeds
 *   - onError(err, context)      — called on execution failure
 */

class GoalAgent {
  /**
   * @param {string} name   — unique identifier
   * @param {string} goal   — human-readable goal description
   * @param {number} [priority=5] — 1 (low) to 10 (critical), used for ordering
   */
  constructor(name, goal, priority = 5) {
    if (!name) throw new Error('GoalAgent requires a name')
    this.name     = name
    this.goal     = goal
    this.priority = priority

    // Runtime tracking (managed by agentLoop)
    this._actCount    = 0
    this._errorCount  = 0
    this._lastActAt   = 0
    this._lastResult  = null
  }

  /**
   * evaluate(context) → Promise<boolean>
   * Should this agent act right now given the current context?
   * Override in subclasses.
   */
  async evaluate(/* context */) {
    return false
  }

  /**
   * act(context) → Promise<ActionPlan | null>
   * What action should this agent produce?
   * Override in subclasses.
   */
  async act(/* context */) {
    return null
  }

  /**
   * onSuccess(result, context) — called by loop after successful execution.
   * Override to add post-action logic (e.g. update internal state).
   */
  onSuccess(/* result, context */) {}

  /**
   * onError(err, context) — called by loop on execution failure.
   */
  onError(err /*, context */) {
    console.error(`[GoalAgent:${this.name}] Error:`, err?.message ?? err)
  }

  toJSON() {
    return {
      name:       this.name,
      goal:       this.goal,
      priority:   this.priority,
      actCount:   this._actCount,
      errorCount: this._errorCount,
      lastActAt:  this._lastActAt,
    }
  }
}

module.exports = { GoalAgent }

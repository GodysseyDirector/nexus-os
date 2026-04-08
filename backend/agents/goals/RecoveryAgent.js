'use strict'
/**
 * RecoveryAgent.js
 *
 * Goal: Detect unhealthy or crashed services and trigger restart.
 *
 * Triggers when:
 *   - global._nexusSystemHealth reports any unhealthy service
 *   - OR an ANOMALY_SPIKE trigger is set (error rate spiking)
 *
 * Action: RESTART_SERVICE — forwards the unhealthy service name to the
 * execution engine, which calls supervisor.restartService(name).
 *
 * Priority: 10 (highest — recovery takes precedence over everything)
 * Cooldown: 60s per service (prevents restart loops)
 */

const { GoalAgent } = require('./GoalAgent')

const COOLDOWN_MS = 60_000   // 60s per service

class RecoveryAgent extends GoalAgent {
  constructor() {
    super('recovery', 'Detect and recover from service failures', 10)
    this._restarted = new Map()   // serviceName → last restart timestamp
  }

  async evaluate({ systemHealth, insights }) {
    const unhealthy = systemHealth?.unhealthyServices ?? []
    const spiking   = insights.triggers?.includes('ANOMALY_SPIKE')

    // At least one service is down AND not recently restarted
    const hasRestartable = unhealthy.some(name => {
      const last = this._restarted.get(name) ?? 0
      return Date.now() - last > COOLDOWN_MS
    })

    return hasRestartable || spiking
  }

  async act({ systemHealth, insights }) {
    const unhealthy = systemHealth?.unhealthyServices ?? []

    // Find first restartable service
    const target = unhealthy.find(name => {
      const last = this._restarted.get(name) ?? 0
      return Date.now() - last > COOLDOWN_MS
    })

    if (target) {
      this._restarted.set(target, Date.now())
      return {
        type:    'RESTART_SERVICE',
        payload: { service: target, source: 'RecoveryAgent', ts: Date.now() },
      }
    }

    // Anomaly spike but no specific service — request diagnostics
    if (insights.triggers?.includes('ANOMALY_SPIKE')) {
      return {
        type:    'LOG',
        payload: { type: 'ANOMALY_SPIKE_DETECTED', ts: Date.now(), triggers: insights.triggers },
      }
    }

    return null
  }

  onSuccess(result) {
    console.log('[RecoveryAgent] Recovery action executed:', result?.type)
  }

  onError(err) {
    console.error('[RecoveryAgent] Recovery failed:', err?.message)
  }
}

module.exports = { RecoveryAgent }

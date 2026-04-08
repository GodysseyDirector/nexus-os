'use strict'
/**
 * rateLimit.js — Simple in-memory rate limiter middleware
 *
 * Limits each IP to MAX_REQUESTS requests per WINDOW_MS.
 * Returns 429 with a JSON error when exceeded.
 *
 * Usage (in server.js):
 *   const { rateLimitMiddleware } = require('./middleware/rateLimit')
 *   // apply before your routes:
 *   server.on('request', (req, res) => {
 *     if (!rateLimitMiddleware(req, res)) return  // request blocked
 *     // ... route handling
 *   })
 */

const MAX_REQUESTS = 10          // requests allowed per window
const WINDOW_MS    = 60_000      // 1 minute

/** @type {Map<string, { count: number, resetAt: number }>} */
const _store = new Map()

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of _store) {
    if (now > entry.resetAt) _store.delete(ip)
  }
}, 5 * 60_000).unref()

/**
 * getClientIp(req) → string
 * Prefers X-Forwarded-For (set by reverse proxies) over socket.remoteAddress.
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * rateLimitMiddleware(req, res) → boolean
 *
 * Returns true if the request is allowed.
 * Returns false (and writes a 429 response) if the limit is exceeded.
 */
function rateLimitMiddleware(req, res) {
  // Only rate-limit AI/API endpoints — skip static files, health checks
  if (!req.url.startsWith('/api/')) return true

  const ip  = getClientIp(req)
  const now = Date.now()

  let entry = _store.get(ip)

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + WINDOW_MS }
    _store.set(ip, entry)
    return true
  }

  entry.count++

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    res.writeHead(429, {
      'Content-Type':  'application/json',
      'Retry-After':   String(retryAfter),
      'X-RateLimit-Limit':     String(MAX_REQUESTS),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset':     String(Math.ceil(entry.resetAt / 1000)),
    })
    res.end(JSON.stringify({ error: 'Rate limit exceeded', retryAfterSeconds: retryAfter }))
    return false
  }

  return true
}

/**
 * getRateLimitStatus(ip) → { count, remaining, resetAt } | null
 * Useful for health/debug endpoints.
 */
function getRateLimitStatus(ip) {
  const entry = _store.get(ip)
  if (!entry) return null
  return {
    count:     entry.count,
    remaining: Math.max(0, MAX_REQUESTS - entry.count),
    resetAt:   entry.resetAt,
  }
}

module.exports = { rateLimitMiddleware, getRateLimitStatus, MAX_REQUESTS, WINDOW_MS }

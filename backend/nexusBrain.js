'use strict'
/**
 * NEXUS Brain — multi-model cognitive loop.
 * Fires on every state mutation and processes inbound commands.
 * Routes to fast/reasoning/fallback based on intent complexity.
 */
const { route, callFast, callReasoning, streamOllama, listModels } = require('./router/modelRouter')
const { classifyIntent } = require('./router/intentRouter')
const { criticCheckResponse } = require('./router/criticLayer')
const { logger } = require('../shared/logger')
const { MODELS } = require('../shared/constants')

// In-memory conversation history per session (keyed by session id)
const conversations = new Map()

const NEXUS_SYSTEM = `You are NEXUS, an intelligent cognitive OS built for Godyssey Director.
You are NOT a chatbot. You are an OS-level intelligence layer — persistent, precise, and proactive.
You manage tasks, calendar, notes, goals, and provide strategic intelligence.
Keep responses concise and direct. When you identify an actionable item, prefix it with [ACTION].
Today's date: ${new Date().toDateString()}.`

/**
 * Fire brain loop on state event.
 * For non-chat events, this is lightweight — just logs and optionally enriches state.
 */
async function fire(event) {
  const { type, payload } = event
  logger.debug({ type }, 'Brain loop fired')

  // Autonomous enrichment for specific event types
  if (type === 'ADD_TASK' && payload?.payload?.title) {
    // Async: categorize/prioritize task in background (non-blocking)
    setImmediate(async () => {
      try {
        const suggestion = await callFast(
          `In one short phrase, suggest a priority level (low/medium/high/critical) and category for this task: "${payload.payload.title}". Reply in format: "priority:medium category:work"`
        )
        logger.debug({ suggestion }, 'Task enrichment')
      } catch {}
    })
  }
}

/**
 * Process a chat message through the brain.
 * Returns a stream — caller provides onChunk(text) callback.
 */
async function chat({ text, sessionId = 'default', history = [], onChunk }) {
  const intent = classifyIntent(text)
  const model  = intent.complexity === 'high' ? MODELS.REASONING : MODELS.FAST

  logger.info({ model, complexity: intent.complexity, type: intent.type }, 'Brain chat')

  // Build conversation
  const conv = conversations.get(sessionId) || []
  const messages = [
    { role: 'system', content: NEXUS_SYSTEM },
    ...conv.slice(-20),
    { role: 'user', content: text }
  ]

  let full = ''
  try {
    await streamOllama(model, messages, chunk => {
      full += chunk
      if (onChunk) onChunk(chunk)
    })

    // Critic check
    const check = criticCheckResponse(full)
    if (!check.ok) {
      const fallback = "I can't respond to that."
      if (onChunk) onChunk(fallback)
      full = fallback
    }

    // Store in conversation history
    conv.push({ role: 'user', content: text })
    conv.push({ role: 'assistant', content: full })
    conversations.set(sessionId, conv.slice(-40))

    return { text: full, model, intent }
  } catch (err) {
    logger.error({ err: err.message, model }, 'Brain chat failed')
    throw err
  }
}

/**
 * Generate greeting message.
 */
async function getGreeting() {
  try {
    const g = await callFast(
      `Generate a short, sharp welcome message for NEXUS OS startup. Reference the time of day (${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}). Max 20 words. No quotes.`
    )
    return g.trim() || 'NEXUS online. Ready when you are, Director.'
  } catch {
    return 'NEXUS online. Ready when you are, Director.'
  }
}

/** Clear session conversation */
function clearSession(sessionId = 'default') {
  conversations.delete(sessionId)
}

module.exports = { fire, chat, getGreeting, clearSession, listModels }

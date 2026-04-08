'use strict'
/**
 * Intent Router — classifies incoming text into type + complexity.
 * Complexity determines which model tier handles it.
 */

const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|yo|sup)\b/i,
  /^(what time|what's the time|current time)/i,
  /^(status|ping|are you|are u)\b/i,
  /^(thanks|thank you|ok|okay|got it|cool|great)\b/i,
]

const SCHEDULE_PATTERNS = [
  /\b(schedule|calendar|appointment|meeting|remind|event|at \d|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(add.*event|create.*meeting|set.*reminder)\b/i,
]

const TASK_PATTERNS = [
  /\b(task|todo|to-do|to do|add task|create task|new task|finish|complete|done with)\b/i,
]

const NOTE_PATTERNS = [
  /\b(note|notes|remember this|save this|jot|write down|memo)\b/i,
]

const COMMAND_PATTERNS = [
  /^\/\w+/,
  /\b(open|close|switch|navigate|go to|show me|display|launch)\b/i,
]

const COMPLEX_PATTERNS = [
  /\b(analyze|analyse|strategy|plan|compare|explain|why|how should|what should|recommend|advise|think about|opinion)\b/i,
  /\b(business|market|intelligence|insight|forecast|predict)\b/i,
]

/**
 * Classify an input string.
 * @returns {{ type: string, complexity: 'low'|'medium'|'high', confidence: number }}
 */
function classifyIntent(text) {
  if (!text || typeof text !== 'string') return { type: 'query', complexity: 'low', confidence: 0.5 }

  const t = text.trim()

  // Simple greetings / status → always low
  if (SIMPLE_PATTERNS.some(p => p.test(t))) {
    return { type: 'query', complexity: 'low', confidence: 0.95 }
  }

  // Commands
  if (COMMAND_PATTERNS.some(p => p.test(t))) {
    return { type: 'command', complexity: 'low', confidence: 0.9 }
  }

  // Tasks
  if (TASK_PATTERNS.some(p => p.test(t))) {
    return { type: 'task', complexity: 'low', confidence: 0.9 }
  }

  // Notes
  if (NOTE_PATTERNS.some(p => p.test(t))) {
    return { type: 'note', complexity: 'low', confidence: 0.85 }
  }

  // Scheduling
  if (SCHEDULE_PATTERNS.some(p => p.test(t))) {
    return { type: 'schedule', complexity: 'medium', confidence: 0.85 }
  }

  // Complex analysis
  if (COMPLEX_PATTERNS.some(p => p.test(t))) {
    return { type: 'query', complexity: 'high', confidence: 0.8 }
  }

  // Default: medium query
  const wordCount = t.split(/\s+/).length
  const complexity = wordCount < 10 ? 'low' : wordCount < 30 ? 'medium' : 'high'
  return { type: 'query', complexity, confidence: 0.6 }
}

module.exports = { classifyIntent }

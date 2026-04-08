'use strict'
/**
 * Model Router — sends prompts to the right model tier via Ollama.
 *
 * FAST   → qwen2.5:7b  (classification, simple queries, quick responses)
 * REASON → qwen3:14b   (complex analysis, multi-step reasoning)
 * CLOUD  → qwen3.5:cloud (fallback when local is overloaded)
 */
const http  = require('http')
const { MODELS, OLLAMA_BASE } = require('../../shared/constants')
const { logger } = require('../../shared/logger')
const { classifyIntent } = require('./intentRouter')
const { criticCheckResponse } = require('./criticLayer')

const OLLAMA_HOST = new URL(OLLAMA_BASE)

/** Call Ollama (non-streaming) */
async function callOllama(model, prompt, system = '') {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      prompt: system ? `${system}\n\n${prompt}` : prompt,
      stream: false,
      options: { temperature: 0.7, num_predict: 1024 },
    })

    const req = http.request({
      hostname: OLLAMA_HOST.hostname,
      port:     OLLAMA_HOST.port || 11434,
      path:     '/api/generate',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let raw = ''
      res.on('data', d => raw += d)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw)
          resolve(parsed.response || '')
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Ollama timeout')) })
    req.write(body)
    req.end()
  })
}

/** Stream from Ollama — calls onChunk(text) for each token */
async function streamOllama(model, messages, onChunk, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature: 0.7 },
    })

    const req = http.request({
      hostname: OLLAMA_HOST.hostname,
      port:     OLLAMA_HOST.port || 11434,
      path:     '/api/chat',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json' },
    }, (res) => {
      let buffer = ''
      res.on('data', chunk => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() // incomplete line
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const json = JSON.parse(line)
            if (json.message?.content) onChunk(json.message.content)
            if (json.done) resolve()
          } catch {}
        }
      })
      res.on('end', () => resolve())
      res.on('error', reject)
    })
    req.on('error', reject)
    if (signal) signal.addEventListener('abort', () => req.destroy())
    req.write(body)
    req.end()
  })
}

/** Route and call appropriate model (non-streaming) */
async function route(input, conversationHistory = []) {
  const intent = classifyIntent(input)
  const model  = intent.complexity === 'high' ? MODELS.REASONING : MODELS.FAST

  logger.debug({ model, intent }, 'Model routing')

  try {
    const messages = [
      ...conversationHistory.slice(-10),
      { role: 'user', content: input }
    ]
    let fullText = ''
    await streamOllama(model, messages, chunk => { fullText += chunk })
    return { text: fullText, model, intent }
  } catch (err) {
    logger.warn({ model, err: err.message }, 'Primary model failed')

    // Fast-path failover: gemma → qwen2.5
    if (model === MODELS.FAST) {
      try {
        let fallText = ''
        await streamOllama(MODELS.FAST_ALT, [{ role: 'user', content: input }], c => { fallText += c })
        return { text: fallText, model: MODELS.FAST_ALT, intent }
      } catch {}
    }

    // Final fallback: cloud / MODELS.FALLBACK
    try {
      const fallback = await callOllama(MODELS.FALLBACK, input)
      return { text: fallback, model: MODELS.FALLBACK, intent }
    } catch (err2) {
      logger.error({ err: err2.message }, 'All models failed')
      return { text: 'Model unavailable — try again shortly', model: 'none', intent, error: true }
    }
  }
}

/**
 * runModel(input) — tiered failover for fast-path calls.
 *
 * Tier 1: gemma3:4b   (fastest, lowest memory)
 * Tier 2: qwen2.5:7b  (fallback if Gemma fails or is not installed)
 * Tier 3: graceful error object (never throws — caller always gets a response)
 */
async function runModel(input) {
  try {
    return await callOllama(MODELS.FAST, input)
  } catch (err) {
    logger.warn({ err: err.message }, `[modelRouter] ${MODELS.FAST} failed — trying ${MODELS.FAST_ALT}`)
    try {
      return await callOllama(MODELS.FAST_ALT, input)
    } catch (err2) {
      logger.error({ err: err2.message }, '[modelRouter] All fast models failed')
      return { error: true, message: 'Model unavailable — try again shortly' }
    }
  }
}

/** Fast call (no streaming) — uses tiered failover */
async function callFast(prompt) {
  return runModel(prompt)
}

/** Reasoning call (non-streaming) */
async function callReasoning(prompt, system = '') {
  return callOllama(MODELS.REASONING, prompt, system)
}

/** List available models from Ollama */
async function listModels() {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_BASE}/api/tags`, res => {
      let raw = ''
      res.on('data', d => raw += d)
      res.on('end', () => {
        try {
          const { models } = JSON.parse(raw)
          resolve(models?.map(m => ({ name: m.name, size: m.size })) || [])
        } catch { resolve([]) }
      })
    })
    req.on('error', () => resolve([]))
  })
}

module.exports = { route, callFast, callReasoning, streamOllama, listModels }

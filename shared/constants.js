'use strict'

const PORT       = parseInt(process.env.PORT || '18790', 10)
const DATA_DIR   = process.env.DATA_DIR  || require('path').join(require('os').homedir(), 'Library', 'Application Support', 'NEXUS')
const STATE_FILE = require('path').join(DATA_DIR, 'state.json')
const LOG_FILE   = require('path').join(DATA_DIR, 'nexus.log')

const MODELS = {
  FAST:      process.env.MODEL_FAST      || 'qwen2.5:7b',
  REASONING: process.env.MODEL_REASONING || 'qwen3:14b',
  FALLBACK:  process.env.MODEL_FALLBACK  || 'qwen3.5:cloud',
  EMBED:     process.env.MODEL_EMBED     || 'mxbai-embed-large:latest',
}

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434'

const WHISPER_PORT = 8765
const TTS_PORT     = 8766

module.exports = { PORT, DATA_DIR, STATE_FILE, LOG_FILE, MODELS, OLLAMA_BASE, WHISPER_PORT, TTS_PORT }

#!/usr/bin/env bash
# NEXUS OS — Start all services in dev mode
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "🧠 Starting NEXUS OS..."

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "  Starting Ollama..."
  ollama serve &>/tmp/ollama.log &
  sleep 3
fi

# Start backend
echo "  Starting gateway (port 18790)..."
node "$ROOT/backend/server.js" &
BACKEND_PID=$!

# Start Python services (if available)
if command -v python3 &>/dev/null; then
  python3 "$ROOT/python-services/whisper-stt/app.py" &>/tmp/whisper.log & 2>/dev/null || true
  python3 "$ROOT/python-services/tts-engine/app.py"  &>/tmp/tts.log    & 2>/dev/null || true
fi

# Wait for backend
echo "  Waiting for gateway..."
for i in {1..20}; do
  curl -sf http://localhost:18790/api/ping &>/dev/null && break
  sleep 0.5
done

echo "✅ NEXUS OS ready → http://localhost:18790"
echo "   Backend PID: $BACKEND_PID"
echo "   Press Ctrl+C to stop all"

wait $BACKEND_PID

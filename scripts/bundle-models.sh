#!/usr/bin/env bash
# Pull required Ollama models and install Python dependencies
set -e

echo "🧠 NEXUS Model Setup"
echo "===================="

# Pull Ollama models
echo ""
echo "Pulling Ollama models..."
ollama pull qwen2.5:7b   && echo "✓ qwen2.5:7b (fast router)"
ollama pull qwen3:14b    && echo "✓ qwen3:14b  (reasoning)"

# Optional: Gemma
read -p "Pull gemma3:4b (optional fast router)? [y/N] " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  ollama pull gemma3:4b && echo "✓ gemma3:4b"
fi

# Python packages
echo ""
echo "Installing Python packages..."
pip3 install faster-whisper 2>/dev/null && echo "✓ faster-whisper" || echo "⚠ faster-whisper install failed"
pip3 install pyinstaller 2>/dev/null && echo "✓ pyinstaller" || echo "⚠ pyinstaller install failed"

# Piper TTS setup
echo ""
echo "Piper TTS setup:"
echo "  1. Download piper binary from: https://github.com/rhasspy/piper/releases"
echo "  2. Download a voice model (.onnx): https://github.com/rhasspy/piper/releases"
echo "     Recommended: en_US-lessac-medium.onnx"
echo "  3. Place piper binary in /usr/local/bin/ or set PIPER_BIN env var"
echo "  4. Place .onnx model in: python-services/tts-engine/models/"

echo ""
echo "✅ Model setup complete"

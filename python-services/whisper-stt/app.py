"""
NEXUS Whisper STT Service
Runs on port 8765. Accepts audio uploads, returns transcript.
Uses faster-whisper for efficiency on CPU/MPS.
"""
import os, sys, io, json, tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(os.environ.get("WHISPER_PORT", 8765))
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "base.en")  # tiny.en / base.en / small.en

# Lazy load model on first request
_model = None

def get_model():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel
            device = "cpu"
            compute = "int8"
            print(f"[Whisper] Loading model: {MODEL_SIZE} on {device}", flush=True)
            _model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute)
            print("[Whisper] Model ready", flush=True)
        except ImportError:
            print("[Whisper] faster-whisper not installed. Run: pip install faster-whisper", flush=True)
            _model = None
    return _model

def transcribe(audio_bytes: bytes, audio_format: str = "wav") -> str:
    model = get_model()
    if model is None:
        return ""
    with tempfile.NamedTemporaryFile(suffix=f".{audio_format}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        segments, info = model.transcribe(tmp_path, beam_size=5, language="en")
        text = " ".join(seg.text.strip() for seg in segments)
        return text.strip()
    finally:
        os.unlink(tmp_path)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default access logs

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "model": MODEL_SIZE})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/transcribe":
            length = int(self.headers.get("Content-Length", 0))
            audio  = self.rfile.read(length)
            fmt    = self.headers.get("X-Audio-Format", "wav")
            try:
                text = transcribe(audio, fmt)
                self._json(200, {"transcript": text, "ok": True})
            except Exception as e:
                self._json(500, {"error": str(e), "ok": False})
        else:
            self._json(404, {"error": "Not found"})

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    print(f"[Whisper] STT service starting on port {PORT}", flush=True)
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[Whisper] Stopped")

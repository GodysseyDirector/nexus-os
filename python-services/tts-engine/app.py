"""
NEXUS Piper TTS HTTP Service — port 8766
POST /synthesize  { "text": "Hello" }  → audio/wav
GET  /health      → { "ok": true }
GET  /stream?text=Hello → streaming PCM audio
"""
import os, json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from engine import speak_to_file, speak_streaming

PORT = int(os.environ.get("TTS_PORT", 8766))

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._json(200, {"ok": True, "engine": "piper"})

        elif parsed.path == "/stream":
            params = parse_qs(parsed.query)
            text   = params.get("text", [""])[0]
            if not text:
                self._json(400, {"error": "text param required"}); return
            try:
                self.send_response(200)
                self.send_header("Content-Type", "audio/pcm")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                for chunk in speak_streaming(text):
                    self.wfile.write(chunk)
            except RuntimeError as e:
                # If piper not installed, send empty audio
                self.send_response(503)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/synthesize":
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length) or b"{}")
            text   = body.get("text", "")
            if not text:
                self._json(400, {"error": "text required"}); return
            try:
                wav_path = speak_to_file(text)
                with open(wav_path, "rb") as f:
                    audio = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", len(audio))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(audio)
            except RuntimeError as e:
                self._json(503, {"error": str(e), "hint": "Install piper TTS"})
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
    print(f"[TTS] Piper service starting on port {PORT}", flush=True)
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[TTS] Stopped")

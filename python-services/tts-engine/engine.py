"""
Piper TTS Engine wrapper.
Piper is a fast, offline, OS-level TTS engine.
Install: see README — download piper binary + model.
"""
import os, subprocess, tempfile, shutil

PIPER_BIN   = os.environ.get("PIPER_BIN",   shutil.which("piper") or "piper")
PIPER_MODEL = os.environ.get("PIPER_MODEL",  os.path.join(os.path.dirname(__file__), "models", "en_US-lessac-medium.onnx"))
OUTPUT_DIR  = tempfile.gettempdir()

def speak_to_file(text: str) -> str:
    """
    Synthesize text to a WAV file. Returns the path to the WAV file.
    Raises RuntimeError if piper is not available.
    """
    if not shutil.which(PIPER_BIN) and not os.path.isfile(PIPER_BIN):
        raise RuntimeError(
            "Piper TTS not found. Install: https://github.com/rhasspy/piper/releases\n"
            "Then set PIPER_BIN env var or add piper to PATH."
        )
    if not os.path.isfile(PIPER_MODEL):
        raise RuntimeError(
            f"Piper model not found at {PIPER_MODEL}.\n"
            "Download from: https://github.com/rhasspy/piper/releases\n"
            "Place .onnx file in python-services/tts-engine/models/"
        )
    out_path = os.path.join(OUTPUT_DIR, "nexus_tts_out.wav")
    result = subprocess.run(
        [PIPER_BIN, "--model", PIPER_MODEL, "--output_file", out_path],
        input=text.encode("utf-8"),
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Piper failed: {result.stderr.decode()}")
    return out_path

def speak_streaming(text: str):
    """
    Stream raw PCM audio bytes from piper (for ultra-low latency).
    Yields chunks of bytes.
    """
    if not shutil.which(PIPER_BIN) and not os.path.isfile(PIPER_BIN):
        raise RuntimeError("Piper not found")
    proc = subprocess.Popen(
        [PIPER_BIN, "--model", PIPER_MODEL, "--output-raw"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    proc.stdin.write(text.encode("utf-8"))
    proc.stdin.close()
    while True:
        chunk = proc.stdout.read(4096)
        if not chunk:
            break
        yield chunk
    proc.wait()

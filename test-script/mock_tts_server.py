#!/usr/bin/env python3
"""
A stand-in OpenAI-compatible speech server for testing Table Read's AI voice
path (issue #131) without an API key or a bill.

Implements the two endpoints OpenDraft's "OpenAI-compatible server" provider
calls — GET /v1/audio/voices and POST /v1/audio/speech — and synthesises the
audio with macOS's `say`, so it runs on a Mac only. Every request is logged.

    python3 test-script/mock_tts_server.py            # http://127.0.0.1:8880/v1
    python3 test-script/mock_tts_server.py --port 9000

Then in OpenDraft: Settings → Table Read Voices → Use an AI voice provider →
OpenAI-compatible server, address http://127.0.0.1:8880/v1.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VOICES = ["Samantha", "Daniel", "Karen", "Moira", "Rishi", "Tessa"]


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") == "/v1/audio/voices":
            self._json(200, {"voices": VOICES})
        else:
            self._json(404, {"error": {"message": f"No route for GET {self.path}"}})

    def do_POST(self):
        if self.path.rstrip("/") != "/v1/audio/speech":
            self._json(404, {"error": {"message": f"No route for POST {self.path}"}})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": {"message": f"Bad JSON: {exc}"}})
            return
        text = str(body.get("input") or "").strip()
        voice = str(body.get("voice") or VOICES[0])
        if not text:
            self._json(400, {"error": {"message": "input is empty"}})
            return
        if voice not in VOICES:
            voice = VOICES[0]
        fd, path = tempfile.mkstemp(suffix=".m4a")
        os.close(fd)
        try:
            subprocess.run(
                ["say", "-v", voice, "-o", path, "--file-format=m4af", "--data-format=aac", text],
                check=True, capture_output=True, timeout=60,
            )
            with open(path, "rb") as f:
                audio = f.read()
        except (subprocess.SubprocessError, OSError) as exc:
            print(f"[mock-tts] synthesis failed: {exc}", file=sys.stderr)
            self._json(500, {"error": {"message": f"synthesis failed: {exc}"}})
            return
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "audio/mp4")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)

    def log_message(self, fmt, *args):
        print(f"[mock-tts] {self.address_string()} {fmt % args}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8880)
    args = ap.parse_args()
    if sys.platform != "darwin":
        sys.exit("This mock uses macOS's `say`; run it on a Mac.")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[mock-tts] listening on http://127.0.0.1:{args.port}/v1", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

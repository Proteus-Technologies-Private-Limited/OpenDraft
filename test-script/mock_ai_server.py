"""
Minimal stand-in for an AI server, for testing OpenDraft AI add-ons without a
real model.

It answers both dialects the add-on speaks:

  POST /v1/chat/completions   OpenAI-compatible (Unsloth Studio, LM Studio…)
  POST /api/chat              Ollama's own API
  GET  /v1/models             the model list, for the add-on's Test connection
  GET  /api/tags              the same, in Ollama's shape

The reply is a fixed line that echoes the last user message in the log. When
the request contains the marker `mock_action`, the reply is a real agent action
(`script_insertAction`) instead, so the preview -> Insert path can be exercised
end to end. `mock_undo` returns only undo calls, which the add-on must refuse:

  Ask the assistant: "mock_action: add an action line"
  Ask the assistant: "mock_undo: try to undo my work"

Usage:  venv/bin/python test-script/mock_ai_server.py [port]   (default 11435)
Then set the add-on's server address to http://localhost:<port>/v1, or to
http://localhost:<port> with the provider set to Ollama.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = "mock-model"
LINE = "Rain hammers the window as SARAH reads the letter again."
ACTION = {
    "tool": "script_insertAction",
    "args": {"text": LINE},
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.rstrip("/")
        if path == "/v1/models":
            self._json(200, {"object": "list", "data": [{"id": MODEL, "object": "model"}]})
        elif path == "/api/tags":
            self._json(200, {"models": [{"name": MODEL}]})
        else:
            self._json(404, {"error": f"no GET {path}"})

    def _answer(self, body):
        messages = body.get("messages") or []
        last = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            "",
        )
        print(
            f"[mock-ai] {self.path.rstrip('/')} model={body.get('model')} "
            f"auth={'yes' if self.headers.get('Authorization') else 'no'} "
            f"user={last[:120]!r}",
            flush=True,
        )
        if "mock_action" in last.lower():
            return json.dumps(ACTION)
        if "mock_undo" in last.lower():
            return json.dumps({"actions": [{"tool": "editor.undo"}, {"tool": "editor.undo"}]})
        if "mock_replace" in last.lower():
            return json.dumps({
                "tool": "editor.replaceSelection",
                "args": {"text": '<img src=x onerror=alert(1)> plain text'},
            })
        return LINE

    def do_POST(self):
        path = self.path.rstrip("/")
        if path not in ("/v1/chat/completions", "/api/chat"):
            self._json(404, {"error": f"no POST {path}"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            answer = self._answer(body)
            if path == "/api/chat":
                self._json(200, {"model": body.get("model"), "message": {"role": "assistant", "content": answer}, "done": True})
            else:
                self._json(200, {"choices": [{"message": {"role": "assistant", "content": answer}}]})
        except Exception as err:  # report rather than crash the test server
            print(f"[mock-ai] error: {err}", flush=True)
            self._json(500, {"error": str(err)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11435
    print(f"[mock-ai] listening on http://localhost:{port}/v1", flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()

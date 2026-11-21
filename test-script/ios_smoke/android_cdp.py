"""Evaluate JavaScript in OpenDraft's Android WebView over Chrome DevTools.

A debug build's WebView exposes `@webview_devtools_remote_<pid>`; this forwards
it to a local port with adb, finds OpenDraft's page in /json and speaks the
DevTools protocol over a minimal WebSocket (stdlib only — no pip installs).
"""
import base64
import json
import os
import socket
import struct
import subprocess
import time
import urllib.request
from urllib.parse import urlparse

ADB = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
PACKAGE = "com.proteus.opendraft"


class JavaScriptError(RuntimeError):
    """The page ran the snippet and it threw."""


def adb(*args: str, serial: str | None = None, timeout: float = 30) -> str:
    cmd = [ADB] + (["-s", serial] if serial else []) + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


class WebSocket:
    """Just enough RFC 6455 for DevTools: text frames, client-masked, no extensions."""

    def __init__(self, url: str, timeout: float = 30.0):
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port or 80), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("DevTools closed the connection during the handshake")
            response += chunk
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise ConnectionError(f"WebSocket handshake refused: {response[:200]!r}")
        self.buffer = response.split(b"\r\n\r\n", 1)[1]

    def send(self, text: str) -> None:
        payload = text.encode()
        header = bytes([0x81])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _read(self, n: int) -> bytes:
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("DevTools closed the connection")
            self.buffer += chunk
        out, self.buffer = self.buffer[:n], self.buffer[n:]
        return out

    def recv(self) -> str:
        message = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            data = self._read(n)
            opcode = b0 & 0x0F
            if opcode == 0x8:
                raise ConnectionError("DevTools closed the socket")
            if opcode in (0x9, 0xA):  # ping / pong — not expected from DevTools; ignore
                continue
            message += data
            if b0 & 0x80:
                return message.decode()

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


class AndroidWebView:
    def __init__(self, serial: str | None = None, port: int = 9333):
        self.serial = serial
        self.port = port
        self.ws: WebSocket | None = None
        self.next_id = 0

    def connect(self, timeout: float = 30.0) -> None:
        deadline = time.time() + timeout
        last = "no WebView DevTools socket yet"
        while time.time() < deadline:
            try:
                pid = adb("shell", "pidof", PACKAGE, serial=self.serial).strip().split()[0]
                sockets = adb("shell", "cat", "/proc/net/unix", serial=self.serial)
                name = f"webview_devtools_remote_{pid}"
                if name not in sockets:
                    raise RuntimeError(f"{name} not open — is this a debug build?")
                adb("forward", f"tcp:{self.port}", f"localabstract:{name}", serial=self.serial)
                pages = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json", timeout=10).read())
                page = next((p for p in pages if p.get("type") == "page" and "tauri.localhost" in p.get("url", "")), None)
                if not page:
                    raise RuntimeError(f"OpenDraft page not listed yet: {[p.get('url') for p in pages]}")
                ws_url = page["webSocketDebuggerUrl"].replace("localhost", "127.0.0.1")
                self.ws = WebSocket(ws_url, timeout=20.0)
                return
            except (RuntimeError, OSError, IndexError, ValueError) as error:
                last = f"{type(error).__name__}: {error}"
                time.sleep(1.5)
        raise RuntimeError(f"Could not reach OpenDraft's WebView: {last}")

    def evaluate(self, expression: str) -> str:
        # During a cold start the WebView can swap the page out from under an
        # early connection, which then just goes quiet: reconnect once.
        try:
            return self._evaluate(expression)
        except (socket.timeout, TimeoutError, ConnectionError, OSError):
            self.close()
            self.ws = None
            self.connect()
            return self._evaluate(expression)

    def _evaluate(self, expression: str) -> str:
        if self.ws is None:
            self.connect()
        self.next_id += 1
        my_id = self.next_id
        self.ws.send(json.dumps({"id": my_id, "method": "Runtime.evaluate",
                                 "params": {"expression": expression, "returnByValue": True}}))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") != my_id:
                continue  # an event, or a reply to something else
            if "error" in message:
                raise JavaScriptError(json.dumps(message["error"]))
            result = message.get("result", {})
            if result.get("exceptionDetails"):
                detail = result.get("result", {}).get("description") or json.dumps(result["exceptionDetails"])
                raise JavaScriptError(detail)
            value = result.get("result", {}).get("value")
            return value if isinstance(value, str) else json.dumps(value)

    def screenshot(self, path: str) -> None:
        cmd = [ADB] + (["-s", self.serial] if self.serial else []) + ["exec-out", "screencap", "-p"]
        png = subprocess.run(cmd, capture_output=True, timeout=30, check=True).stdout
        with open(path, "wb") as f:
            f.write(png)

    def close(self) -> None:
        if self.ws:
            self.ws.close()

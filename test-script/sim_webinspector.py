#!/usr/bin/env python3
"""Evaluate JavaScript in OpenDraft's WKWebView on an iOS simulator.

Talks to the simulator's webinspectord socket directly (the one Safari's
Develop menu uses), so layout can be measured exactly instead of read off
screenshots. Needs a debug build (inspectable web view) running in a booted
simulator.

    python3 test-script/sim_webinspector.py 'JSON.stringify({w: innerWidth})'
    python3 test-script/sim_webinspector.py --file probe.js

Prints the value the expression returns (returnByValue). Exits non-zero, with
the reason, when no inspectable OpenDraft page is found or evaluation fails.
"""
import argparse
import glob
import json
import plistlib
import socket
import struct
import subprocess
import sys
import uuid

APP_BUNDLE = "com.proteus.opendraft"


def find_socket() -> str:
    # Old boots leave their socket files behind; the live one is the one
    # launchd_sim holds open, which lsof reports.
    try:
        import subprocess
        out = subprocess.run(["lsof", "-U"], capture_output=True, text=True, timeout=20).stdout
        live = sorted({line.split()[-1] for line in out.splitlines() if "webinspectord_sim.socket" in line})
        if live:
            return live[-1]
    except (OSError, subprocess.SubprocessError) as error:
        print(f"lsof unavailable ({error}); falling back to a glob", file=sys.stderr)
    paths = glob.glob("/private/var/tmp/com.apple.launchd.*/com.apple.webinspectord_sim.socket")
    paths += glob.glob("/private/tmp/com.apple.launchd.*/com.apple.webinspectord_sim.socket")
    if not paths:
        sys.exit("No simulator webinspectord socket found. Is a simulator booted?")
    return paths[0]


class Inspector:
    def __init__(self, path: str, timeout: float = 10.0):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(timeout)
        self.sock.connect(path)
        self.conn = str(uuid.uuid4()).upper()
        self.sender = str(uuid.uuid4()).upper()

    def send(self, selector: str, argument: dict) -> None:
        payload = plistlib.dumps({"__selector": selector, "__argument": argument}, fmt=plistlib.FMT_BINARY)
        self.sock.sendall(struct.pack(">I", len(payload)) + payload)

    def _read_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("webinspectord closed the connection")
            buf += chunk
        return buf

    def recv(self) -> dict:
        (length,) = struct.unpack(">I", self._read_exact(4))
        return plistlib.loads(self._read_exact(length))

    def close(self, base: dict) -> None:
        """Detach from the page: a session left attached can block the next one."""
        try:
            self.send("_rpc_forwardDidClose:", base)
        except OSError as error:
            print(f"Could not detach cleanly: {error!r}", file=sys.stderr)
        finally:
            self.sock.close()

    def wait_for(self, selector: str) -> dict:
        while True:
            msg = self.recv()
            if msg.get("__selector") == selector:
                return msg["__argument"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("expression", nargs="?", help="JavaScript expression to evaluate")
    parser.add_argument("--file", help="read the expression from a file")
    parser.add_argument("--socket", help="webinspectord_sim socket of one simulator (default: the newest live one)")
    parser.add_argument("--list-sockets", action="store_true", help="print the live simulator sockets and exit")
    args = parser.parse_args()
    if args.list_sockets:
        out = subprocess.run(["lsof", "-U"], capture_output=True, text=True, timeout=20).stdout
        print("\n".join(sorted({line.split()[-1] for line in out.splitlines() if "webinspectord_sim.socket" in line})))
        return 0
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            expression = fh.read()
    elif args.expression:
        expression = args.expression
    else:
        parser.error("give an expression or --file")

    try:
        ins = Inspector(args.socket or find_socket())
        ins.send("_rpc_reportIdentifier:", {"WIRConnectionIdentifierKey": ins.conn})
        apps = ins.wait_for("_rpc_reportConnectedApplicationList:")["WIRApplicationDictionaryKey"]
        app_id = next((k for k, v in apps.items() if v.get("WIRApplicationBundleIdentifierKey") == APP_BUNDLE), None)
        if not app_id:
            names = [v.get("WIRApplicationBundleIdentifierKey") for v in apps.values()]
            sys.exit(f"OpenDraft is not running or not inspectable. Inspectable apps: {names}")

        ins.send("_rpc_forwardGetListing:", {"WIRConnectionIdentifierKey": ins.conn, "WIRApplicationIdentifierKey": app_id})
        listing = ins.wait_for("_rpc_applicationSentListing:")["WIRListingKey"]
        if not listing:
            sys.exit("OpenDraft has no inspectable page (release build?).")
        page_id = next(iter(listing.values()))["WIRPageIdentifierKey"]

        base = {"WIRConnectionIdentifierKey": ins.conn, "WIRApplicationIdentifierKey": app_id,
                "WIRPageIdentifierKey": page_id, "WIRSenderKey": ins.sender}
        ins.send("_rpc_forwardSocketSetup:", {**base, "WIRAutomaticallyPause": False})

        # Current WebKit routes commands through a page target.
        target_id = None
        evaluate = {"id": 1, "method": "Runtime.evaluate",
                    "params": {"expression": expression, "returnByValue": True, "awaitPromise": True}}
        while True:
            msg = ins.recv()
            if msg.get("__selector") != "_rpc_applicationSentData:":
                continue
            data = json.loads(msg["__argument"]["WIRMessageDataKey"])
            if data.get("method") == "Target.targetCreated" and target_id is None:
                target_id = data["params"]["targetInfo"]["targetId"]
                outer = {"id": 100, "method": "Target.sendMessageToTarget",
                         "params": {"targetId": target_id, "message": json.dumps(evaluate)}}
                ins.send("_rpc_forwardSocketData:", {**base, "WIRSocketDataKey": json.dumps(outer).encode()})
                continue
            if data.get("method") == "Target.dispatchMessageFromTarget":
                inner = json.loads(data["params"]["message"])
                if inner.get("id") != 1:
                    continue
                result = inner.get("result", {})
                if inner.get("error") or result.get("wasThrown"):
                    print(json.dumps(inner, indent=1), file=sys.stderr)
                    ins.close(base)
                    return 1
                value = result.get("result", {}).get("value")
                print(value if isinstance(value, str) else json.dumps(value, indent=1))
                ins.close(base)
                return 0
    except (OSError, ConnectionError, KeyError, StopIteration, ValueError) as error:
        print(f"Web inspector error: {error!r}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

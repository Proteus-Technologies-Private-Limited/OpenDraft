#!/usr/bin/env python3
"""Drive the OpenDraft simulators for App Store screenshots.

    sim.py <duo|iphone|ipad|se> eval '<js expression>'
    sim.py <duo|iphone|ipad|se> file path/to/snippet.js
    sim.py <duo|iphone|ipad|se> shot <name>      -> test-script/output/appstore/raw/<name>.png

Every eval is prefixed with lib.js (helpers under `od.`). The simulator is
picked by the width of its web view, since a webinspectord socket does not
say which device owns it. Needs debug builds and an unsandboxed shell.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
INSPECT = ROOT / "test-script" / "sim_webinspector.py"
sys.path.insert(0, str(ROOT / "test-script"))
from sim_webinspector import APP_BUNDLE, Inspector  # noqa: E402  (path set just above)
RAW = ROOT / "test-script" / "output" / "appstore" / "raw"
UDID = {
    "duo": "35E880EF-E924-4C22-92E1-FF2CE809F96B",
    "iphone": "07467400-B74B-4B11-B494-977D4B14D1A3",
    "ipad": "595C3409-8D0C-458D-BD3F-5E931C012BBF",
    "se": "BA5AEA8E-12E9-4024-8BF1-ABC8D3B2FB6A",
}


class JavaScriptError(RuntimeError):
    """The page ran the snippet and it threw."""


def kind_for(width: int, height: int) -> str:
    if width in (402,) or (width == 874 and height == 402):
        return "iphone"
    if width == 375 or (width == 667 and height == 375):
        return "se"
    if width in (820, 1180):
        return "ipad"
    return "duo"  # 466 on the cover, ~951 open, and whatever a rotation gives


def evaluate_once(socket_path: str, expression: str) -> str:
    """One inspector session: find OpenDraft's page, evaluate, detach.

    sim_webinspector.py takes the first application list as complete, but the
    list sometimes arrives without the app and is corrected a moment later, so
    this waits for the app to appear before giving up.
    """
    ins = Inspector(socket_path, timeout=12.0)
    base = None
    try:
        ins.send("_rpc_reportIdentifier:", {"WIRConnectionIdentifierKey": ins.conn})
        app_id, deadline = None, time.time() + 10
        while app_id is None:
            if time.time() > deadline:
                raise RuntimeError("OpenDraft never appeared in the inspector's application list")
            message = ins.recv()
            selector, argument = message.get("__selector"), message.get("__argument", {})
            if selector == "_rpc_reportConnectedApplicationList:":
                apps = argument.get("WIRApplicationDictionaryKey", {})
            elif selector in ("_rpc_applicationConnected:", "_rpc_applicationUpdated:"):
                apps = {argument.get("WIRApplicationIdentifierKey"): argument}
            else:
                continue
            app_id = next((key for key, value in apps.items()
                           if value.get("WIRApplicationBundleIdentifierKey") == APP_BUNDLE), None)

        ins.send("_rpc_forwardGetListing:", {"WIRConnectionIdentifierKey": ins.conn, "WIRApplicationIdentifierKey": app_id})
        # Like the application list, the page listing can arrive empty first.
        listing, deadline = None, time.time() + 10
        while not listing:
            if time.time() > deadline:
                raise RuntimeError("OpenDraft has no inspectable page yet")
            listing = ins.wait_for("_rpc_applicationSentListing:").get("WIRListingKey")
        page_id = next(iter(listing.values()))["WIRPageIdentifierKey"]
        base = {"WIRConnectionIdentifierKey": ins.conn, "WIRApplicationIdentifierKey": app_id,
                "WIRPageIdentifierKey": page_id, "WIRSenderKey": ins.sender}
        ins.send("_rpc_forwardSocketSetup:", {**base, "WIRAutomaticallyPause": False})

        request = {"id": 1, "method": "Runtime.evaluate",
                   "params": {"expression": expression, "returnByValue": True}}
        sent = False
        while True:
            message = ins.recv()
            if message.get("__selector") != "_rpc_applicationSentData:":
                continue
            data = json.loads(message["__argument"]["WIRMessageDataKey"])
            if data.get("method") == "Target.targetCreated" and not sent:
                outer = {"id": 100, "method": "Target.sendMessageToTarget",
                         "params": {"targetId": data["params"]["targetInfo"]["targetId"], "message": json.dumps(request)}}
                ins.send("_rpc_forwardSocketData:", {**base, "WIRSocketDataKey": json.dumps(outer).encode()})
                sent = True
            elif data.get("method") == "Target.dispatchMessageFromTarget":
                inner = json.loads(data["params"]["message"])
                if inner.get("id") != 1:
                    continue
                result = inner.get("result", {})
                if inner.get("error") or result.get("wasThrown"):
                    detail = result.get("result", {}).get("description") or json.dumps(inner)
                    raise JavaScriptError(detail)
                value = result.get("result", {}).get("value")
                return value if isinstance(value, str) else json.dumps(value)
    finally:
        if base is not None:
            ins.close(base)
        else:
            ins.sock.close()


def run_inspector(socket_path: str, expression: str, tries: int = 6) -> str:
    # webinspectord stalls or drops a session opened right after another one
    # closed, so transport failures are retried after a pause.
    last = "inspector failed"
    for attempt in range(tries):
        if attempt:
            time.sleep(2.5)
        try:
            return evaluate_once(socket_path, expression)
        except JavaScriptError:
            raise  # the page answered; retrying would only repeat the error
        except (OSError, KeyError, StopIteration, ValueError, RuntimeError) as error:
            last = f"{type(error).__name__}: {error}"
    raise RuntimeError(last)


CACHE = RAW / ".sockets.json"


def socket_for(device: str, refresh: bool = False) -> str:
    cached = {}
    if CACHE.exists() and not refresh:
        try:
            cached = json.loads(CACHE.read_text())
        except ValueError:
            cached = {}
    if device in cached and Path(cached[device]).exists():
        return cached[device]
    listing = subprocess.run([sys.executable, str(INSPECT), "--list-sockets"],
                             capture_output=True, text=True, timeout=30).stdout.split()
    seen, found = {}, {}
    for path in listing:
        time.sleep(1.5)
        try:
            size = json.loads(run_inspector(path, "JSON.stringify([innerWidth, innerHeight])"))
        except (RuntimeError, ValueError) as error:
            seen[path] = f"unreadable: {error}"
            continue
        found[kind_for(*size)] = path
        seen[path] = f"{kind_for(*size)} {size}"
    RAW.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(found, indent=1))
    if device not in found:
        raise SystemExit(f"No inspectable web view for '{device}'. Saw: {seen}")
    return found[device]


def evaluate(device: str, expression: str) -> str:
    lib = (HERE / "lib.js").read_text() if (HERE / "lib.js").exists() else ""
    return run_inspector(socket_for(device), f"(()=>{{{lib}\nreturn ({expression});}})()")


def shot(device: str, name: str) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    out = RAW / f"{name}.png"
    time.sleep(1.2)  # let the web view paint the step that came just before
    command = ["xcrun", "simctl", "io", UDID[device], "screenshot", "--type=png"]
    if device == "duo":
        # The Duo has two panels: 1 is the cover, 3 the inner screen.
        # Ask the hinge, not the size: the cover in landscape is wider than 600 too.
        inner = json.loads(run_inspector(socket_for("duo"), "JSON.stringify((window.__opendraftNativeFold || {}).hinge !== 'closed')"))
        command.append(f"--display={3 if inner else 1}")
    result = subprocess.run(command + [str(out)], capture_output=True, text=True, timeout=90)
    if result.returncode != 0 or not out.exists():
        raise SystemExit(f"screenshot failed: {result.stderr.strip()}")
    return out


def main() -> int:
    if len(sys.argv) < 4 or sys.argv[1] not in UDID or sys.argv[2] not in ("eval", "file", "shot"):
        print(__doc__, file=sys.stderr)
        return 2
    device, action, arg = sys.argv[1], sys.argv[2], sys.argv[3]
    try:
        if action == "shot":
            print(shot(device, arg))
        else:
            print(evaluate(device, Path(arg).read_text() if action == "file" else arg))
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

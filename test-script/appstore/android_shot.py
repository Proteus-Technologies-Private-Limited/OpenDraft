#!/usr/bin/env python3
"""Drive the OpenDraft Android emulator for Google Play screenshots.

    android_shot.py status-bar on|off      clean clock/battery/signal for captures (system demo mode)
    android_shot.py load                   load "The Last Reel" into the open editor
    android_shot.py eval '<js expression>' run JavaScript in the app (lib.js helpers are under `od.`)
    android_shot.py file path/to/snippet.js
    android_shot.py shot <name>            -> test-script/output/appstore/raw/<name>.png

Options (before the command):  --serial emulator-5556   --port 9334

Needs a DEBUG build installed on the emulator, because only a debuggable
WebView opens a DevTools socket. Uses its own forwarded port (9334) so it can
run beside other adb/DevTools sessions (the iOS/Android smoke test uses 9333).

The DevTools plumbing is test-script/ios_smoke/android_cdp.py.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "test-script" / "ios_smoke"))
sys.path.insert(0, str(HERE))
from android_cdp import AndroidWebView, JavaScriptError, adb  # noqa: E402
from demo_script import load_expression  # noqa: E402

RAW = ROOT / "test-script" / "output" / "appstore" / "raw"
LIB = (HERE / "lib.js").read_text()


def demo_mode(serial, on: bool) -> None:
    """The system's own demo mode: fixed 9:41 clock, full battery, no notification icons."""
    if not on:
        adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "exit", serial=serial)
        return
    adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1", serial=serial)
    for args in (
        ["-e", "command", "enter"],
        ["-e", "command", "clock", "-e", "hhmm", "0941"],
        ["-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false"],
        ["-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4", "-e", "fully", "true"],
        ["-e", "command", "network", "-e", "mobile", "hide"],
        ["-e", "command", "notifications", "-e", "visible", "false"],
    ):
        adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", *args, serial=serial)


def main(argv: list) -> int:
    serial, port = None, 9334
    while argv and argv[0].startswith("--"):
        flag = argv.pop(0)
        if flag == "--serial":
            serial = argv.pop(0)
        elif flag == "--port":
            port = int(argv.pop(0))
        else:
            print(f"unknown option {flag}", file=sys.stderr)
            return 2
    if not argv:
        print(__doc__)
        return 2
    command, rest = argv[0], argv[1:]

    if command == "status-bar":
        if rest not in (["on"], ["off"]):
            print("usage: status-bar on|off", file=sys.stderr)
            return 2
        demo_mode(serial, rest == ["on"])
        return 0

    view = AndroidWebView(serial=serial, port=port)
    try:
        if command == "shot":
            if not rest:
                print("usage: shot <name>", file=sys.stderr)
                return 2
            RAW.mkdir(parents=True, exist_ok=True)
            out = RAW / f"{rest[0]}.png"
            view.screenshot(str(out))
            print(f"wrote {out}")
            return 0
        # An expression is returned as it is; a file is a function body and returns for itself.
        if command == "load":
            body = f"return {load_expression()};"
        elif command == "eval" and rest:
            body = f"return {rest[0]};"
        elif command == "file" and rest:
            body = Path(rest[0]).read_text()
        else:
            print(__doc__)
            return 2
        print(view.evaluate(f"(() => {{\n{LIB}\n{body}\n}})()"))
        return 0
    except JavaScriptError as error:
        print(f"JavaScript error: {error}", file=sys.stderr)
        return 1
    except (RuntimeError, OSError, ConnectionError, json.JSONDecodeError) as error:
        print(f"android_shot failed: {error}", file=sys.stderr)
        return 1
    finally:
        view.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

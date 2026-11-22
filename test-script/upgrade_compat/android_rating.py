#!/usr/bin/env python3
"""The store-rating request in the Android app (debug build, over Chrome DevTools).

    venv/bin/python test-script/upgrade_compat/android_rating.py [--serial emulator-5554]

A sideloaded build never gets Play's real sheet — requestReviewFlow fails and
MainActivity logs "review flow unavailable" — so this checks the wiring around
it: Help has Rate OpenDraft…, nothing is asked while the export's share chooser
is in front (MainActivity logs "review request skipped"), the request goes out
once the chooser is closed, it is counted once, and the app keeps running.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path[:0] = [str(HERE), str(ROOT / "test-script" / "ios_smoke")]
import ios_upgrade as u  # noqa: E402
from android_cdp import ADB, PACKAGE, AndroidWebView, adb  # noqa: E402

OUT = ROOT / "test-script" / "output" / "store_rating" / "android"
KEY = "opendraft.storeReview.v1"
DAY = 24 * 3600 * 1000
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  — {detail}")


def logcat(serial: str | None) -> str:
    return adb("logcat", "-d", "-s", "OpenDraft:*", serial=serial, timeout=30)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    view = AndroidWebView(args.serial)
    view.connect(60)
    app = u.App(view)
    if not app.wait_for("window.__odBooted === true", 60):
        raise SystemExit("app did not start")

    def state():
        return json.loads(app.js(f"return localStorage.getItem({json.dumps(KEY)}) || 'null';") or "null") or {}

    def set_due():
        s = {"firstSeen": int(time.time() * 1000) - 10 * DAY, "sessions": 6, "moments": 1,
             "lastAsked": None, "askedVersion": None, "asks": 0}
        app.js(f"localStorage.setItem({json.dumps(KEY)}, {json.dumps(json.dumps(s))}); return true;")

    def alive() -> bool:
        return bool(adb("shell", "pidof", PACKAGE, serial=args.serial).strip())

    # A reinstall can leave "Recover unsaved changes?" up; the rating waits
    # for any open dialog, so clear it first.
    app.js("const b=[...document.querySelectorAll('.dialog-box button')].find(b=>b.offsetParent&&b.textContent.trim()==='Discard'); b&&b.click(); return !!b;")
    time.sleep(1)
    # A script with content to export.
    if app.js("return document.querySelectorAll('.ProseMirror [data-type=character]').length;") < 3:
        app.js("const b=[...document.querySelectorAll('button')].find(b=>/Sample Script/.test(b.textContent)); b&&b.click(); return !!b;")
        app.wait_for("document.querySelectorAll('.ProseMirror [data-type=character]').length > 3", 20)

    app.menu("Help")
    time.sleep(0.8)
    check("menu: Help has Rate OpenDraft…",
          app.js("return [...document.querySelectorAll('[role=menuitem]')].some(e => e.offsetParent && /Rate OpenDraft/.test(e.textContent));"))
    app.menu("Help")
    time.sleep(0.5)

    adb("logcat", "-c", serial=args.serial)
    set_due()
    exported = app.menu("File", "Export", "Fountain (.fountain)")
    check("export opens the share chooser", exported)
    time.sleep(9)  # past the 4 s delay and one retry
    view.screenshot(str(OUT / "chooser_open.png"))
    log = logcat(args.serial)
    check("not asked while the chooser is in front", state().get("asks", 0) == 0, json.dumps(state()))
    # The page reports hidden while the chooser is in front, so the request
    # waits in JS; MainActivity's own window-focus check is the backstop and
    # logs "review request skipped" if it is ever reached.
    check("no request reached Play while the chooser was open", "review flow" not in log and "review request failed" not in log,
          "page waited" if "review request skipped" not in log else "native backstop declined")
    adb("shell", "input", "keyevent", "4", serial=args.serial)  # Back closes the chooser
    asked = None
    start = time.time()
    while time.time() - start < 12:
        if state().get("asks", 0) > 0:
            asked = time.time() - start
            break
        time.sleep(0.5)
    check("asked once the chooser closed", asked is not None, f"{asked:.1f}s" if asked else json.dumps(state()))
    st = state()
    check("counted once, for this version", st.get("asks") == 1 and bool(st.get("askedVersion")) and st.get("moments") == 0, json.dumps(st))
    time.sleep(3)
    log = logcat(args.serial)
    check("Play answered (sideloaded: no sheet, logged)", "review flow unavailable" in log or "review request failed" in log,
          next((line[-120:] for line in log.splitlines() if "review" in line and "skipped" not in line), "no log line"))
    view.screenshot(str(OUT / "after_request.png"))
    check("app still running", alive())
    check("page still responds", app.js("return window.__odBooted === true;"))

    passed = sum(ok for _, ok, _ in results)
    print(f"\nandroid store rating: {passed}/{len(results)} passed")
    (OUT / "results.json").write_text(json.dumps(results, indent=1))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

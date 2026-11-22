#!/usr/bin/env python3
"""The store-rating request on an iOS simulator: when it asks, and that it stays out of the way.

A development build shows StoreKit's sheet every time it is asked, so the
simulator shows exactly when a request goes out. Each case starts from counters
written straight into localStorage (opendraft.storeReview.v1) and watches them:
`asks` goes up only when the native side made a request.

    OD_SIM_UDID=<udid> venv/bin/python test-script/upgrade_compat/ios_rating.py

Cases:
  menu        Help has "Rate OpenDraft…" on iOS
  not_due     a new install exports: nothing is asked
  share_sheet due, export: not asked while the share sheet is open; asked
              (sheet on screen) once it is closed
  typing      due, export, writer keeps typing: not asked until 4 s after the
              last key
  dialog      due, export, a dialog open: not asked until it closes
Screenshots go to test-script/output/store_rating/.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import ios_upgrade as u  # noqa: E402

OUT = ROOT / "test-script" / "output" / "store_rating"
IDB = ROOT / "venv" / "bin" / "idb"
KEY = "opendraft.storeReview.v1"
DAY = 24 * 3600 * 1000

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  — {detail}")


class Rating:
    def __init__(self, app: u.App):
        self.app = app
        OUT.mkdir(parents=True, exist_ok=True)

    def shot(self, name: str) -> Path:
        path = OUT / f"{name}.png"
        subprocess.run(["xcrun", "simctl", "io", self.app.backend.udid, "screenshot", str(path)], capture_output=True, timeout=30)
        return path

    def set_state(self, due: bool) -> None:
        state = ({"firstSeen": int(time.time() * 1000) - 10 * DAY, "sessions": 6, "moments": 1,
                  "lastAsked": None, "askedVersion": None, "asks": 0}
                 if due else {"firstSeen": int(time.time() * 1000), "sessions": 1, "moments": 0,
                              "lastAsked": None, "askedVersion": None, "asks": 0})
        self.app.js(f"localStorage.setItem({json.dumps(KEY)}, {json.dumps(json.dumps(state))}); return true;")

    def state(self) -> dict:
        return json.loads(self.app.js(f"return localStorage.getItem({json.dumps(KEY)}) || 'null';") or "null")

    def export_fountain(self) -> bool:
        ok = self.app.menu("File", "Export", "Fountain (.fountain)")
        if not ok:
            ok = self.app.menu("File", "Export", "Fountain")
        return ok

    def native_log(self, since_s: int = 120) -> str:
        out = subprocess.run(["xcrun", "simctl", "spawn", self.app.backend.udid, "log", "show", "--last", f"{since_s}s",
                              "--predicate", 'process == "OpenDraft" AND eventMessage CONTAINS "rating request"'],
                             capture_output=True, text=True, timeout=60).stdout
        return "\n".join(line for line in out.splitlines() if "rating request" in line)

    def tap(self, x: int, y: int) -> None:
        subprocess.run([str(IDB), "ui", "tap", "--udid", self.app.backend.udid, str(x), str(y)],
                       capture_output=True, timeout=30, env={**os.environ, "PATH": "/opt/homebrew/bin:" + os.environ.get("PATH", "")})

    def asked_within(self, seconds: float) -> float | None:
        """Seconds until `asks` went up, or None."""
        start = time.time()
        while time.time() - start < seconds:
            s = self.state() or {}
            if s.get("asks", 0) > 0:
                return time.time() - start
            time.sleep(0.5)
        return None

    def dismiss_share_sheet(self) -> None:
        # Finish the export the way a writer does: pick an action. Copy sits
        # here in the 13-inch iPad's centred share sheet (points); taps outside
        # the sheet do not close it on iPadOS 27.
        self.tap(387, 786)
        time.sleep(1.0)


def main() -> int:
    app = u.App(u.PersistentIOS(u.udid()))
    r = Rating(app)
    if not app.wait_for("window.__odBooted === true", 45):
        raise SystemExit("app did not start")
    app.js("document.querySelector('.ProseMirror')?.blur(); return true;")

    # menu
    app.menu("Help")
    time.sleep(0.6)
    has = app.js("return [...document.querySelectorAll('[role=menuitem]')].some(e => e.offsetParent && /Rate OpenDraft/.test(e.textContent));")
    check("menu: Help has Rate OpenDraft…", has)
    app.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelector('.ProseMirror')?.click(); return true;")
    app.menu("Help")  # toggle closed
    time.sleep(0.5)

    # not_due
    r.set_state(due=False)
    r.export_fountain()
    time.sleep(2)
    r.shot("not_due_share_sheet")
    r.dismiss_share_sheet()
    t = r.asked_within(10)
    check("not_due: a new install is not asked", t is None, json.dumps(r.state()))

    # share_sheet
    r.set_state(due=True)
    r.export_fountain()
    time.sleep(1)
    t = r.asked_within(9)
    r.shot("due_share_sheet_still_open")
    check("share_sheet: not asked while the share sheet is open", t is None)
    log = r.native_log(30)
    check("share_sheet: native side reported it covered", "is on screen" in log, log.splitlines()[-1][-120:] if log else "no log line")
    r.dismiss_share_sheet()
    t = r.asked_within(10)
    time.sleep(1.5)
    r.shot("due_after_share_sheet_closed")
    check("share_sheet: asked once it closed", t is not None, f"{t:.1f}s after closing" if t else json.dumps(r.state()))
    st = r.state() or {}
    check("share_sheet: counted once, for this version", st.get("asks") == 1 and st.get("askedVersion") and st.get("moments") == 0, json.dumps(st))
    # Close StoreKit's sheet (it sits in the middle; "Not Now" is under it).
    r.tap(516, 804)
    time.sleep(1.5)
    r.shot("after_storekit_closed")

    # typing
    r.set_state(due=True)
    r.export_fountain()
    time.sleep(1)
    r.dismiss_share_sheet()
    # Keep "typing" for 12 s: a key every 0.8 s.
    app.js("window.__typer = setInterval(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })), 800); setTimeout(() => clearInterval(window.__typer), 12000); return true;")
    t = r.asked_within(11)
    check("typing: not asked while the writer types", t is None)
    t = r.asked_within(12)
    check("typing: asked after the typing stopped", t is not None and t >= 2.5, f"{t:.1f}s after the check window" if t else "never")
    time.sleep(1.5)
    r.shot("typing_then_asked")
    r.tap(516, 804)
    time.sleep(1.5)

    # dialog
    r.set_state(due=True)
    r.export_fountain()
    time.sleep(1)
    r.dismiss_share_sheet()
    app.menu("Help", "About Open Draft")
    time.sleep(1)
    open_now = app.js("return !!document.querySelector('.dialog-overlay');")
    t = r.asked_within(12)
    check("dialog: not asked while About is open", open_now and t is None, f"dialog open: {open_now}")
    app.js("document.querySelector('.dialog-overlay')?.click(); return true;")
    t = r.asked_within(10)
    check("dialog: asked after it closed", t is not None, f"{t:.1f}s" if t else "never")
    time.sleep(1.5)
    r.shot("dialog_then_asked")
    r.tap(516, 804)

    passed = sum(ok for _, ok, _ in results)
    print(f"\nstore rating: {passed}/{len(results)} passed")
    (OUT / "results.json").write_text(json.dumps(results, indent=1))
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

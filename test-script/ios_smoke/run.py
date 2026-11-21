#!/usr/bin/env python3
"""Smoke-test the iOS or Android app after a build change.

Drives the running OpenDraft app (debug build) through its web inspector —
the simulator's webinspectord on iOS, Chrome DevTools over adb on Android —
and checks what the iOS-15 compatibility change could break on
a current iOS: startup, the index.html polyfills leaving native built-ins
alone, loading a script, typing, Rename Character (its matcher changed), and a
PDF made with jsPDF read back through pdf.js and its worker (the worker is now
re-minified by vite.config.ts). Uncaught errors during the run fail it.

    ./build-ios-device.sh --sim "iPhone 18 Pro"      # install a debug build
    python3 test-script/ios_smoke/run.py [--udid <booted sim>]

    # Android: a debug APK (tauri android build --apk --debug) running on an
    # emulator or device
    python3 test-script/ios_smoke/run.py --platform android [--serial emulator-5554]

--dist points at the frontend/dist the app was built from (its chunk names
are used to load jsPDF and pdf.js). Screenshots: test-script/output/ios_smoke/
<platform>/. Exit 0 = every check passed.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "test-script"))
sys.path.insert(0, str(ROOT / "test-script" / "appstore"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from android_cdp import AndroidWebView, JavaScriptError as AndroidJavaScriptError  # noqa: E402

OUT_ROOT = ROOT / "test-script" / "output" / "ios_smoke"
OUT = OUT_ROOT
DIST = ROOT / "frontend" / "dist" / "assets"


class IOSBackend:
    def __init__(self, udid: str):
        from sim_webinspector import find_socket
        from sim import run_inspector
        self.udid, self.socket, self._run = udid, find_socket(), run_inspector

    def evaluate(self, expression: str) -> str:
        return self._run(self.socket, expression)

    def screenshot(self, path: str) -> None:
        subprocess.run(["xcrun", "simctl", "io", self.udid, "screenshot", path],
                       check=True, capture_output=True, timeout=30)


try:
    from sim import JavaScriptError as IOSJavaScriptError  # noqa: E402
except ImportError:  # pragma: no cover — sim.py ships beside this script
    IOSJavaScriptError = RuntimeError
JavaScriptError = (IOSJavaScriptError, AndroidJavaScriptError)


def asset(prefix: str, suffix: str = ".js") -> str:
    """The hashed name of a built chunk. The simulator app embeds this same dist."""
    matches = sorted(p.name for p in DIST.glob(f"{prefix}*{suffix}"))
    if not matches:
        raise SystemExit(f"No {prefix}*{suffix} in {DIST} — build the frontend first.")
    return f"/assets/{matches[0]}"


class Smoke:
    def __init__(self, backend):
        self.backend = backend
        self.results: list[tuple[str, bool, str]] = []
        OUT.mkdir(parents=True, exist_ok=True)

    def js(self, expression: str):
        raw = self.backend.evaluate(f"(()=>{{ return JSON.stringify((()=>{{ {expression} }})()); }})()")
        return json.loads(raw) if raw not in (None, "") else None

    def js_async(self, body: str, key: str, timeout: float = 60.0):
        """Run an async body in the page; poll for what it resolves to."""
        self.js(f"""
          window.__smoke = window.__smoke || {{}};
          window.__smoke[{json.dumps(key)}] = {{ pending: true }};
          (async () => {{ {body} }})()
            .then(v => {{ window.__smoke[{json.dumps(key)}] = {{ value: v }}; }})
            .catch(e => {{ window.__smoke[{json.dumps(key)}] = {{ error: String(e && (e.stack || e.message) || e) }}; }});
          return true;
        """)
        deadline = time.time() + timeout
        while time.time() < deadline:
            state = self.js(f"return (window.__smoke || {{}})[{json.dumps(key)}];")
            if state and not state.get("pending"):
                if "error" in state:
                    raise RuntimeError(f"page threw: {state['error']}")
                return state.get("value")
            time.sleep(1.0)
        raise TimeoutError(f"{key} did not finish in {timeout:.0f}s")

    def wait_for(self, condition: str, timeout: float = 15.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                if self.js(f"return !!({condition});"):
                    return True
            except Exception:  # noqa: BLE001 — the page may be mid-navigation; try again
                pass
            time.sleep(0.7)
        return False

    def shot(self, name: str) -> None:
        try:
            self.backend.screenshot(str(OUT / f"{name}.png"))
        except (subprocess.SubprocessError, OSError) as error:
            print(f"  (screenshot {name} failed: {error})")

    def check(self, name: str, fn) -> None:
        try:
            ok, detail = fn()
        except Exception as error:  # noqa: BLE001 — a crashed check is a failed check, with its reason
            ok, detail = False, f"{type(error).__name__}: {error}"
        self.results.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}  — {detail}")

    # ── checks ──────────────────────────────────────────────────────────────

    def booted(self):
        # A cold start on a slow emulator can still be loading the page; wait
        # for either outcome — started, or index.html's error overlay.
        self.wait_for("(document.getElementById('root') && window.__odBooted === true) || document.getElementById('_fatal')", 45)
        s = self.js("""
          return { booted: window.__odBooted === true, fatal: !!document.getElementById('_fatal'),
                   root: document.getElementById('root').children.length, ua: navigator.userAgent };
        """)
        return s["booted"] and not s["fatal"] and s["root"] > 0, json.dumps(s)

    def natives_untouched(self):
        s = self.js("""
          const native = (f) => typeof f === 'function' && /\\[native code\\]/.test(Function.prototype.toString.call(f));
          return {
            'Array#at': native(Array.prototype.at), 'Array#findLast': native(Array.prototype.findLast),
            'String#at': native(String.prototype.at), 'TypedArray#at': native(Object.getPrototypeOf(Int8Array.prototype).at),
            'Object.hasOwn': native(Object.hasOwn), structuredClone: native(window.structuredClone),
            'crypto.randomUUID': native(crypto.randomUUID), 'Promise.withResolvers': native(Promise.withResolvers),
          };
        """)
        bad = [k for k, v in s.items() if not v]
        return not bad, "all native" if not bad else f"replaced by polyfill: {bad}"

    def install_error_trap(self):
        self.js("""
          window.__smokeErrors = [];
          if (!window.__smokeTrap) {
            window.__smokeTrap = true;
            addEventListener('error', e => __smokeErrors.push('error: ' + (e.message || e)));
            addEventListener('unhandledrejection', e => __smokeErrors.push('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
            const orig = console.error;
            console.error = function (...a) { __smokeErrors.push('console.error: ' + a.map(String).join(' ').slice(0, 300)); return orig.apply(this, a); };
          }
          return true;
        """)
        return True, "listening for uncaught errors and console.error"

    def load_sample(self):
        already = self.js("return document.querySelectorAll('.ProseMirror [data-type=character]').length > 3;")
        if not already and not self.js("return !!document.querySelector('.welcome-choice-sample');"):
            # A script without characters is open and the welcome card was
            # dismissed long ago: bring the card back (it shows while this
            # flag is unset), reload, and re-arm the error trap.
            self.js("localStorage.removeItem('opendraft:welcomed'); setTimeout(() => location.reload(), 50); return true;")
            time.sleep(3)
            if not self.wait_for("window.__odBooted === true && document.querySelector('.welcome-choice-sample')", 30):
                return False, "welcome card did not come back after a reload"
            self.install_error_trap()
            # The reload leaves the open untitled script (only this test's own
            # typing) as unsaved changes, and the app offers to recover them.
            # Discard: the sample script replaces it next anyway.
            time.sleep(2)
            self.js("""
              const box = [...document.querySelectorAll('.dialog-box')]
                .find(b => b.offsetParent && /Recover unsaved changes/.test(b.textContent || ''));
              const discard = box && [...box.querySelectorAll('button')].find(b => b.textContent.trim() === 'Discard');
              if (discard) discard.click();
              return !!discard;
            """)
            time.sleep(1)
        clicked = already or self.js("""
          const b = document.querySelector('.welcome-choice-sample')
            || [...document.querySelectorAll('button')].find(el => el.offsetParent && /Sample Script/.test(el.textContent || ''));
          if (!b) return false;
          b.click();
          return true;
        """)
        if not clicked:
            return False, "no 'Sample Script' button on screen (welcome dialog not shown?)"
        if not self.wait_for("document.querySelectorAll('.ProseMirror [data-type=character]').length > 3", 20):
            return False, "sample script did not load into the editor"
        s = self.js("""
          const pm = document.querySelector('.ProseMirror');
          return { characters: pm.querySelectorAll('[data-type=character]').length,
                   headings: pm.querySelectorAll('[data-type=sceneHeading], .scene-heading').length,
                   chars: pm.textContent.length };
        """)
        self.shot("1_sample_loaded")
        return True, json.dumps(s)

    def typing(self):
        s = self.js("""
          const pm = document.querySelector('.ProseMirror');
          const last = [...pm.querySelectorAll('[data-type=action]')].pop();
          if (!last) return { ok: false, why: 'no action block' };
          pm.focus();
          const r = document.createRange(); r.selectNodeContents(last); r.collapse(false);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          document.execCommand('insertText', false, ' Smoke test words.');
          return { ok: pm.textContent.includes('Smoke test words.') };
        """)
        return bool(s.get("ok")), "inserted text appears in the script" if s.get("ok") else json.dumps(s)

    def rename_character(self):
        self.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;")
        time.sleep(0.5)
        start = self.js("""
          const pm = document.querySelector('.ProseMirror');
          const cue = pm.querySelector('[data-type=character]');
          const name = cue.textContent.replace(/\\(.*?\\)/g, '').trim();
          const count = (root) => [...root.querySelectorAll('[data-type=character]')]
            .filter(c => c.textContent.replace(/\\(.*?\\)/g, '').trim().toUpperCase() === name.toUpperCase()).length;
          // Caret inside the cue, then the three-finger tap that opens the menu on touch screens.
          pm.focus();
          const r = document.createRange(); r.setStart(cue.firstChild.nodeType === 3 ? cue.firstChild : cue, 1); r.collapse(true);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          const rect = cue.getBoundingClientRect();
          const touches = [0, 1, 2].map(i => new Touch({ identifier: i + 1, target: cue,
            clientX: rect.left + 10 + i * 8, clientY: rect.top + rect.height / 2 }));
          window.__renameFrom = name;
          // A re-run finds the last run's name; renaming it to itself is a no-op.
          window.__renameTo = name.toUpperCase() === 'ZEDKOWSKI' ? 'QUINTARA' : 'ZEDKOWSKI';
          window.__renameCount = count(pm);
          setTimeout(() => cue.dispatchEvent(new TouchEvent('touchstart', { touches, targetTouches: touches,
            changedTouches: touches, bubbles: true, cancelable: true })), 300);
          return { name, cues: window.__renameCount, to: window.__renameTo };
        """)
        item = "[...document.querySelectorAll('.ctx-item')].find(el => el.offsetParent && (el.firstElementChild || el).textContent.trim() === %s)"
        if not self.wait_for(item % "'Character'", 8):
            self.shot("2_no_context_menu")
            return False, f"context menu did not open on the cue (cue {start})"
        # Rename Character… sits in the menu's Character submenu.
        self.js(f"({item % repr('Character')}).click(); return true;")
        if not self.wait_for(item % "'Rename Character...'", 6):
            self.shot("2_no_rename_item")
            return False, "Character submenu has no 'Rename Character...'"
        self.shot("2_context_menu")
        self.js(f"({item % repr('Rename Character...')}).click(); return true;")
        if not self.wait_for("document.querySelector('#rename-char-input')", 8):
            return False, "Rename Character dialog did not open"
        dialog = self.js("""
          const input = document.querySelector('#rename-char-input');
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(input, window.__renameTo);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        """)
        time.sleep(0.8)
        summary = self.js("""
          const s = document.querySelector('.rename-char-summary');
          const m = document.querySelector('.rename-char-toggle');
          return { summary: s && s.textContent.trim(), mentions: m && m.textContent.trim(),
                   error: (document.querySelector('.rename-char-error') || {}).textContent || null };
        """)
        self.shot("3_rename_dialog")
        self.js("document.querySelector('.rename-char-dialog .dialog-primary').click(); return true;")
        if not self.wait_for("!document.querySelector('#rename-char-input')", 6):
            return False, f"dialog did not close after Rename: {json.dumps(summary)}"
        after = self.js("""
          const pm = document.querySelector('.ProseMirror');
          const key = (c) => c.textContent.replace(/\\(.*?\\)/g, '').trim().toUpperCase();
          const cues = [...pm.querySelectorAll('[data-type=character]')];
          return { old: cues.filter(c => key(c) === window.__renameFrom.toUpperCase()).length,
                   renamed: cues.filter(c => key(c) === window.__renameTo).length, expected: window.__renameCount };
        """)
        self.shot("4_renamed")
        ok = after["old"] == 0 and after["renamed"] == after["expected"] and after["renamed"] > 0 and not summary.get("error")
        return ok, f"{start['name']} → {start['to']}: {json.dumps(after)}; dialog said: {summary.get('summary')!r} {summary.get('mentions') or ''}"

    def pdf_roundtrip(self):
        jspdf, pdf, worker = asset("jspdf.es.min-"), asset("pdf-"), asset("pdf.worker.min-", ".mjs")
        text = self.js_async(f"""
          const {{ jsPDF }} = await import({json.dumps(jspdf)});
          const doc = new jsPDF();
          doc.text('OPENDRAFT IOS SMOKE PDF', 20, 20);
          const data = new Uint8Array(doc.output('arraybuffer'));
          const bytes = data.length;  // read before pdf.js transfers the buffer to its worker
          const pdfjs = await import({json.dumps(pdf)});
          pdfjs.GlobalWorkerOptions.workerSrc = {json.dumps(worker)};
          // A real worker, not pdf.js's silent main-thread fallback.
          const port = new pdfjs.PDFWorker({{ name: 'smoke' }});
          await port.promise;
          const isReal = !!port.port && !(port._webWorker === null);
          const task = pdfjs.getDocument({{ data, worker: port }});
          const docu = await task.promise;
          const page = await docu.getPage(1);
          const content = await page.getTextContent();
          const out = content.items.map(i => i.str).join(' ');
          await docu.destroy(); port.destroy();
          return {{ text: out, pages: docu.numPages, realWorker: isReal, bytes }};
        """, "pdf", timeout=60)
        ok = "OPENDRAFT IOS SMOKE PDF" in (text or {}).get("text", "") and text.get("realWorker")
        return ok, json.dumps(text)

    def no_errors(self):
        errs = self.js("return window.__smokeErrors || [];")
        # The web view has no backend; nothing in this run should have thrown.
        return not errs, "none" if not errs else json.dumps(errs[:8])


def booted_udid() -> str:
    out = subprocess.run(["xcrun", "simctl", "list", "devices", "booted", "-j"], capture_output=True, text=True, check=True).stdout
    for devices in json.loads(out)["devices"].values():
        for d in devices:
            if d.get("state") == "Booted":
                return d["udid"]
    raise SystemExit("No booted simulator.")


def main() -> int:
    global OUT, DIST
    ap = argparse.ArgumentParser()
    ap.add_argument("--platform", choices=["ios", "android"], default="ios")
    ap.add_argument("--udid", default=None, help="iOS: booted simulator (default: the booted one)")
    ap.add_argument("--serial", default=None, help="Android: adb serial (default: the only device)")
    ap.add_argument("--dist", default=None, help="frontend/dist/assets the app was built from")
    args = ap.parse_args()
    if args.dist:
        DIST = Path(args.dist)
    OUT = OUT_ROOT / args.platform
    if args.platform == "android":
        backend = AndroidWebView(args.serial)
        backend.connect()
    else:
        backend = IOSBackend(args.udid or booted_udid())
    s = Smoke(backend)
    print(f"platform: {args.platform}; chunks from {DIST}")
    s.check("app started (no 'Loading timed out' / 'failed to start')", s.booted)
    s.check("polyfills left native built-ins alone", s.natives_untouched)
    s.check("error trap installed", s.install_error_trap)
    s.check("sample script loads", s.load_sample)
    s.check("typing into the script", s.typing)
    s.check("Rename Character renames every cue", s.rename_character)
    s.check("PDF made by jsPDF reads back through pdf.js + worker", s.pdf_roundtrip)
    s.check("no uncaught errors during the run", s.no_errors)
    failed = [n for n, ok, _ in s.results if not ok]
    print(f"\n{len(s.results) - len(failed)}/{len(s.results)} passed" + (f"; failed: {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

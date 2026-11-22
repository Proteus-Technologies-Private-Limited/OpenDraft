#!/usr/bin/env python3
"""Upgrade test: character and location data, with images, survive 2.14.2 → current.

Runs on an iOS simulator through its web inspector (debug builds only, and an
unsandboxed shell — the inspector socket is outside the sandbox):

    ios_upgrade.py eval '<js body returning a value>'   # explore
    ios_upgrade.py populate     # on the 2.14.2 app: project, script, profiles, images
    ios_upgrade.py verify       # on the current app, installed over it

`populate` drives the 2.14.2 interface itself, so the data on disk is exactly
what that version writes for a real writer. It saves a manifest of what it
made to test-script/output/upgrade_compat/manifest.json, which `verify` checks
field by field, image by image, after the upgrade.

The simulator is the one in $OD_SIM_UDID (default: the booted one).
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path[:0] = [str(ROOT / "test-script"), str(ROOT / "test-script" / "appstore"), str(ROOT / "test-script" / "ios_smoke")]
from run import IOSBackend, Smoke  # noqa: E402

OUT = ROOT / "test-script" / "output" / "upgrade_compat"
MANIFEST = OUT / "manifest.json"
IMAGES = Path(os.environ.get("OD_TEST_IMAGES", ""))  # folder with sarah.jpg, marcus.jpg, loc_day.jpg, loc_night.jpg
PROJECT = "Upgrade Check"


class PersistentIOS:
    """One web-inspector session kept open across evaluations.

    run_inspector opens a session per call, and webinspectord stalls on a
    session opened right after another closed — up to 20 s a call. Here the
    session is set up once; a reload (new target) or a dropped socket sets it
    up again.
    """

    def __init__(self, device: str):
        from sim_webinspector import APP_BUNDLE, Inspector, find_socket
        self.udid, self.path, self.bundle, self.Inspector = device, find_socket(), APP_BUNDLE, Inspector
        self.ins = None
        self.base = None
        self.target = None
        self.next_id = 10

    def _connect(self) -> None:
        self.close()
        ins = self.Inspector(self.path, timeout=15.0)
        ins.send("_rpc_reportIdentifier:", {"WIRConnectionIdentifierKey": ins.conn})
        app_id, deadline = None, time.time() + 15
        while app_id is None:
            if time.time() > deadline:
                raise RuntimeError("OpenDraft never appeared in the inspector's application list")
            msg = ins.recv()
            sel, arg = msg.get("__selector"), msg.get("__argument", {})
            if sel == "_rpc_reportConnectedApplicationList:":
                apps = arg.get("WIRApplicationDictionaryKey", {})
            elif sel in ("_rpc_applicationConnected:", "_rpc_applicationUpdated:"):
                apps = {arg.get("WIRApplicationIdentifierKey"): arg}
            else:
                continue
            app_id = next((k for k, v in apps.items() if v.get("WIRApplicationBundleIdentifierKey") == self.bundle), None)
        ins.send("_rpc_forwardGetListing:", {"WIRConnectionIdentifierKey": ins.conn, "WIRApplicationIdentifierKey": app_id})
        listing, deadline = None, time.time() + 15
        while not listing:
            if time.time() > deadline:
                raise RuntimeError("OpenDraft has no inspectable page yet")
            listing = ins.wait_for("_rpc_applicationSentListing:").get("WIRListingKey")
        page_id = next(iter(listing.values()))["WIRPageIdentifierKey"]
        self.base = {"WIRConnectionIdentifierKey": ins.conn, "WIRApplicationIdentifierKey": app_id,
                     "WIRPageIdentifierKey": page_id, "WIRSenderKey": ins.sender}
        ins.send("_rpc_forwardSocketSetup:", {**self.base, "WIRAutomaticallyPause": False})
        self.ins = ins
        deadline = time.time() + 15
        while self.target is None:
            if time.time() > deadline:
                raise RuntimeError("no inspector target")
            self._pump()

    def _pump(self):
        """Read one message; note targets; return a target reply if it is one."""
        msg = self.ins.recv()
        if msg.get("__selector") != "_rpc_applicationSentData:":
            return None
        data = json.loads(msg["__argument"]["WIRMessageDataKey"])
        method = data.get("method")
        if method == "Target.targetCreated":
            self.target = data["params"]["targetInfo"]["targetId"]
        elif method == "Target.targetDestroyed" and data.get("params", {}).get("targetId") == self.target:
            self.target = None
        elif method == "Target.dispatchMessageFromTarget":
            return json.loads(data["params"]["message"])
        return None

    def _evaluate(self, expression: str) -> str:
        if self.ins is None or self.target is None:
            self._connect()
        self.next_id += 1
        my_id = self.next_id
        request = {"id": my_id, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}
        outer = {"id": my_id + 100000, "method": "Target.sendMessageToTarget",
                 "params": {"targetId": self.target, "message": json.dumps(request)}}
        self.ins.send("_rpc_forwardSocketData:", {**self.base, "WIRSocketDataKey": json.dumps(outer).encode()})
        deadline = time.time() + 60
        while time.time() < deadline:
            inner = self._pump()
            if self.target is None:
                raise ConnectionError("page went away (reload)")
            if not inner or inner.get("id") != my_id:
                continue
            result = inner.get("result", {})
            if inner.get("error") or result.get("wasThrown"):
                from sim import JavaScriptError
                raise JavaScriptError(result.get("result", {}).get("description") or json.dumps(inner))
            value = result.get("result", {}).get("value")
            return value if isinstance(value, str) else json.dumps(value)
        raise TimeoutError("no reply")

    def evaluate(self, expression: str) -> str:
        from sim import JavaScriptError
        last = None
        for attempt in range(4):
            try:
                return self._evaluate(expression)
            except JavaScriptError:
                raise
            except (OSError, KeyError, ValueError, RuntimeError, StopIteration) as error:
                last = error
                self.close()
                time.sleep(1.5 + attempt)
        raise RuntimeError(f"inspector failed: {last!r}")

    def close(self) -> None:
        if self.ins is not None:
            try:
                self.ins.close(self.base)
            except Exception:  # noqa: BLE001 — closing a dead session
                pass
        self.ins, self.target = None, None

    def screenshot(self, path: str) -> None:
        subprocess.run(["xcrun", "simctl", "io", self.udid, "screenshot", path], check=True, capture_output=True, timeout=30)


def udid() -> str:
    if os.environ.get("OD_SIM_UDID"):
        return os.environ["OD_SIM_UDID"]
    out = subprocess.run(["xcrun", "simctl", "list", "devices", "booted"], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if "(Booted)" in line:
            return line.split("(")[-2].split(")")[0]
    raise SystemExit("No booted simulator")


class App(Smoke):
    """Smoke's helpers plus the few interactions this test needs."""

    def shot(self, name: str) -> None:
        OUT.mkdir(parents=True, exist_ok=True)
        try:
            self.backend.screenshot(str(OUT / f"{name}.png"))
        except (subprocess.SubprocessError, OSError) as error:
            print(f"  (screenshot {name} failed: {error})")

    def click_text(self, text: str, selector: str = "button, [role=menuitem], [role=tab], a, .menu-item, .ctx-item") -> bool:
        return bool(self.js(f"""
          const want = {json.dumps(text)};
          const el = [...document.querySelectorAll({json.dumps(selector)})]
            .find(e => e.offsetParent !== null && (e.textContent || '').trim().replace(/\\s+/g, ' ') === want);
          if (!el) return false;
          el.click();
          return true;
        """))

    def set_input(self, selector: str, value: str) -> bool:
        """Type into a React-controlled input the way React notices."""
        return bool(self.js(f"""
          const el = document.querySelector({json.dumps(selector)});
          if (!el) return false;
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, {json.dumps(value)});
          el.dispatchEvent(new Event('input', {{ bubbles: true }}));
          el.dispatchEvent(new Event('change', {{ bubbles: true }}));
          return true;
        """))

    def attach_file(self, selector: str, path: Path, mime: str = "image/jpeg") -> bool:
        """Hand a file to an <input type=file>, as the photo picker would."""
        data = base64.b64encode(path.read_bytes()).decode()
        return bool(self.js(f"""
          const input = document.querySelector({json.dumps(selector)});
          if (!input) return false;
          const bytes = Uint8Array.from(atob({json.dumps(data)}), c => c.charCodeAt(0));
          const file = new File([bytes], {json.dumps(path.name)}, {{ type: {json.dumps(mime)} }});
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('change', {{ bubbles: true }}));
          return true;
        """))

    def navigate(self, path: str) -> None:
        self.js(f"history.pushState({{}}, '', {json.dumps(path)}); dispatchEvent(new PopStateEvent('popstate')); return true;")
        time.sleep(1.5)

    def visible_buttons(self) -> list[str]:
        return self.js("return [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.textContent.trim().replace(/\\s+/g, ' ')).filter(Boolean).slice(0, 60);")


    def menu(self, top: str, *path: str) -> bool:
        """Open a menu-bar menu and click through submenus by their labels."""
        self.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;")
        time.sleep(0.4)
        if not self.js(f"""
          const top = [...document.querySelectorAll('.menu-bar [role=menuitem]')].find(b => b.textContent.trim() === {json.dumps(top)});
          if (!top) return false;
          top.click();
          return true;
        """):
            return False
        time.sleep(0.8)
        # The click toggles: if that menu was already open it just closed.
        if self.js("return [...document.querySelectorAll('[role=menuitem]')].filter(e => e.offsetParent).length;") <= 6:
            self.js(f"[...document.querySelectorAll('.menu-bar [role=menuitem]')].find(b => b.textContent.trim() === {json.dumps(top)}).click(); return true;")
            time.sleep(0.8)
        return bool(self.js(f"""
          const path = {json.dumps(list(path))};
          let scope = null;
          for (const label of path) {{
            let item;
            if (!scope) {{
              // First level: the open menu's own items (not the bar's).
              item = [...document.querySelectorAll('[role=menuitem], [role=menuitemcheckbox]')]
                .find(e => e.offsetParent !== null && e.textContent.trim().startsWith(label)
                           && !['File','Edit','Format','View','Tools','Help'].includes(e.textContent.trim()));
            }} else {{
              // Inside a submenu, which is in the DOM before it is shown.
              // A ticked item reads "✓ Label".
              const leaf = [...scope.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim().replace(/^✓\\s*/, '') === label);
              item = leaf && (leaf.closest('[role=menuitemcheckbox], [role=menuitem], [role=menuitemradio], button') || leaf);
            }}
            if (!item) return false;
            item.click();
            scope = item;
          }}
          return true;
        """))

    def stub_file_picker(self, on: bool) -> None:
        """Keep the native photo picker shut while a test hands files in directly."""
        self.js("""
          if (!window.__realInputClick) window.__realInputClick = HTMLInputElement.prototype.click;
          HTMLInputElement.prototype.click = %s;
          return true;
        """ % ("function () { if (this.type === 'file') { window.__pickerFor = this; return; } return window.__realInputClick.call(this); }"
               if on else "window.__realInputClick"))

    def type_rich(self, card_selector: str, placeholder: str, text: str) -> bool:
        """Type into one of the profile's small rich-text editors."""
        return bool(self.js(f"""
          const card = document.querySelector({json.dumps(card_selector)});
          const ed = card && [...card.querySelectorAll('[contenteditable=true]')]
            .find(e => (e.getAttribute('data-placeholder') || e.closest('[data-placeholder]')?.getAttribute('data-placeholder') || e.parentElement?.textContent || '').includes({json.dumps(placeholder)})
                    || (e.querySelector('[data-placeholder]')?.getAttribute('data-placeholder') || '').includes({json.dumps(placeholder)}));
          if (!ed) return false;
          ed.focus();
          document.execCommand('selectAll');
          document.execCommand('insertText', false, {json.dumps(text)});
          ed.blur();
          return true;
        """))


# What the 2.14.2 app is given, and what must still be there afterwards.
CHARACTERS = {
    "SARAH": {"gender": "Female", "age": "30s", "image": "sarah.jpg",
              "description": "Corporate lawyer who found the Nightfall file.",
              "backstory": "Grew up in the city; trusts paper more than people."},
    "MARCUS": {"gender": "Male", "age": "40s", "image": "marcus.jpg",
               "description": "Detective with a rumpled suit and an easy smile.",
               "backstory": "Owes a favour to someone he should not."},
}


def populate_214(app: App) -> dict:
    """On the 2.14.2 app: sample script → new project, then two filled-in profiles with portraits."""
    manifest: dict = {"version_before": None, "characters": {}, "locations_before": None}
    if not app.wait_for("window.__odBooted === true", 45):
        raise SystemExit("app did not start")
    # A fresh install opens on the welcome card.
    if app.js("return document.querySelectorAll('.ProseMirror [data-type=character]').length;") < 3:
        if not app.click_text("🎬Sample ScriptExplore with a demo screenplay") and not app.js(
                "const b=[...document.querySelectorAll('button')].find(b=>/Sample Script/.test(b.textContent)); b&&b.click(); return !!b;"):
            raise SystemExit("no Sample Script on the welcome card")
        if not app.wait_for("document.querySelectorAll('.ProseMirror [data-type=character]').length > 3", 20):
            raise SystemExit("sample script did not load")
    # Save it into a new project, the way a writer starts one.
    if not app.js("return /^\\/project\\//.test(location.pathname);"):
        app.menu("File", "Save Script As…")
        if not app.wait_for("[...document.querySelectorAll('.dialog-box')].some(b => b.offsetParent && b.querySelector('input[placeholder=\"Project name\"]'))", 15):
            raise SystemExit("Save As dialog did not open")
        app.js("""
          const d = [...document.querySelectorAll('.dialog-box')].find(b => b.offsetParent && b.querySelector('input[placeholder="Project name"]'));
          const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          // Picked by placeholder: these inputs carry no type attribute.
          set(d.querySelector('input[placeholder="Project name"]'), %s);
          set(d.querySelector('input[placeholder="First Draft"]'), 'The Nightfall File');
          return true;
        """ % json.dumps(PROJECT))
        time.sleep(0.8)
        app.js("const d=[...document.querySelectorAll('.dialog-box')].find(b=>b.offsetParent); [...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save').click(); return true;")
        if not app.wait_for("/^\\/project\\/[^/]+\\/edit\\//.test(location.pathname)", 20):
            raise SystemExit("Save As did not open the script in a project")
    manifest["path"] = app.js("return location.pathname;")
    manifest["version_before"] = app.js("return document.querySelector('meta[name=version]')?.content || null;")

    # Characters panel, one profile at a time.
    if not app.js("return !!document.querySelector('.char-profile-row');"):
        app.menu("View", "Panels", "Characters")
        if not app.wait_for("document.querySelector('.char-profile-row')", 10):
            raise SystemExit("Characters panel did not open")
    app.stub_file_picker(True)
    try:
        for name, data in CHARACTERS.items():
            app.js("""
              const card = [...document.querySelectorAll('.char-profile-card')].find(c => c.querySelector('.char-profile-row')?.textContent.trim().startsWith(%s));
              if (!card) return false;
              card.setAttribute('data-test-card', %s);
              if (!card.querySelector('.mini-rt-editor')) card.querySelector('.char-profile-row').click();
              return true;
            """ % (json.dumps(name), json.dumps(name)))
            time.sleep(1.0)
            card = f'[data-test-card="{name}"]'
            app.js("""
              const card = document.querySelector(%s);
              const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
              set(card.querySelector('input[placeholder="e.g. Male"]'), %s);
              set(card.querySelector('input[placeholder="e.g. 30s"]'), %s);
              return true;
            """ % (json.dumps(card), json.dumps(data["gender"]), json.dumps(data["age"])))
            app.type_rich(card, "weary detective", data["description"])
            app.type_rich(card, "Character history", data["backstory"])
            # Upload Image: the button picks the character, the input gets the file.
            app.js("const card=document.querySelector(%s); [...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='Upload Image').click(); return true;" % json.dumps(card))
            time.sleep(0.5)
            app.attach_file('input[type=file][accept="image/*"]', IMAGES / data["image"])
            if not app.wait_for(f"document.querySelector({json.dumps(card)}).querySelector('img')", 15):
                raise SystemExit(f"{name}: uploaded image never appeared")
            time.sleep(1.0)
            manifest["characters"][name] = data
    finally:
        app.stub_file_picker(False)
    manifest["profiles_before"] = app.js("""
      return [...document.querySelectorAll('.char-profile-card')].map(c => ({
        row: c.querySelector('.char-profile-row')?.textContent.trim().replace(/\\s+/g, ' ').slice(0, 60),
        images: [...c.querySelectorAll('img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 })),
      }));
    """)
    app.shot("before_characters")

    # Locations, as far as 2.14.2 gets with them on a device.
    app.menu("View", "Panels", "Locations")
    time.sleep(2.5)
    manifest["locations_before"] = app.js("""
      const panel = document.querySelector('.location-database');
      return panel ? { text: panel.innerText.slice(0, 400), rows: panel.querySelectorAll('.location-db-item, .location-db-row, li').length } : null;
    """)
    app.shot("before_locations")

    # Save, so the profiles are on disk and not only in memory.
    app.menu("File", "Save Script")
    time.sleep(3)
    OUT.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=1))
    return manifest


IMAGES_LOADED = """
  (root) => [...(root || document).querySelectorAll('img')].filter(i => i.offsetParent !== null)
    .map(i => ({ cls: i.className, ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth }))
"""


class Verify:
    def __init__(self, app: App):
        self.app = app
        self.results: list[tuple[str, bool, str]] = []

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.results.append((name, bool(ok), detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}  — {detail}")
        return bool(ok)

    def dismiss_dialogs(self) -> list[str]:
        """Close anything the upgrade puts up (What's New, recovery), noting what it was."""
        seen = []
        for _ in range(3):
            title = self.app.js("""
              const box = [...document.querySelectorAll('.dialog-box')].find(b => b.offsetParent);
              if (!box) return null;
              const t = (box.querySelector('.dialog-header')?.textContent || box.textContent).trim().slice(0, 80);
              const btn = [...box.querySelectorAll('button')].find(b => /^(Close|OK|Got it|Discard|Not now|Later|Cancel)$/.test(b.textContent.trim()));
              if (btn) btn.click();
              return t;
            """)
            if not title:
                break
            seen.append(title)
            time.sleep(1)
        return seen

    def open_script(self, path: str) -> bool:
        if self.app.js("return location.pathname;") != path:
            self.app.navigate(path)
        return self.app.wait_for("document.querySelectorAll('.ProseMirror [data-type=character]').length > 3", 30)

    def open_panel(self, label: str, selector: str) -> bool:
        if self.app.js(f"return !!document.querySelector({json.dumps(selector)});"):
            return True
        self.app.menu("View", "Panels", label)
        return self.app.wait_for(f"document.querySelector({json.dumps(selector)})", 10)

    def character_rows(self) -> dict:
        self.app.wait_for("[...document.querySelectorAll('.sp-row[data-char-name] img.sp-avatar')].every(i => i.complete)", 10)
        return self.app.js("""
          const out = {};
          for (const r of document.querySelectorAll('.sp-row[data-char-name]')) {
            const img = r.querySelector('img.sp-avatar');
            out[r.dataset.charName] = img ? { image: true, ok: img.complete && img.naturalWidth > 0 }
                                          : { image: false, initials: r.querySelector('.sp-avatar')?.textContent || '' };
          }
          return out;
        """)

    def open_character(self, name: str) -> dict:
        self.app.js("const r=document.querySelector('.sp-row[data-char-name=\"%s\"]'); r && r.click(); return !!r;" % name)
        time.sleep(1.2)
        self.app.click_text("Profile", "[role=tab]")
        time.sleep(0.8)
        profile = self.app.js("""
          const root = document.querySelector('.char-profiles, .character-profiles, .story-panel') || document.body;
          return {
            inputs: [...document.querySelectorAll('input[type=text], input:not([type])')].filter(i => i.offsetParent).map(i => i.value),
            text: [...document.querySelectorAll('.mini-rt-editor, [contenteditable=true]')].filter(e => e.offsetParent && !e.closest('.ProseMirror-editor-root')).map(e => e.textContent.trim()),
            images: (%s)(null).filter(i => !/sp-avatar|sp-row-thumb/.test(i.cls)),
            header: (%s)(null).filter(i => /sp-avatar/.test(i.cls) && !i.cls.includes('row')),
          };
        """ % (IMAGES_LOADED, IMAGES_LOADED))
        self.app.click_text("Story", "[role=tab]")
        time.sleep(0.8)
        profile["story"] = self.app.js("return [...document.querySelectorAll('.mini-rt-editor, [contenteditable=true]')].filter(e => e.offsetParent).map(e => e.textContent.trim());")
        self.app.click_text("Profile", "[role=tab]")
        return profile

    def back_to_list(self, panel: str = ".char-profiles-panel") -> None:
        # Scoped: with two panels open, the other one's back button is also on screen.
        self.app.js("""
          const back = [...(document.querySelector(%s) || document).querySelectorAll('button')]""" % json.dumps(panel) + """.find(b => b.offsetParent && /^(‹|←|Back)/.test(b.textContent.trim()) || /Back to/.test(b.getAttribute('aria-label') || b.title || ''));
          if (back) back.click();
          return !!back;
        """)
        time.sleep(0.8)


def verify_upgrade(app: App, label: str) -> int:
    m = json.loads(MANIFEST.read_text())
    v = Verify(app)
    v.check("starts", app.wait_for("window.__odBooted === true && !document.getElementById('_fatal')", 45))
    time.sleep(2)
    print("  dialogs on start:", v.dismiss_dialogs())
    v.check("script opens", v.open_script(m["path"]), m["path"])
    v.check("Character Profiles opens", v.open_panel("Character Profiles", ".sp-row[data-char-name]"))
    rows = v.character_rows()
    for name in m["characters"]:
        r = rows.get(name, {})
        v.check(f"{name}: portrait is the list icon", r.get("image") and r.get("ok"), json.dumps(r))
    others = {k: r for k, r in rows.items() if k not in m["characters"]}
    v.check("others keep their initials", all(not r["image"] for r in others.values()), json.dumps(others)[:160])
    for name, data in m["characters"].items():
        p = v.open_character(name)
        flat = " | ".join(p["inputs"] + p["text"] + p["story"])
        for field in ("gender", "age", "description", "backstory"):
            v.check(f"{name}: {field} kept", data[field] in flat, data[field])
        v.check(f"{name}: portrait shown in the profile", any(i["ok"] for i in p["images"]), json.dumps(p["images"]))
        v.check(f"{name}: portrait in the profile header", any(i["ok"] for i in p["header"]), json.dumps(p["header"]))
        app.shot(f"{label}_character_{name.lower()}")
        v.back_to_list()
    app.shot(f"{label}_characters")
    passed = sum(ok for _, ok, _ in v.results)
    print(f"\n{label}: {passed}/{len(v.results)} passed")
    (OUT / f"{label}.json").write_text(json.dumps(v.results, indent=1))
    return 0 if passed == len(v.results) else 1


def location_rows(app: App) -> dict:
    app.wait_for("[...document.querySelectorAll('.location-database img.sp-row-thumb')].every(i => i.complete)", 10)
    return app.js("""
      const out = {};
      for (const r of document.querySelectorAll('.location-database .sp-row')) {
        const name = r.querySelector('.sp-row-name')?.firstChild?.textContent?.trim() || r.textContent.trim().slice(0, 30);
        const img = r.querySelector('img.sp-row-thumb');
        out[name] = img ? { image: true, ok: img.complete && img.naturalWidth > 0 } : { image: false };
      }
      return out;
    """)


def new_features(app: App) -> int:
    """On the current app: Location Profiles with images, a new portrait, then a relaunch."""
    m = json.loads(MANIFEST.read_text())
    v = Verify(app)
    v.open_script(m["path"])
    v.check("Location Profiles opens", v.open_panel("Location Profiles", ".location-database"))
    if not app.js("return document.querySelectorAll('.location-database .sp-row').length;"):
        app.click_text("⟳ Discover")
        app.wait_for("document.querySelectorAll('.location-database .sp-row').length > 0", 15)
    rows = location_rows(app)
    v.check("Discover finds the script's locations on the device", len(rows) >= 2, ", ".join(rows))
    target = next(iter(rows), None)
    app.stub_file_picker(True)
    try:
        if target:
            app.js("const r=[...document.querySelectorAll('.location-database .sp-row')].find(r=>r.textContent.includes(%s)); r.click(); return true;" % json.dumps(target))
            time.sleep(1.2)
            app.click_text("Details", "[role=tab]")
            time.sleep(0.6)
            app.js("const b=[...document.querySelectorAll('.location-database .char-profile-img-btn')].find(b=>b.offsetParent && /Upload/.test(b.textContent)); b && b.click(); return !!b;")
            time.sleep(0.4)
            app.attach_file('.location-database input[type=file]', IMAGES / "loc_day.jpg")
            v.check(f"{target}: image uploads in Location Profiles",
                    app.wait_for("[...document.querySelectorAll('.location-database .sp-body img, .location-database .location-db-images img')].some(i => i.complete && i.naturalWidth > 0)", 15))
            app.shot("new_location_record")
            v.back_to_list(".location-database")
            r = location_rows(app).get(target, {})
            v.check(f"{target}: image is the list thumbnail", r.get("image") and r.get("ok"), json.dumps(r))
        # A portrait added in the new version, to a character that had none.
        v.open_panel("Character Profiles", ".sp-row[data-char-name]")
        app.js("const r=document.querySelector('.sp-row[data-char-name=\"HOODED FIGURE\"]'); r && r.click(); return !!r;")
        time.sleep(1.2)
        app.click_text("Upload Image")
        time.sleep(0.4)
        app.attach_file('.char-profiles-panel input[type=file]', IMAGES / "loc_night.jpg")
        v.check("HOODED FIGURE: new portrait uploads",
                app.wait_for("[...document.querySelectorAll('.char-profiles-panel .sp-body img')].some(i => i.complete && i.naturalWidth > 0)", 15))
        v.back_to_list()
        r = v.character_rows().get("HOODED FIGURE", {})
        v.check("HOODED FIGURE: new portrait is the list icon", r.get("image") and r.get("ok"), json.dumps(r))
    finally:
        app.stub_file_picker(False)
    app.menu("File", "Save Script")
    time.sleep(3)

    # Relaunch: what is on disk, not what is in memory.
    app.backend.close()
    subprocess.run(["xcrun", "simctl", "terminate", app.backend.udid, "com.proteus.opendraft"], capture_output=True)
    time.sleep(1)
    subprocess.run(["xcrun", "simctl", "launch", app.backend.udid, "com.proteus.opendraft"], capture_output=True)
    time.sleep(6)
    v.check("starts again", app.wait_for("window.__odBooted === true", 45))
    v.dismiss_dialogs()
    v.check("script reopens", v.open_script(m["path"]))
    v.open_panel("Character Profiles", ".sp-row[data-char-name]")
    chars = v.character_rows()
    for name in list(m["characters"]) + ["HOODED FIGURE"]:
        r = chars.get(name, {})
        v.check(f"after relaunch: {name} icon", r.get("image") and r.get("ok"), json.dumps(r))
    v.open_panel("Location Profiles", ".location-database")
    locs = location_rows(app)
    if target:
        r = locs.get(target, {})
        v.check(f"after relaunch: {target} thumbnail", r.get("image") and r.get("ok"), json.dumps(r))
    v.check("after relaunch: locations kept", len(locs) == len(rows), f"{len(locs)} of {len(rows)}")
    app.shot("after_relaunch")
    passed = sum(ok for _, ok, _ in v.results)
    print(f"\nnew_features: {passed}/{len(v.results)} passed")
    (OUT / "new_features.json").write_text(json.dumps(v.results, indent=1))
    return 0 if passed == len(v.results) else 1


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    app = App(PersistentIOS(udid()))
    cmd = sys.argv[1]
    if cmd == "eval":
        print(json.dumps(app.js(sys.argv[2]), indent=1, ensure_ascii=False))
        return 0
    if cmd == "populate":
        print(json.dumps(populate_214(app), indent=1, ensure_ascii=False))
        return 0
    if cmd == "features":
        return new_features(app)
    if cmd == "verify":
        return verify_upgrade(app, sys.argv[2] if len(sys.argv) > 2 else "after_upgrade")
    print(f"unknown command {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())

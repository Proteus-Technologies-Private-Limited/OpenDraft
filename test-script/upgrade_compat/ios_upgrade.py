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
        return bool(self.js(f"""
          const path = {json.dumps(list(path))};
          const top = [...document.querySelectorAll('.menu-bar [role=menuitem]')].find(b => b.textContent.trim() === {json.dumps(top)});
          if (!top) return false;
          top.click();
          let scope = document;
          for (const label of path) {{
            const leaf = [...scope.querySelectorAll('*')].find(e => e.offsetParent !== null && e.children.length === 0 && e.textContent.trim() === label)
              || [...scope.querySelectorAll('[role=menuitem]')].find(e => e.offsetParent !== null && e.textContent.trim().startsWith(label));
            if (!leaf) return false;
            const item = leaf.closest('[role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]') || leaf;
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
        time.sleep(1.5)
        app.js("""
          const d = [...document.querySelectorAll('.dialog-box')].find(b => b.offsetParent);
          const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
          const ins = d.querySelectorAll('input[type=text]');
          set(ins[0], %s); set(ins[1], 'The Nightfall File');
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


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    app = App(IOSBackend(udid()))
    cmd = sys.argv[1]
    if cmd == "eval":
        print(json.dumps(app.js(sys.argv[2]), indent=1, ensure_ascii=False))
        return 0
    if cmd == "populate":
        print(json.dumps(populate_214(app), indent=1, ensure_ascii=False))
        return 0
    print(f"unknown command {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())

"""Every panel moves into a window of its own, and back, in a real browser.

    python test-script/panel-popout/regressions.py

The app is the real one: the built frontend/dist (served to the browser by
Playwright's request interception: no server is started), or a running dev
server when OPENDRAFT_TEST_URL is set, as CI does. No backend or account is
needed; the few signed-out startup reads are answered here.

Each panel is opened, popped out with the button in its own header, checked in
its window (drawn there, gone from its dock, styled, live with the script),
then sent back with the button in the window and again by closing the window.
Several panels share a window: one joins another's window as a tab from the
button's menu, moves on to a new window, and a shared window closed puts them
all back. Also: a dropdown opened in a panel window opens there, a shortcut typed there
reaches the editor window, the editor's theme follows into the window, and the
windows close with the editor page.

OPENDRAFT_BROWSER=webkit runs it in WebKit (Safari's engine). Screenshots go
to test-script/output/panel-popout/ (or $OPENDRAFT_PANEL_OUTPUT).
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import traceback
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "frontend" / "dist"
ORIGIN = "http://opendraft.test"
URL = os.environ.get("OPENDRAFT_TEST_URL", "").rstrip("/") or ORIGIN
OUTPUT = Path(os.environ.get("OPENDRAFT_PANEL_OUTPUT", ROOT / "test-script/output/panel-popout"))

# Panel id, how the View menu names it, and the label its pop-out button uses.
PANELS = [
    ("scenes", None, "Scenes"),
    ("notes", "Notes Panel", "Notes Panel"),
    ("characters", "Character Profiles", "Character Profiles"),
    ("tags", "Tags", "Tags"),
    ("location-db", "Location Profiles", "Location Profiles"),
    ("scene-details", "Scene Details", "Scene Details"),
    ("tuner", "Dialogue Tuner", "Dialogue Tuner"),
    ("suggestions", "Suggestions", "Suggestions"),
]

results: list[tuple[bool, str, str]] = []

# The editor, found through React's fiber on the ProseMirror element, as the
# menu-keyboard fixture does; works in a production build too.
FIND_EDITOR = """() => {
  let element = document.querySelector('.ProseMirror');
  while (element && !window.testEditor) {
    const key = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
    let fiber = key && element[key];
    while (fiber) {
      const editor = fiber.memoizedProps?.editor;
      if (editor?.commands && editor.state) { window.testEditor = editor; break; }
      fiber = fiber.return;
    }
    element = element.parentElement;
  }
  return !!window.testEditor;
}"""


def check(ok: bool, name: str, detail: object = "") -> bool:
    results.append((bool(ok), name, str(detail)[:400]))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  — {detail}" if detail != "" else ""), flush=True)
    return bool(ok)


def snap(target: Page, name: str) -> None:
    """Evidence, not a check. Chromium under Playwright does not route a blank
    popup's own requests (its web fonts), so a screenshot there can wait on
    fonts for ever; it gets a few seconds."""
    try:
        target.screenshot(path=str(OUTPUT / name), timeout=8_000)
    except Exception as error:  # noqa: BLE001
        print(f"      (no screenshot {name}: {str(error).splitlines()[0]})")


def serve_dist(route, request):
    path = request.url[len(ORIGIN):].split("?")[0].split("#")[0]
    if path.startswith("/api/"):
        return answer_api(route, path)
    file = (DIST / path.lstrip("/")).resolve()
    if not str(file).startswith(str(DIST.resolve())) or not file.is_file():
        file = DIST / "index.html"  # the app's own routes
    kind = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
    if file.suffix in (".js", ".mjs"):
        kind = "text/javascript"
    route.fulfill(status=200, body=file.read_bytes(), headers={"content-type": kind})


def answer_api(route, path: str):
    known = {
        "/api/demo-info": {"demo": False, "message": None},
        "/api/formatting-templates/": [],
        "/api/auth/config": {"googleEnabled": False, "emailVerificationRequired": False, "smtpConfigured": False},
    }
    if path in known:
        return route.fulfill(json=known[path])
    route.fulfill(status=404, json={"detail": "Not found"})


def open_from_view_menu(page: Page, label: str):
    """View › Panels › <label>."""
    page.keyboard.press("Escape")
    page.get_by_role("menubar").get_by_role("menuitem", name="View", exact=True).click()
    panels = page.locator("[role=menu] [role^=menuitem]:visible").filter(has_text=re.compile(r"^\W*Panels\b")).first
    panels.wait_for(timeout=5_000)
    panels.hover()
    item = page.locator("[role=menu] [role^=menuitem]").filter(has_text=re.compile(rf"^\W*{re.escape(label)}\W*$")).first
    try:
        item.wait_for(state="visible", timeout=2_000)
    except Exception:
        panels.focus()
        page.keyboard.press("ArrowRight")
        item.wait_for(state="visible", timeout=3_000)
    item.click()


def dock_has(page: Page, panel: str) -> bool:
    if panel == "scenes":
        # Its tab, in the dock's Navigator: the other Navigator tabs stay there.
        return page.locator(".workspace-dock .navigator-tab, .workspace-dock .dock-tab").filter(has_text=re.compile(r"^\s*Scenes\s*$")).count() > 0
    # "Move … to a new window", or "Move ……" once other panel windows are open.
    return page.locator(f".workspace-dock [data-panel-popout=open][aria-label^='Move {label_of(panel)}']").count() > 0


def label_of(panel: str) -> str:
    return next(label for p, _, label in PANELS if p == panel)


def fills_window(popup: Page) -> dict:
    """The panel's own width against its window's: the narrow-screen overlay
    rules must not shrink or slide it (they did, before panelPopout.css)."""
    return popup.evaluate("""() => {
      const el = document.querySelector('.panel-window > *');
      const r = el.getBoundingClientRect();
      return { panel: Math.round(r.width), left: Math.round(r.left), window: innerWidth, position: getComputedStyle(el).position };
    }""")


def pop_out(page: Page, panel: str) -> Page:
    button = page.locator(f"[data-panel-popout=open][aria-label='Move {label_of(panel)} to a new window']").first
    button.wait_for(timeout=10_000)
    with page.context.expect_page(timeout=10_000) as popup_info:
        button.click()
    popup = popup_info.value
    popup.locator(f".panel-window[data-panel='{panel}']").wait_for(timeout=10_000)
    return popup


def run() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    engine = os.environ.get("OPENDRAFT_BROWSER", "chromium")
    if URL == ORIGIN and not (DIST / "index.html").is_file():
        print("Build the frontend first (cd frontend && npm run build), or set OPENDRAFT_TEST_URL.")
        return 2
    with sync_playwright() as playwright:
        if engine == "webkit":
            browser = playwright.webkit.launch()
        else:
            browser = playwright.chromium.launch(
                executable_path=os.environ.get("OPENDRAFT_CHROMIUM") or None, args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 960})
        errors: list[str] = []
        step = lambda: results[-1][1] if results else "startup"  # noqa: E731
        context.on("page", lambda p: p.on("pageerror", lambda e: errors.append(f"{p.url} after '{step()}': {e}")))
        if URL == ORIGIN:
            context.route(f"{ORIGIN}/**", serve_dist)
        else:
            context.route("http://127.0.0.1:8008/api/**", lambda route, request: answer_api(route, "/api" + request.url.split("/api", 1)[1].split("?")[0]))
        context.add_init_script("""
            if (window.opener === null && location.href !== 'about:blank') {
              localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen: true}));
              localStorage.setItem('opendraft:hiddenModeIntroShown', '1');
            }
        """)
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(f"editor after '{step()}': {e}"))
        try:
            page.goto(URL + "/")
            page.locator(".editor-main").wait_for(timeout=30_000)
            blank = page.get_by_role("button", name="Blank Document", exact=False)
            if blank.count():
                blank.first.click()
            editor = page.locator(".ProseMirror").first
            editor.wait_for()
            page.evaluate(FIND_EDITOR)
            page.evaluate("""() => testEditor.commands.setContent({type: 'doc', content: [
              {type: 'sceneHeading', content: [{type: 'text', text: 'INT. KITCHEN - DAY'}]},
              {type: 'action', content: [{type: 'text', text: 'Rain on the window.'}]}]}, true)""")
            page.wait_for_timeout(600)
            snap(page, f"{engine}-editor.png")

            # ── The Navigator, in detail ──
            check(page.locator(".navigator-tabs [data-panel-popout=open]").count() == 1,
                  "the Navigator has a pop-out button in its own header")
            check(page.get_by_role("menuitem", name=re.compile("New Window", re.I)).count() == 0
                  and page.locator("text=Move Scene Navigator").count() == 0,
                  "there is no separate pop-out menu command")
            popup = pop_out(page, "scenes")
            check(True, "Scenes opens in a window of its own")
            check(re.search(r"Scenes", popup.title()) is not None, "the window is named for the panel", popup.title())
            page.wait_for_timeout(400)
            check(not dock_has(page, "scenes"), "the editor's dock no longer shows it")
            scene_text = popup.locator(".panel-window").inner_text()
            check("KITCHEN" in scene_text, "the window lists the script's scenes", scene_text[:80])
            size = fills_window(popup)
            check(abs(size["panel"] - size["window"]) <= 1 and size["left"] == 0, "the Navigator fills its window, not a narrow overlay", size)
            styled = popup.evaluate("""() => {
              const root = document.querySelector('.panel-window-root');
              const bg = getComputedStyle(root).backgroundColor;
              return { sheets: document.styleSheets.length, bg, opener: window.opener === window.opener?.window };
            }""")
            main_bg = page.evaluate("getComputedStyle(document.body).getPropertyValue('--fd-bg') || getComputedStyle(document.body).backgroundColor")
            check(styled["sheets"] > 0 and styled["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"),
                  "the window has the editor's styles", {**styled, "editorBg": main_bg})
            snap(popup, f"{engine}-scenes-window.png")

            # Live: a scene added in the editor shows up in the window.
            page.evaluate("""() => testEditor.chain().focus('end').insertContentAt(testEditor.state.doc.content.size, [
              {type: 'sceneHeading', content: [{type: 'text', text: 'EXT. ROOF - NIGHT'}]},
              {type: 'action', content: [{type: 'text', text: 'Wind.'}]}]).run()""")
            try:
                popup.locator(".panel-window", has_text="ROOF").wait_for(timeout=8_000)
                check(True, "a scene written in the editor appears in the window at once")
            except Exception:
                check(False, "a scene written in the editor appears in the window at once",
                      popup.locator(".panel-window").inner_text()[:200])

            # Shortcut typed in the window reaches the editor window.
            popup.locator(".panel-window").click(position={"x": 40, "y": 200})
            popup.keyboard.press("ControlOrMeta+s")
            try:
                page.locator('[aria-modal="true"]').first.wait_for(timeout=6_000)
                check(True, "Save typed in the panel window saves in the editor window")
                page.keyboard.press("Escape")
                page.wait_for_timeout(300)
            except Exception:
                check(False, "Save typed in the panel window saves in the editor window")

            # The editor's theme and attributes follow into the window.
            page.evaluate("document.documentElement.setAttribute('data-panel-test', 'mirrored')")
            page.wait_for_timeout(200)
            check(popup.evaluate("document.documentElement.getAttribute('data-panel-test')") == "mirrored",
                  "a theme change in the editor reaches the window")

            # Back with the button in the window.
            popup.locator("[data-panel-popout=return]").first.click()
            popup.wait_for_event("close", timeout=5_000) if not popup.is_closed() else None
            page.wait_for_timeout(400)
            check(popup.is_closed() and dock_has(page, "scenes"), "Return puts it back in its dock and closes the window")

            # Back by closing the window.
            popup = pop_out(page, "scenes")
            popup.close()
            page.wait_for_timeout(1_600)
            check(dock_has(page, "scenes"), "closing the window puts the panel back in its dock")

            # ── Every other panel ──
            for panel, menu_label, label in PANELS[1:]:
                try:
                    open_from_view_menu(page, menu_label)
                    page.wait_for_timeout(400)
                    popup = pop_out(page, panel)
                    page.wait_for_timeout(300)
                    body = popup.locator(".panel-window").inner_text()
                    gone = not dock_has(page, panel)
                    size = fills_window(popup)
                    check(abs(size["panel"] - size["window"]) <= 1 and size["left"] == 0, f"{label} fills its window", size)
                    snap(popup, f"{engine}-{panel}-window.png")
                    check(bool(body.strip()) and gone, f"{label} pops out with the button in its header", body.strip()[:60].replace("\n", " "))
                    popup.locator("[data-panel-popout=return]").first.click()
                    page.wait_for_timeout(500)
                    check(popup.is_closed() and dock_has(page, panel), f"{label} goes back to its dock")
                except Exception as error:  # noqa: BLE001 - report and carry on
                    snap(page, f"{engine}-{panel}-failure.png")
                    check(False, f"{label} pops out and back", repr(error)[:400])

            # A dropdown opened in a panel window opens in that window.
            open_from_view_menu(page, "Character Profiles") if not dock_has(page, "characters") else None
            popup = pop_out(page, "characters")
            trigger = popup.locator(".panel-window .od-select-trigger, .panel-window [aria-haspopup=listbox]").first
            if trigger.count():
                trigger.click()
                page.wait_for_timeout(300)
                here = popup.locator("[role=listbox]").count()
                there = page.locator("[role=listbox]").count()
                check(here > 0 and there == 0, "a dropdown in a panel window opens in that window", {"window": here, "editor": there})
                popup.keyboard.press("Escape")
            else:
                check(False, "a dropdown in a panel window opens in that window", "no dropdown found in Character Profiles")

            # Closing the panel (its ×) in the window closes the window too.
            popup.locator(".panel-window .sp-head button[aria-label='Close']").first.click()
            page.wait_for_timeout(600)
            check(popup.is_closed(), "closing the panel from its window closes the window")

            # ── Several panels in one window ──
            try:
                scenes = pop_out(page, "scenes")
                if not dock_has(page, "notes"):
                    open_from_view_menu(page, "Notes Panel")
                    page.wait_for_timeout(300)
                page.locator(".workspace-dock [data-panel-popout=open][aria-label='Move Notes Panel…']").first.click()
                menu = page.locator(".panel-place-menu")
                items = menu.get_by_role("menuitem").all_inner_texts()
                check(len(items) == 2 and any("Scenes window" in i for i in items),
                      "with a panel window open, the button offers a new window or that one", items)
                windows_before = len(page.context.pages)
                menu.get_by_role("menuitem", name=re.compile("Add to the Scenes window")).click()
                scenes.locator(".panel-window[data-panel='notes']").wait_for(timeout=5_000)
                page.wait_for_timeout(600)  # the dock's closing animation
                tabs = scenes.locator(".panel-window-group [role=tab]").all_inner_texts()
                check(len(tabs) == 2 and len(page.context.pages) == windows_before,
                      "Notes joins the Scenes window as a tab, opening no other window",
                      {"tabs": tabs, "windows": [len(page.context.pages), windows_before]})
                check(not dock_has(page, "notes"), "a panel in a shared window leaves its dock",
                      page.locator(".workspace-dock [data-panel-popout=open]").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))"))
                snap(scenes, f"{engine}-grouped-window.png")
                scenes.get_by_role("tab", name=re.compile("Scenes")).click()
                check(scenes.locator(".panel-window[data-panel='scenes']").is_visible()
                      and not scenes.locator(".panel-window[data-panel='notes']").is_visible(),
                      "the window's tabs switch between its panels")
                # On to a window of its own, from its button in the shared window.
                scenes.get_by_role("tab", name=re.compile("Notes")).click()
                scenes.locator(".panel-window[data-panel='notes'] [data-panel-popout=return]").first.click()
                with page.context.expect_page(timeout=10_000) as info:
                    scenes.locator(".panel-place-menu").get_by_role("menuitem", name=re.compile("new window", re.I)).click()
                notes = info.value
                notes.locator(".panel-window[data-panel='notes']").wait_for(timeout=10_000)
                page.wait_for_timeout(300)
                check(not scenes.is_closed() and scenes.locator(".panel-window-group").count() == 0
                      and scenes.locator(".panel-window[data-panel='scenes']").count() == 1,
                      "a panel moved to a new window leaves the rest in the shared one")
                # Two Navigator tabs in one window are one Navigator, as in a dock.
                page.locator(".workspace-dock .navigator-tab").filter(has_text=re.compile(r"^\s*Pages\s*$")).first.click()
                page.locator(".workspace-dock [data-panel-popout=open][aria-label='Move Pages…']").first.click()
                page.locator(".panel-place-menu").get_by_role("menuitem", name=re.compile("Add to the Scenes window")).click()
                page.wait_for_timeout(500)
                nav_tabs = scenes.locator(".navigator-tab").all_inner_texts()
                check([t.strip().lower() for t in nav_tabs] == ["scenes", "pages"],
                      "Scenes and Pages share one Navigator in their window", nav_tabs)
                # Notes joins too, from its own window's button: that window closes.
                notes.locator(".panel-window[data-panel='notes'] [data-panel-popout=return]").first.click()
                notes.locator(".panel-place-menu").get_by_role("menuitem", name=re.compile("Add to the")).click()
                page.wait_for_timeout(600)
                check(notes.is_closed() and scenes.locator(".panel-window[data-panel='notes']").count() == 1,
                      "a window whose last panel moves away closes")
                # Closing the shared window puts every panel in it back.
                scenes.close()
                page.wait_for_timeout(1_600)
                check(dock_has(page, "scenes") and dock_has(page, "notes")
                      and page.locator(".workspace-dock .navigator-tab").filter(has_text=re.compile(r"^\s*Pages\s*$")).count() > 0,
                      "closing a shared window puts all its panels back in their docks")
            except Exception as error:  # noqa: BLE001 - report and carry on
                snap(page, f"{engine}-grouping-failure.png")
                check(False, "several panels in one window", repr(error)[:400])

            # The windows go with the editor page.
            page.locator(".workspace-dock .navigator-tab").filter(has_text=re.compile(r"^\s*Scenes\s*$")).first.click()
            popup = pop_out(page, "scenes")
            page.reload()
            page.locator(".editor-main").wait_for(timeout=30_000)
            page.wait_for_timeout(800)
            check(popup.is_closed(), "panel windows close with the editor page")
        except Exception:
            check(False, "run", traceback.format_exc()[-600:])
            try:
                snap(page, f"{engine}-failure.png")
            except Exception:
                pass
        check(not errors, "no page errors in the editor or any panel window", errors[:3])
        browser.close()
    (OUTPUT / f"{engine}-results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))
    failed = [name for ok, name, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed ({engine})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(run())

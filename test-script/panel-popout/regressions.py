"""Real browser windows and TipTap, with an explicitly simulated native IPC broker.

Requires the normal Vite dev server and Python Playwright. No backend/account,
physical monitor, new test dependency or production test route is needed.
"""

import asyncio
import json
import os
from pathlib import Path
import sys

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
URL = os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173/").rstrip("/")
OUTPUT = Path(
    os.environ.get("OPENDRAFT_PANEL_OUTPUT", ROOT / "test-script/output/panel-popout")
)


async def run():
    html = FRONTEND / "panel-popout-test.html"
    module = FRONTEND / "panel-popout-harness.tsx"
    if html.exists() or module.exists():
        raise RuntimeError("Refusing to overwrite existing browser test entries")
    module.write_text((Path(__file__).with_name("harness.tsx")).read_text())
    html.write_text(
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/panel-popout-harness.tsx"></script></body></html>'
    )
    checks = []
    try:
        async with async_playwright() as playwright:
            name = os.environ.get("OPENDRAFT_BROWSER", "chromium")
            browser_type = getattr(playwright, name)
            options = {"headless": True}
            if name == "chromium" and os.environ.get("OPENDRAFT_CHROMIUM"):
                options["executable_path"] = os.environ["OPENDRAFT_CHROMIUM"]
            if name == "webkit" and os.environ.get("OPENDRAFT_WEBKIT_EXECUTABLE"):
                options["executable_path"] = os.environ["OPENDRAFT_WEBKIT_EXECUTABLE"]
            browser = await browser_type.launch(**options)
            context = await browser.new_context(viewport={"width": 440, "height": 800})
            pages, listeners, panels, snapshots, errors, calls = {}, {}, {}, [], [], []
            counter = 0
            all_panels_closed = asyncio.Event()
            all_panels_closed.set()

            async def deliver(label, event, payload):
                page = pages.get(label)
                if page is None or page.is_closed():
                    return
                for identifier in list(listeners.get((label, event), [])):
                    await page.evaluate(
                        "([id, event, payload]) => window.__panelCallbacks.get(id)?.({id, event, payload})",
                        [identifier, event, payload],
                    )

            async def close_panel(label):
                panel = panels.pop(label, None)
                if panel:
                    page = pages[label]
                    if not page.is_closed():
                        await page.close()
                    await deliver(
                        panel["owner"], "panel-closed", {"session": panel["session"]}
                    )
                    if not panels:
                        all_panels_closed.set()

            async def create(label, role):
                page = await context.new_page()
                pages[label] = page
                page.on("pageerror", lambda error: errors.append(str(error)))
                await page.expose_binding("__panelNative", native)
                await page.add_init_script(
                    """label => {
                    window.__panelLabel = label;
                    window.__panelCallbacks = new Map();
                    let callbackId = 0;
                    window.__TAURI_INTERNALS__ = {
                        metadata: { currentWindow: { label }, currentWebview: { label } },
                        transformCallback(fn) { const id = ++callbackId; window.__panelCallbacks.set(id, fn); return id; },
                        invoke(command, args) { return window.__panelNative(command, args || {}); }
                    };
                    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
                }""".replace(
                        "label => {",
                        "(() => { const label = " + json.dumps(label) + ";",
                        1,
                    ).replace(
                        "\n                }", "\n                })()", 1
                    )
                )
                # The child uses the actual application startup entry. Only
                # the owner is a minimal real-TipTap harness.
                await page.goto(
                    f"{URL}/"
                    if role == "panel"
                    else f"{URL}/panel-popout-test.html?role=owner"
                )
                return page

            async def native(source, command, args):
                nonlocal counter
                page = source["page"]
                label = await page.evaluate("window.__panelLabel")
                calls.append(command)
                if command == "plugin:event|listen":
                    listeners.setdefault((label, args["event"]), []).append(
                        args["handler"]
                    )
                    return args["handler"]
                if command == "plugin:event|unlisten":
                    values = listeners.get((label, args["event"]), [])
                    if args["eventId"] in values:
                        values.remove(args["eventId"])
                    return None
                if command == "set_native_menu_language":
                    return None
                if command == "open_panel_window":
                    for existing, info in list(panels.items()):
                        if (
                            info["owner"] == label
                            and info["session"] == args["session"]
                        ):
                            return existing
                    counter += 1
                    child = f"panel-{label}-navigator-{counter}"
                    all_panels_closed.clear()
                    panels[child] = {"owner": label, "session": args["session"]}
                    await create(child, "panel")
                    return child
                if command == "panel_context":
                    return panels[label]
                if command == "publish_panel_snapshot":
                    snapshots.append(args["snapshot"])
                    for child, info in list(panels.items()):
                        if info == {"owner": label, "session": args["session"]}:
                            await deliver(child, "panel-snapshot", args["snapshot"])
                    return None
                if command == "panel_command":
                    info = panels[label]
                    if args["action"]["kind"] == "return":
                        # Return IPC must finish before closing its sender page.
                        asyncio.get_running_loop().call_soon(
                            lambda: asyncio.create_task(close_panel(label))
                        )
                    else:
                        await deliver(
                            info["owner"],
                            "panel-command",
                            {"session": info["session"], "action": args["action"]},
                        )
                    return None
                if command == "close_panel_windows":
                    for child, info in list(panels.items()):
                        if info == {"owner": label, "session": args["session"]}:
                            await close_panel(child)
                    return None
                raise AssertionError(f"Unexpected native call: {command}")

            owner = await create("main", "owner")
            await owner.wait_for_function("window.panelTest")
            before, undo = await owner.evaluate("[panelTest.doc(), panelTest.undo()]")
            assert not panels, "Opening an editor must not open a panel"
            await owner.get_by_role("button", name="Open Navigator").click()
            await owner.wait_for_function(
                "document.querySelector('#detached').textContent === 'true'"
            )
            panel_label = next(iter(panels))
            panel = pages[panel_label]
            await panel.get_by_role("button", name="2. EXT. STREET - NIGHT").wait_for()
            await panel.get_by_role("button", name="2. EXT. STREET - NIGHT").focus()
            await panel.keyboard.press("Enter")
            await owner.wait_for_function("panelTest.selection() > 20")
            assert await owner.evaluate("[panelTest.doc(), panelTest.undo()]") == [
                before,
                undo,
            ]
            checks.append("panel navigation preserves document and undo history")
            await panel.locator('[aria-current="location"]').filter(
                has_text="EXT. STREET"
            ).wait_for()
            await owner.evaluate("panelTest.select(2)")
            await panel.locator('[aria-current="location"]').filter(
                has_text="INT. ROOM"
            ).wait_for()
            checks.append("owner caret follows into panel highlight")
            await panel.get_by_role("searchbox").fill("Footsteps")
            assert await panel.locator("nav button").count() == 1
            await panel.locator("nav button").click()
            await owner.wait_for_function("panelTest.selection() > 20")
            await panel.get_by_role("searchbox").fill("")
            checks.append("filtered navigation retains original scene index")
            old = snapshots[-1]
            await owner.evaluate("panelTest.select(6); panelTest.insert('UPDATED ')")
            await panel.get_by_role(
                "button", name="1. INT. UPDATED ROOM - DAY"
            ).wait_for()
            position = await owner.evaluate("panelTest.selection()")
            await deliver(
                "main",
                "panel-command",
                {
                    "session": old["session"],
                    "action": {
                        "kind": "navigate",
                        "revision": old["revision"],
                        "index": 1,
                    },
                },
            )
            assert await owner.evaluate("panelTest.selection()") == position
            checks.append("stale revision cannot navigate using old positions")
            await owner.evaluate("panelTest.appearance('light')")
            await panel.wait_for_function(
                "document.documentElement.dataset.theme === 'light'"
            )
            await owner.evaluate("panelTest.language('ar')")
            await panel.wait_for_function(
                "document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar'"
            )
            await owner.evaluate(
                "panelTest.language('en'); panelTest.appearance('dark')"
            )
            await panel.wait_for_function(
                "document.documentElement.dir === 'ltr' && document.documentElement.dataset.theme === 'dark'"
            )
            checks.append("theme and language follow the owner")
            OUTPUT.mkdir(parents=True, exist_ok=True)
            await panel.screenshot(path=str(OUTPUT / f"navigator-{name}.png"))
            current = snapshots[-1]
            await deliver(
                panel_label,
                "panel-snapshot",
                {**current, "sequence": current["sequence"] - 1, "title": "Old title"},
            )
            assert await panel.locator("h1").inner_text() == "Synthetic screenplay"
            checks.append("out-of-order snapshot is ignored")
            await panel.get_by_role("button", name="Return to Main Window").click()
            await owner.wait_for_function(
                "document.querySelector('#detached').textContent === 'false'"
            )
            await asyncio.wait_for(all_panels_closed.wait(), timeout=10)
            assert not panels
            checks.append("return closes panel and restores owner dock state")
            await owner.get_by_role("button", name="Open Navigator").click()
            await owner.wait_for_function(
                "document.querySelector('#detached').textContent === 'true'"
            )
            await owner.evaluate("panelTest.switch()")
            await owner.wait_for_function(
                "document.querySelector('#detached').textContent === 'false'"
            )
            await asyncio.wait_for(all_panels_closed.wait(), timeout=10)
            assert not panels
            await owner.get_by_role("button", name="Open Navigator").click()
            await owner.wait_for_function(
                "document.querySelector('#detached').textContent === 'true'"
            )
            await owner.evaluate("panelTest.replace()")
            await owner.wait_for_function(
                "document.querySelector('#detached').textContent === 'false'"
            )
            await asyncio.wait_for(all_panels_closed.wait(), timeout=10)
            assert not panels
            checks.append("script switch and full replacement close their old panels")
            assert not errors, errors
            assert not any("sql" in call or "save" in call for call in calls), calls
            checks.append("no save or SQL initialization in the panel flow")
            await browser.close()
            (OUTPUT / f"results-{name}.json").write_text(
                json.dumps(
                    {
                        "browser": name,
                        "checks": checks,
                        "native_transport": "simulated; real browser windows, TipTap and application hooks",
                        "errors": errors,
                    },
                    indent=2,
                )
            )
            print(
                json.dumps(
                    {"browser": name, "passed": len(checks), "checks": checks}, indent=2
                )
            )
    finally:
        html.unlink(missing_ok=True)
        module.unlink(missing_ok=True)


if __name__ == "__main__":
    asyncio.run(run())

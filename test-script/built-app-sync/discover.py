"""Load the BUILT app (served by the FastAPI backend) under a Tauri IPC shim with
a real SQLite file, and list every IPC command the app asks for.

usage: discover.py <base-url> <auth.json>
The base URL and the synthetic account come from browser-editing/server.py.
"""
import argparse, asyncio, json, sqlite3, sys, tempfile
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parents[1] / "output" / "built-app-sync"


async def main(base, auth_path):
    auth = json.loads(Path(auth_path).read_text())
    assert auth["user"]["id"] == "browser-bench", "synthetic account only"
    seen = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        context = await browser.new_context(viewport={"width": 1400, "height": 900})
        page = await context.new_page()
        console = []
        page.on("console", lambda m: console.append((m.type, m.text[:300])))
        page.on("pageerror", lambda e: console.append(("pageerror", str(e)[:300])))
        with tempfile.TemporaryDirectory() as d, sqlite3.connect(Path(d) / "device.db") as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")

            async def invoke(_s, command, fields):
                seen[command] = seen.get(command, 0) + 1
                if command == "http_fetch":
                    r = await context.request.fetch(
                        fields["url"], method=fields["method"], data=fields.get("body"),
                        headers={"Authorization": fields["authorization"], "Content-Type": "application/json"})
                    return {"status": r.status, "body": await r.text()}
                if command == "plugin:fs|exists": return True
                if command == "plugin:path|resolve_directory": return d
                if command == "plugin:sql|load": return fields["db"]
                if command in ("plugin:sql|select", "plugin:sql|execute"):
                    bound = {str(i): v for i, v in enumerate(fields["values"], start=1)}
                    cur = db.execute(fields["query"], bound)
                    if command.endswith("|select"): return [dict(r) for r in cur.fetchall()]
                    db.commit(); return [max(0, cur.rowcount), cur.lastrowid or 0]
                return None

            await page.expose_binding("nativeRequest", invoke)
            await page.add_init_script(f"""
                localStorage.setItem('opendraft:cloudApiUrl', {json.dumps(base + '/api')});
                localStorage.setItem('opendraft:collabAuth', {json.dumps(json.dumps(auth))});
                window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {{ unregisterListener: () => {{}} }};
                window.__TAURI_INTERNALS__ = {{ invoke: (...a) => window.nativeRequest(...a),
                  transformCallback: () => 0, metadata: {{ currentWindow: {{label:'main'}}, currentWebview: {{label:'main', windowLabel:'main'}} }} }};
            """)
            await page.goto(base + "/")
            await page.wait_for_timeout(6000)
            await page.screenshot(path=str(OUT / "discover.png"))
        await browser.close()
    print("IPC commands seen:"); [print(f"  {c}: {n}") for c, n in sorted(seen.items())]
    print("console (errors/warnings):")
    for t, m in console:
        if t in ("error", "pageerror", "warning"): print(f"  [{t}] {m}")

asyncio.run(main(*sys.argv[1:3]))

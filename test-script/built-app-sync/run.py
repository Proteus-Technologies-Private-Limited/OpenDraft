"""End-to-end check of device-project cloud sync through the UI of the BUILT app.

The app is served by the FastAPI backend (backend/static). Only Tauri's IPC is
simulated: HTTP goes to the real backend, and SQL goes to a real SQLite file that
this script can also edit, standing in for edits made outside the open window.

usage: run.py <base-url> <auth.json>   (synthetic account from browser-editing/server.py)
"""
import asyncio, json, os, sqlite3, sys, tempfile, time, uuid

# OPENDRAFT_TRACE=1 prints every native HTTP call and the app's [cloud] console lines.
TRACE = os.environ.get('OPENDRAFT_TRACE') == '1'
T0 = time.monotonic()
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parents[1] / "output" / "built-app-sync"
passed = []


def doc(text):
    return {"type": "doc", "content": [{"type": "action", "content": [{"type": "text", "text": text}]}]}


def now():
    return datetime.now(timezone.utc).isoformat()


async def main(base, auth_path):
    auth = json.loads(Path(auth_path).read_text())
    assert auth["user"]["id"] == "browser-bench", "synthetic account only"
    api = base + "/api"
    headers = {"Authorization": "Bearer " + auth["accessToken"]}
    async with async_playwright() as pw:
        # OPENDRAFT_BROWSER=webkit runs the engine the Mac and iOS apps use.
        engine = os.environ.get("OPENDRAFT_BROWSER", "chromium")
        browser = await getattr(pw, engine).launch()
        print("engine:", engine, browser.version)
        context = await browser.new_context(viewport={"width": 1300, "height": 900})
        page = await context.new_page()
        problems = []
        page.on("pageerror", lambda e: problems.append(str(e)[:300]))
        page.on("console", lambda m: m.type == "error" and problems.append(m.text[:300]))
        if TRACE:
            page.on("console", lambda m: ("[cloud]" in m.text or m.type in ("warning", "error"))
                    and print(f"TRACE {time.monotonic()-T0:7.2f}s console.{m.type}: {m.text[:300]}", flush=True))

        async def cloud(path, method="GET", data=None, ok=(200,)):
            r = await context.request.fetch(api + path, method=method, headers=headers, data=data)
            assert r.status in ok, (method, path, r.status, (await r.text())[:200])
            return await r.json() if r.status == 200 and method != "DELETE" else None

        native_dialogs = []
        with tempfile.TemporaryDirectory() as d, sqlite3.connect(Path(d) / "device.db", check_same_thread=False) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")

            async def invoke(_s, command, fields):
                if command == "http_fetch" and TRACE:
                    started = time.monotonic()
                    try:
                        r = await context.request.fetch(
                            fields["url"], method=fields["method"], data=fields.get("body"),
                            headers={"Authorization": fields["authorization"], "Content-Type": "application/json"})
                    except Exception as error:
                        print(f"TRACE {time.monotonic()-T0:7.2f}s http {fields['method']} {fields['url'][len(api):]} -> EXCEPTION {error!r}", flush=True)
                        raise
                    print(f"TRACE {time.monotonic()-T0:7.2f}s http {fields['method']} {fields['url'][len(api):]} -> {r.status} ({time.monotonic()-started:.2f}s)", flush=True)
                    return {"status": r.status, "body": await r.text()}
                if command == "http_fetch":
                    r = await context.request.fetch(
                        fields["url"], method=fields["method"], data=fields.get("body"),
                        headers={"Authorization": fields["authorization"], "Content-Type": "application/json"})
                    return {"status": r.status, "body": await r.text()}
                if command.startswith("plugin:dialog|"):
                    # The native confirmation (what the app shows instead of window.confirm).
                    native_dialogs.append((command, fields.get("message")))
                    buttons = fields.get("buttons")
                    # Answer as if the writer pressed OK (the plugin compares the reply to its OK label).
                    if isinstance(buttons, dict) and "OkCancelCustom" in buttons:
                        return buttons["OkCancelCustom"][0]  # the label of the button pressed
                    return "Ok"
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
                localStorage.setItem('opendraft:cloudApiUrl', {json.dumps(api)});
                localStorage.setItem('opendraft:collabAuth', {json.dumps(json.dumps(auth))});
                window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {{ unregisterListener: () => {{}} }};
                window.__TAURI_INTERNALS__ = {{ invoke: (...a) => window.nativeRequest(...a), transformCallback: () => 0,
                  metadata: {{ currentWindow: {{label:'main'}}, currentWebview: {{label:'main', windowLabel:'main'}} }} }};
            """)
            await page.goto(base + "/")
            await page.wait_for_timeout(3000)

            # ---- device-side helpers (what an editor save or a delete would do) ----
            cols = {r["name"] for r in db.execute("PRAGMA table_info(scripts)")}
            project = str(uuid.uuid4())
            name = f"Sync demo {project[:8]}"
            stamp = now()
            db.execute("INSERT INTO projects (id, name, properties, created_at, updated_at) VALUES (?,?,?,?,?)",
                       (project, name, "{}", stamp, stamp))

            def add_script(title, text):
                sid = str(uuid.uuid4())
                fmt = (", format", ", 'screenplay'") if "format" in cols else ("", "")
                db.execute(f"INSERT INTO scripts (id, project_id, title, created_at, updated_at{fmt[0]}) "
                           f"VALUES (?,?,?,?,?{fmt[1]})", (sid, project, title, stamp, stamp))
                db.execute("INSERT INTO script_content (script_id, content) VALUES (?,?)", (sid, json.dumps(doc(text))))
                db.commit()
                return sid

            def edit_device(sid, text):
                db.execute("UPDATE script_content SET content=? WHERE script_id=?", (json.dumps(doc(text)), sid))
                db.execute("UPDATE scripts SET updated_at=? WHERE id=?", (now(), sid))
                db.commit()

            def device_text(sid):
                row = db.execute("SELECT content FROM script_content WHERE script_id=?", (sid,)).fetchone()
                return json.loads(row["content"])["content"][0]["content"][0]["text"] if row else None

            def device_titles():
                return sorted(r["title"] for r in db.execute("SELECT title FROM scripts WHERE project_id=?", (project,)))

            def binding():
                return db.execute("SELECT * FROM device_project_sync WHERE project_id=?", (project,)).fetchone()

            async def counterpart():
                return "sync-" + binding()["binding_id"]

            async def cloud_text(sid):
                s = await cloud(f"/projects/{await counterpart()}/scripts/{sid}")
                return s["content"]["content"][0]["content"][0]["text"]

            first, second, third = add_script("First", "first v1"), add_script("Second", "second v1"), add_script("Third", "third v1")

            async def nudge():
                await page.evaluate("window.dispatchEvent(new Event('focus'))")

            async def status():
                return (await page.locator(".device-sync [role=status]").inner_text()).strip()

            async def wait_status(text, timeout=25_000, nudges=True):
                for _ in range(timeout // 1000):
                    if nudges: await nudge()
                    if text.lower() in (await status()).lower():
                        return
                    await page.wait_for_timeout(1000)
                await page.screenshot(path=str(OUT / "failed.png"))
                raise AssertionError(f"status never showed {text!r}; last: {await status()!r}")

            def ok(msg):
                passed.append(msg); print("PASS", msg)

            # ---- A: start syncing --------------------------------------------------
            await page.goto(f"{base}/project/{project}")
            await page.wait_for_selector(".device-sync", timeout=15_000)
            await page.get_by_role("button", name="Sync with OpenDraft Cloud").click()
            await wait_status("Synced to cloud")
            counter = await counterpart()
            ids = {s["id"] for s in await cloud(f"/projects/{counter}/scripts/")}
            assert ids == {first, second, third}, ids
            assert await cloud_text(first) == "first v1"
            ok("A  starting sync uploads every screenplay and shows Synced")
            await page.screenshot(path=str(OUT / "a-synced.png"))

            # ---- B: deleted on the device, then in the cloud: both settle ----------
            db.execute("DELETE FROM scripts WHERE id=?", (second,)); db.commit()
            await wait_status("Synced to cloud")
            assert "Needs attention" not in await status()
            assert await cloud_text(second) == "second v1", "a device deletion must not delete the cloud copy"
            ok("B1 a screenplay deleted on the device settles; the cloud copy is left alone")
            await cloud(f"/projects/{counter}/scripts/{third}", "DELETE")
            await wait_status("Synced to cloud")
            assert device_text(third) == "third v1", "a cloud deletion must not delete the device copy"
            ok("B2 a screenplay deleted in the cloud settles; the device copy is kept")
            for _ in range(3):  # stays settled across several background passes
                await nudge(); await page.wait_for_timeout(1500)
            assert "cloud sync needs attention" not in (await status()).lower()
            ok("B3 stays Synced across later passes")

            # ---- C: a conflict is listed per screenplay and can be settled ----------
            edit_device(first, "first: device edit")
            await cloud(f"/projects/{counter}/scripts/{first}", "PUT", {"content": doc("first: cloud edit")})
            await wait_status("conflicting copies")
            row = page.locator(".device-sync-issues li", has_text="First")
            await row.wait_for(timeout=5000)
            assert "Changed here and in the cloud" in await row.inner_text()
            await page.screenshot(path=str(OUT / "c-conflict-list.png"))
            ok("C1 the conflicting screenplay is listed by name with two choices")
            await row.get_by_role("button", name="Keep this device’s version").click()
            await wait_status("Synced to cloud")
            assert await cloud_text(first) == "first: device edit"
            assert "First (cloud copy)" in device_titles(), device_titles()
            copy_id = db.execute("SELECT id FROM scripts WHERE title='First (cloud copy)'").fetchone()["id"]
            assert device_text(copy_id) == "first: cloud edit"
            ok("C2 'Keep this device's version' uploads it and saves the cloud text as a new screenplay")
            await wait_status("Synced to cloud")
            copy_cloud = await cloud(f"/projects/{counter}/scripts/{copy_id}")
            assert copy_cloud["content"]["content"][0]["content"][0]["text"] == "first: cloud edit"
            ok("C3 the saved copy itself syncs to the cloud")

            edit_device(first, "first: device edit 2")
            await cloud(f"/projects/{counter}/scripts/{first}", "PUT", {"content": doc("first: cloud edit 2")})
            await wait_status("conflicting copies")
            row = page.locator(".device-sync-issues li", has_text="First").first
            await row.get_by_role("button", name="Use the cloud version").click()
            await wait_status("Synced to cloud")
            assert device_text(first) == "first: cloud edit 2"
            assert "First (device copy)" in device_titles(), device_titles()
            ok("C4 'Use the cloud version' takes it and saves the device text as a new screenplay")

            # ---- D: lost upload reply is not a permanent conflict -------------------
            # (covered by unit tests of effectiveBase; the browser path needs a dropped reply)

            # ---- E: cloud counterpart deleted: start a new copy ---------------------
            await cloud(f"/projects/{counter}", "DELETE")
            await wait_status("cloud copy of this project was deleted")
            await page.screenshot(path=str(OUT / "e-missing.png"))
            await page.get_by_role("button", name="Start a new cloud copy").click()
            await wait_status("Synced to cloud")
            counter2 = await counterpart()
            assert counter2 != counter
            titles = sorted(s["title"] for s in await cloud(f"/projects/{counter2}/scripts/"))
            assert titles == device_titles(), (titles, device_titles())
            ok("E  a deleted cloud copy is recreated from the device with every screenplay")

            # ---- F: the counterpart is hidden from the cloud tab while it syncs -----
            listed = [p["id"] for p in (await cloud("/projects/"))["projects"]]
            assert counter2 in listed  # it exists in the account...

            async def cloud_tab_text():
                await page.goto(base + "/projects")
                await page.wait_for_timeout(1500)
                await page.get_by_text("OpenDraft Cloud", exact=True).first.click()
                await page.wait_for_timeout(2500)
                return await page.inner_text("body")

            assert name not in await cloud_tab_text()
            await page.screenshot(path=str(OUT / "f-cloud-tab.png"))
            ok("F1 ...but is not listed on the Projects screen's cloud tab while this device syncs it")
            await page.goto(f"{base}/project/{project}")
            await page.wait_for_selector(".device-sync", timeout=15_000)
            await page.get_by_role("button", name="Stop syncing").click()
            await page.get_by_role("button", name="Sync with OpenDraft Cloud").wait_for(timeout=10_000)
            assert name in await cloud_tab_text()
            ok("F2 after Stop syncing it is an ordinary cloud project and is listed again")

            # Leave the synthetic account as it was found.
            await cloud(f"/projects/{counter2}", "DELETE")

            # ---- G (#291): a downloaded cloud script in conflict, then deleted ------
            cloud_project = (await cloud("/projects/", "POST", {"name": f"Offline demo {project[:8]}"}))["id"]
            draft = (await cloud(f"/projects/{cloud_project}/scripts/", "POST",
                                 {"title": "Draft", "content": doc("cloud v1")}))["meta"]["id"]
            dialogs = []
            page.on("dialog", lambda dlg: (dialogs.append(dlg.message), asyncio.ensure_future(dlg.accept())))
            await page.goto(base + "/projects")
            await page.wait_for_timeout(1500)
            await page.get_by_text("OpenDraft Cloud", exact=True).first.click()
            await page.get_by_text(f"Offline demo {project[:8]}").first.click()
            await page.get_by_text("Draft", exact=True).first.click()
            editor = page.locator(".ProseMirror").first
            await editor.get_by_text("cloud v1").wait_for(timeout=15_000)
            # Another device changes the cloud copy; this device types on its old one.
            await cloud(f"/projects/{cloud_project}/scripts/{draft}", "PUT", {"content": doc("cloud v2")})
            await editor.get_by_text("cloud v1").click()
            await page.keyboard.press("End")
            await page.keyboard.type(" device edit")
            # Save as a writer would. Otherwise the upload waits for the next
            # autosave tick (every 30 s by default), which is what made this step
            # look flaky: it raced the timer, not a failing upload.
            await page.keyboard.press("Control+s")
            banner = page.locator(".cloud-sync-banner")
            try:
                await banner.wait_for(timeout=15_000)
            except Exception:
                await page.screenshot(path=str(OUT / "failed-g1.png"))
                print("G1 status line:", await page.locator(".status-item").all_inner_texts())
                print("G1 editor text:", (await editor.inner_text())[:200])
                raise
            assert "conflict" in (await banner.inner_text()).lower(), await banner.inner_text()
            await page.screenshot(path=str(OUT / "g-conflict-banner.png"))
            status_line = page.locator(".status-item", has_text="Cloud conflict").first
            assert "status-save-error" in (await status_line.get_attribute("class") or ""), \
                "a conflict must not be shown in the 'saved' colour"
            ok("G1 an offline edit against a changed cloud copy shows the conflict banner with both choices, in the error colour")
            # The cloud copy is then deleted, so there is nothing to upload onto.
            await cloud(f"/projects/{cloud_project}/scripts/{draft}", "DELETE")
            await banner.get_by_role("button", name="Upload my version").click()
            toast = page.locator(".toast-message--error").last
            try:
                await toast.wait_for(timeout=10_000)
            except Exception:
                await page.screenshot(path=str(OUT / "failed-g2.png"))
                print("native dialogs:", native_dialogs, "window dialogs:", dialogs, "problems:", problems)
                raise
            assert not dialogs, f"window.confirm was used: {dialogs}"
            assert any("Replace the current cloud version" in (m or "") for _, m in native_dialogs), (native_dialogs, problems)
            ok("G2a 'Upload my version' asks through the native dialog, not window.confirm")
            assert "deleted from the cloud" in await toast.inner_text(), await toast.inner_text()
            assert await banner.is_visible(), "the device copy must stay in conflict, not be dropped"
            await page.screenshot(path=str(OUT / "g-deleted-message.png"))
            ok("G2 'Upload my version' on a script deleted from the cloud says so, and keeps the device copy")
            await banner.get_by_role("button", name="Use cloud version").click()
            await page.wait_for_url("**/projects", timeout=10_000)
            ok("G3 'Use cloud version' then removes the device copy of the deleted script")
            await cloud(f"/projects/{cloud_project}", "DELETE")

            # ---- H: going back to a cloud screenplay after signing out ---------------
            h_project = (await cloud("/projects/", "POST", {"name": f"Account switch {project[:8]}"}))["id"]
            await cloud(f"/projects/{h_project}/scripts/", "POST", {"title": "Owned", "content": doc("owned by this account")})
            await page.goto(base + "/projects")
            await page.wait_for_timeout(1500)
            await page.get_by_text("OpenDraft Cloud", exact=True).first.click()
            await page.get_by_text(f"Account switch {project[:8]}").first.click()
            await page.get_by_text("Owned", exact=True).first.click()
            await page.locator(".ProseMirror").first.get_by_text("owned by this account").wait_for(timeout=15_000)
            await page.wait_for_timeout(1500)
            assert not await page.get_by_text("Recover unsaved changes?").count(), \
                "text discarded with 'Use cloud version' must not be offered back for recovery"
            ok("G4 text discarded with 'Use cloud version' is not offered back as unsaved changes")
            # Navigate inside the app, as a writer would: a full page load would
            # re-run the harness's sign-in script.
            await page.screenshot(path=str(OUT / "h-before-menu.png"))
            await page.locator(".menubar, [role=menubar]").first.get_by_text("Tools", exact=True).click()
            await page.screenshot(path=str(OUT / "h-tools-menu.png"))
            await page.get_by_text("System Settings", exact=False).first.click()
            await page.get_by_text("Account & Sharing", exact=True).first.click()
            await page.get_by_role("button", name="Sign Out").first.click()
            await page.wait_for_timeout(1500)
            await page.go_back()
            closed = page.locator(".toast-message--info", has_text="belongs to the account you signed out of")
            await closed.wait_for(timeout=10_000)
            await page.wait_for_timeout(1000)
            errors = await page.locator(".toast-message--error").all_inner_texts()
            assert not errors, errors
            assert urlsplit(page.url).path == "/", page.url
            assert "owned by this account" not in await page.locator(".ProseMirror").first.inner_text()
            await page.screenshot(path=str(OUT / "h-closed-after-sign-out.png"))
            ok("H  a cloud screenplay of the signed-out account closes with a plain message, not an error")
        await browser.close()
    print(f"\n{len(passed)} checks passed")
    # The synthetic server has no collaboration server, so the device list in Settings cannot load.
    real = [p for p in problems if "favicon" not in p and "Loading signed-in devices failed" not in p]
    print("console errors:", real or "none")


asyncio.run(main(*sys.argv[1:3]))

"""Device sync against real SQLite and the isolated cloud API.

Uses a Vite fixture page and a Tauri IPC shim. Pass the loopback Vite URL,
the API base, and the synthetic auth.json from browser-editing/server.py.
"""

import argparse
import asyncio
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from urllib.parse import urlsplit

from playwright.async_api import async_playwright


def doc(text):
    return {
        "type": "doc",
        "content": [
            {
                "type": "action",
                "content": [
                    {"type": "text", "text": text},
                ],
            }
        ],
    }


async def run(args):
    auth = json.loads(Path(args.auth).read_text())
    if (
        auth["user"]["id"] != "browser-bench"
        or auth["user"]["email"] != "browser-bench@example.invalid"
    ):
        raise ValueError("Only the isolated synthetic account may run this test")
    frontend, api = args.frontend.rstrip("/"), args.api.rstrip("/")
    if any(
        urlsplit(url).hostname not in ("127.0.0.1", "localhost")
        for url in (frontend, api)
    ):
        raise ValueError("Both URLs must use loopback")
    auth_header = {"Authorization": "Bearer " + auth["accessToken"]}

    async with async_playwright() as browser_tools:
        if os.environ.get("OPENDRAFT_BROWSER") == "webkit":
            browser = await browser_tools.webkit.launch(
                executable_path=os.environ.get("OPENDRAFT_WEBKIT_EXECUTABLE")
            )
        else:
            browser = await browser_tools.chromium.launch(
                executable_path="/usr/bin/chromium", args=["--no-sandbox"]
            )
        context = await browser.new_context()
        page = await context.new_page()
        calls = []

        async def request(path, method="GET", data=None, expected=200):
            response = await context.request.fetch(
                api + path, method=method, data=data, headers=auth_header
            )
            assert response.status == expected, (method, path, response.status)
            return await response.json()

        with tempfile.TemporaryDirectory() as directory, sqlite3.connect(
            Path(directory) / "device.db"
        ) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")

            async def invoke(_source, command, fields):
                if command == "http_fetch":
                    assert fields["url"].startswith(api + "/")
                    calls.append((fields["method"], fields["url"]))
                    response = await context.request.fetch(
                        fields["url"],
                        method=fields["method"],
                        data=fields.get("body"),
                        headers={
                            "Authorization": fields["authorization"],
                            "Content-Type": "application/json",
                        },
                    )
                    return {"status": response.status, "body": await response.text()}
                if command == "plugin:fs|exists":
                    return True
                if command == "plugin:path|resolve_directory":
                    return directory
                if command == "plugin:sql|load":
                    return fields["db"]
                if command in ("plugin:sql|select", "plugin:sql|execute"):
                    bound = {
                        str(index): value
                        for index, value in enumerate(fields["values"], start=1)
                    }
                    cursor = db.execute(fields["query"], bound)
                    if command.endswith("|select"):
                        return [dict(row) for row in cursor.fetchall()]
                    db.commit()
                    return [max(0, cursor.rowcount), cursor.lastrowid or 0]
                raise AssertionError(f"Unexpected IPC call {command}")

            await page.expose_binding("nativeRequest", invoke)
            await page.route(
                "**/device-sync-test.html",
                lambda route: route.fulfill(
                    content_type="text/html",
                    body="<!doctype html><title>Synthetic device project</title>",
                ),
            )
            await page.add_init_script(f"""
                localStorage.setItem('opendraft:cloudApiUrl', {json.dumps(api)});
                localStorage.setItem('opendraft:collabAuth', {json.dumps(json.dumps(auth))});
                window.__TAURI_INTERNALS__ = {{ invoke: (...args) => window.nativeRequest(...args) }};
                window.online = sessionStorage.getItem('online') === 'true';
                Object.defineProperty(navigator, 'onLine', {{get: () => window.online}});
            """)

            async def load():
                await page.goto(frontend + "/device-sync-test.html")
                await page.evaluate("""async () => {
                    const { initI18n } = await import('/src/i18n/index.ts');
                    await initI18n();
                    const { api } = await import('/src/services/api.ts');
                    const { createLocalStorage } = await import('/src/services/local-storage.ts');
                    Object.assign(api, await createLocalStorage());
                    const { scriptApi } = await import('/src/services/scriptApi.ts');
                    const sync = await import('/src/services/deviceProjectSync.ts');
                    const store = await import('/src/services/deviceSyncStore.ts');
                    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
                    Object.assign(window, { api, scriptApi, sync, store, settings: useSettingsStore });
                    sync.startDeviceProjectSync();
                }""")

            async def online(value):
                await page.evaluate(
                    """on => {
                    window.online = on;
                    sessionStorage.setItem('online', String(on));
                    dispatchEvent(new Event(on ? 'online' : 'offline'));
                }""",
                    value,
                )

            async def binding():
                return await page.evaluate("id => store.readBinding(id)", project)

            async def toggle(value):
                return await page.evaluate(
                    "([id, on]) => sync.setDeviceProjectSync(id, on)", [project, value]
                )

            async def status(value):
                await page.wait_for_function(
                    "([id, state]) => sync.deviceSyncStatus(id)?.state === state",
                    arg=[project, value],
                    timeout=20_000,
                )

            async def save(script, text):
                await page.evaluate(
                    "([id, script, content]) => scriptApi.saveScript(id, script, { content })",
                    [project, script, doc(text)],
                )

            async def local(script, before_open=False):
                return (
                    await page.evaluate(
                        "([id, script, refresh]) => (refresh ? scriptApi : api).getScript(id, script)",
                        [project, script, before_open],
                    )
                )["content"]

            await load()
            created = await page.evaluate(
                """async ([a,b]) => {
                const project = await api.createProject('Synthetic test project');
                const first = await api.createScript(project.id, {title:'First', content:a, skipFileSync:true});
                const second = await api.createScript(project.id, {title:'Second', content:b, skipFileSync:true});
                return [project.id, first.meta.id, second.meta.id];
            }""",
                [doc("First draft"), doc("Second draft")],
            )
            project, first, second = created

            assert await toggle(True) == "ok"
            before_restart = await binding()
            assert before_restart["enabled"] == 1 and not calls
            await load()
            assert await binding() == before_restart
            await online(True)
            await status("synced")
            remote = "sync-" + before_restart["binding_id"]
            route = f"/projects/{remote}/scripts"
            assert (await request(f"{route}/{first}"))["content"] == doc("First draft")
            assert (await request(f"{route}/{second}"))["content"] == doc(
                "Second draft"
            )
            assert await page.evaluate(
                "async id => (await sync.activeCloudCounterparts()).has(id)", remote
            )
            print("Offline enable survives restart and publishes both screenplays once")

            await save(first, "First local change")

            async def await_remote(script, content):
                for _ in range(80):
                    if (await request(f"{route}/{script}"))["content"] == content:
                        return
                    await asyncio.sleep(0.125)
                raise AssertionError("Cloud did not receive the local save")

            await await_remote(first, doc("First local change"))

            await request(
                f"{route}/{first}", "PUT", {"content": doc("Cloud-only edit")}
            )
            await page.evaluate("sync.wakeDeviceProjectSync()")
            await status("pending")
            assert await local(first) == doc("First local change")
            assert await local(first, True) == doc("Cloud-only edit")
            print("Local edits upload and a clean remote edit is pulled on reopen")

            extra = (
                await request(
                    route + "/",
                    "POST",
                    {
                        "title": "New cloud screenplay",
                        "content": doc("Written on another device"),
                    },
                )
            )["meta"]["id"]
            await page.evaluate("sync.wakeDeviceProjectSync()")
            for _ in range(80):
                listed = await page.evaluate("id => api.listScripts(id)", project)
                if any(script["id"] == extra for script in listed):
                    break
                await asyncio.sleep(0.125)
            else:
                raise AssertionError(
                    "The cloud screenplay did not arrive in the device project"
                )
            assert await local(extra) == doc("Written on another device")

            await online(False)
            assert await toggle(False) == "ok"
            await save(first, "After stopping")
            await online(True)
            await status("off")
            assert await local(first) == doc("After stopping")
            assert (await request(f"{route}/{first}"))["content"] == doc(
                "Cloud-only edit"
            )
            assert not await page.evaluate(
                "async id => (await sync.activeCloudCounterparts()).has(id)", remote
            )
            assert await toggle(True) == "ok"
            await status("synced")
            assert (await binding())["binding_id"] == before_restart["binding_id"]
            assert (await request(f"{route}/{first}"))["content"] == doc(
                "After stopping"
            )
            print(
                "Stop preserves both copies and resume reuses the existing counterpart"
            )

            await online(False)
            await save(second, "Device conflict")
            await request(
                f"{route}/{second}", "PUT", {"content": doc("Cloud conflict")}
            )
            await online(True)
            await status("conflict")
            assert await local(second, True) == doc("Device conflict")
            assert (await request(f"{route}/{second}"))["content"] == doc(
                "Cloud conflict"
            )
            print("Divergent edits preserve both copies")
            duplicate = await request(
                f"/projects/{remote}/device-scripts/{second}",
                "PUT",
                {
                    "title": "Retry",
                    "content": doc("Should never replace existing content"),
                },
            )
            assert duplicate["content"] == doc("Cloud conflict")

            await online(False)
            await page.evaluate("""() => {
                const auth = settings.getState().collabAuth;
                settings.getState().setCollabAuth({ ...auth, user: { ...auth.user, id: 'other-account' } });
            }""")
            assert await toggle(False) == "ok"
            assert await toggle(True) == "account"
            assert await local(second) == doc("Device conflict")
            print("A different account cannot attach the local project to its cloud")
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frontend")
    parser.add_argument("api")
    parser.add_argument("auth")
    asyncio.run(run(parser.parse_args()))

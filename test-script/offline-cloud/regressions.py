"""Native cloud routing with real IndexedDB and the isolated Python backend.

The browser simulates only Tauri's HTTP transport and network transitions.
Start test-script/browser-editing/server.py and Vite, then pass their loopback
URLs and the synthetic auth.json. Never point this test at real account data.
"""

import argparse
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from playwright.async_api import async_playwright


def doc(text):
    return {
        "type": "doc",
        "content": [
            {
                "type": "action",
                "content": [{"type": "text", "text": text}],
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
    api = args.api.rstrip("/")
    if not api.endswith("/api"):
        api += "/api"
    frontend = args.frontend.rstrip("/")
    if any(
        urlsplit(url).hostname not in ("127.0.0.1", "localhost")
        for url in [api, frontend]
    ):
        raise ValueError("Both services must use loopback")
    headers = {"Authorization": "Bearer " + auth["accessToken"]}

    async with async_playwright() as playwright:
        if os.environ.get("OPENDRAFT_BROWSER") == "webkit":
            browser = await playwright.webkit.launch(
                executable_path=os.environ.get("OPENDRAFT_WEBKIT_EXECUTABLE")
            )
        else:
            chromium = os.environ.get("OPENDRAFT_CHROMIUM", "/usr/bin/chromium")
            browser = await playwright.chromium.launch(
                executable_path=chromium, args=["--no-sandbox"]
            )
        context = await browser.new_context()

        async def api_call(path, method="GET", data=None, expected=200):
            response = await context.request.fetch(
                api + path, method=method, headers=headers, data=data
            )
            assert response.status == expected, (method, path, response.status)
            return await response.json()

        project = (
            await api_call(
                "/projects/", "POST", {"name": f"Synthetic offline cloud {uuid4()}"}
            )
        )["id"]
        base = f"/projects/{project}/scripts"

        async def create(text):
            return (
                await api_call(
                    base + "/", "POST", {"title": text, "content": doc(text)}
                )
            )["meta"]["id"]

        first, conflicted, removed = [
            await create(text) for text in ("First", "Conflict", "Removed")
        ]
        requests = []
        upload_received = asyncio.Event()
        release_ack = asyncio.Event()
        delay_next_ack = False
        reject_next_upload = False
        transient_failure = asyncio.Event()

        async def tauri_http(_source, command, fields):
            nonlocal delay_next_ack, reject_next_upload
            assert command == "http_fetch" and fields["url"].startswith(api + "/")
            sent_headers = {"Content-Type": "application/json"}
            if fields.get("authorization"):
                sent_headers["Authorization"] = fields["authorization"]
            method = fields["method"]
            url = fields["url"]
            requests.append((method, url))
            if reject_next_upload and url.endswith(f"/{first}/offline-content"):
                reject_next_upload = False
                transient_failure.set()
                return {"status": 503, "body": ""}
            response = await context.request.fetch(
                url, method=method, data=fields.get("body"), headers=sent_headers
            )
            if delay_next_ack and url.endswith(f"/{first}/offline-content"):
                delay_next_ack = False
                upload_received.set()
                await asyncio.wait_for(release_ack.wait(), 15)
                # The server has committed, but the device sees a lost response.
                return {"status": 503, "body": ""}
            return {"status": response.status, "body": await response.text()}

        page = await context.new_page()
        await page.expose_binding("nativeRequest", tauri_http)
        await page.route(
            "**/offline-cloud-test.html",
            lambda route: route.fulfill(
                content_type="text/html",
                body="""<!doctype html><title>Synthetic cloud test</title>
                    <script type="module">
                      import RefreshRuntime from '/@react-refresh';
                      RefreshRuntime.injectIntoGlobalHook(window);
                      window.$RefreshReg$ = () => {};
                      window.$RefreshSig$ = () => type => type;
                      window.__vite_plugin_react_preamble_installed__ = true;
                    </script>""",
            ),
        )
        await page.add_init_script(f"""
            localStorage.setItem('opendraft:cloudApiUrl', {json.dumps(api)});
            localStorage.setItem('opendraft:collabAuth', {json.dumps(json.dumps(auth))});
            window.__TAURI_INTERNALS__ = {{invoke: (...args) => window.nativeRequest(...args)}};
            window.online = sessionStorage.getItem('online') !== 'false';
            Object.defineProperty(navigator, 'onLine', {{get: () => window.online}});
        """)

        async def load_page():
            await page.goto(frontend + "/offline-cloud-test.html")
            await page.wait_for_function("window.__vite_plugin_react_preamble_installed__")
            await page.evaluate("""async () => {
                const { initI18n } = await import('/src/i18n/index.ts');
                await initI18n();
                const { offlineCloud, offlineCloudStatus, resolveOfflineCloudConflict, startOfflineCloudSync }
                    = await import('/src/services/offlineCloud.ts');
                const offlineStore = await import('/src/services/offlineCloudStore.ts');
                const { scriptApi } = await import('/src/services/scriptApi.ts');
                const { projectApi } = await import('/src/services/projectApi.ts');
                const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
                const { useProjectStore } = await import('/src/stores/projectStore.ts');
                Object.assign(window, { cloud: offlineCloud, offlineCloudStatus,
                    resolveOfflineCloudConflict, offlineStore, scriptApi, projectApi,
                    settings: useSettingsStore, projects: useProjectStore });
                startOfflineCloudSync();
            }""")
            await page.evaluate(
                "id => projects.getState().markCloudProject(id)", project
            )

        async def go_online(on):
            await page.evaluate(
                """on => {
                window.online = on;
                sessionStorage.setItem('online', String(on));
                if (on) dispatchEvent(new Event('online'));
            }""",
                on,
            )

        async def get(script):
            return (
                await page.evaluate(
                    "([p, s]) => scriptApi.getScript(p, s)", [project, script]
                )
            )["content"]

        async def save(script, text):
            return await page.evaluate(
                "([p, s, content]) => scriptApi.saveScript(p, s, { content })",
                [project, script, doc(text)],
            )

        async def state(script, name):
            await page.wait_for_function(
                "([p, s, name]) => offlineCloudStatus(p, s)?.state === name",
                arg=[project, script, name],
                timeout=15_000,
            )

        await load_page()
        assert any(
            p["id"] == project for p in await page.evaluate("cloud.listProjects()")
        )
        await page.evaluate("id => projectApi.getProject(id)", project)
        assert (
            len(await page.evaluate("id => projectApi.listScripts(id)", project)) == 3
        )
        for script, text in [
            (first, "First"),
            (conflicted, "Conflict"),
            (removed, "Removed"),
        ]:
            assert await get(script) == doc(text)

        await go_online(False)
        offline_request_count = len(requests)
        await save(first, "Device save before restart")
        await save(conflicted, "Laptop conflict copy")
        await save(removed, "Available even after remote deletion")
        assert len(requests) == offline_request_count
        await load_page()
        assert await get(first) == doc("Device save before restart")
        assert (
            len(await page.evaluate("id => projectApi.listScripts(id)", project)) == 3
        )
        await state(first, "pending")
        assert len(requests) == offline_request_count
        print("Offline edits, project browsing and restart persist without HTTP")

        await api_call(
            f"{base}/{conflicted}", "PUT", {"content": doc("Phone conflict copy")}
        )
        await api_call(f"{base}/{removed}", "DELETE")
        reject_next_upload = True
        await go_online(True)
        await asyncio.wait_for(transient_failure.wait(), 15)
        await state(first, "pending")
        assert (await api_call(f"{base}/{first}"))["content"] == doc("First")
        delay_next_ack = True
        await go_online(True)
        await asyncio.wait_for(upload_received.wait(), 15)
        await save(first, "Newer save during upload")
        release_ack.set()
        await state(first, "synced")
        await state(conflicted, "conflict")
        await state(removed, "conflict")
        assert (await api_call(f"{base}/{first}"))["content"] == doc(
            "Newer save during upload"
        )
        assert (await api_call(f"{base}/{conflicted}"))["content"] == doc(
            "Phone conflict copy"
        )
        assert await get(conflicted) == doc("Laptop conflict copy")
        assert await get(removed) == doc("Available even after remote deletion")
        assert removed in [
            s["id"]
            for s in await page.evaluate("id => projectApi.listScripts(id)", project)
        ]
        print(
            "Reconnect recovers a lost acknowledgment, preserves newer local saves and retains both conflict copies"
        )

        async def resolve(script, choice):
            return await page.evaluate(
                "([p, s, choice]) => resolveOfflineCloudConflict(p, s, choice)",
                [project, script, choice],
            )

        assert await resolve(conflicted, "device") == "resolved"
        await state(conflicted, "synced")
        assert (await api_call(f"{base}/{conflicted}"))["content"] == doc(
            "Laptop conflict copy"
        )
        assert await resolve(removed, "cloud") == "removed"
        assert removed not in [
            s["id"] for s in await page.evaluate("id => projectApi.listScripts(id)", project)
        ]
        await api_call(f"{base}/{conflicted}", "PUT", {"content": doc("Updated phone copy")})
        await save(conflicted, "Another conflict copy")
        await state(conflicted, "conflict")
        assert await resolve(conflicted, "cloud") == "resolved"
        assert await get(conflicted) == doc("Updated phone copy")
        print("Both conflict actions clear the conflict and deleted copies can be removed")

        # A failed precondition cannot reach the unconditional PUT route,
        # including when the same request is repeated after a lost response.
        route = f"{base}/{first}/offline-content"
        revision = (await api_call(f"{base}/{first}"))["content_revision"]
        payload = {
            "content": doc("Idempotent upload"),
            "expected_content_revision": revision,
        }
        result = await api_call(route, "PUT", payload)
        assert (await api_call(route, "PUT", payload))["content_revision"] == result[
            "content_revision"
        ]
        await api_call(
            route,
            "PUT",
            {**payload, "content": doc("Stale second device")},
            expected=412,
        )
        assert (await api_call(f"{base}/{first}"))["content"] == doc(
            "Idempotent upload"
        )
        await api_call(route, "PUT", {"content": doc("Missing revision")}, expected=422)
        print(
            "Server requires the base revision, accepts identical retries and rejects stale writes"
        )

        async def race(text):
            response = await context.request.put(
                api + route,
                headers=headers,
                data={
                    "content": doc(text),
                    "expected_content_revision": result["content_revision"],
                },
            )
            return response.status

        assert sorted(
            await asyncio.gather(race("Device one wins"), race("Device two wins"))
        ) == [200, 412]
        print(
            "Simultaneous saves from the same base revision produce exactly one winner"
        )

        await go_online(False)
        await save(conflicted, "Draft retained after project deletion")
        await api_call(f"/projects/{project}", "DELETE")
        await go_online(True)
        await state(conflicted, "conflict")
        assert any(
            p["id"] == project for p in await page.evaluate("cloud.listProjects()")
        )
        await page.evaluate("id => projectApi.getProject(id)", project)
        assert conflicted in [
            s["id"]
            for s in await page.evaluate("id => projectApi.listScripts(id)", project)
        ]
        assert await get(conflicted) == doc("Draft retained after project deletion")

        await go_online(False)
        await page.evaluate("""() => {
            const auth = settings.getState().collabAuth;
            settings.getState().setCollabAuth({...auth, user: {...auth.user, id: 'other-device-account'}});
        }""")
        try:
            await page.evaluate(
                "([p, s]) => cloud.getScript(p, s)", [project, conflicted]
            )
        except Exception as error:
            assert "not available offline" in str(error)
        else:
            raise AssertionError(
                "A different account could read the previous account's offline draft"
            )
        scope = json.dumps([api, auth["user"]["id"]], separators=(",", ":"))
        await page.wait_for_function(
            """async ([scope, p, first, conflict]) => {
                const downloaded = await offlineStore.readOfflineScript([scope, p, first]);
                const queued = await offlineStore.readOfflineScript([scope, p, conflict]);
                const catalog = await offlineStore.readOfflineCatalog(scope, 'projects');
                return !downloaded && !catalog && queued?.state === 'conflict';
            }""",
            arg=[scope, project, first, conflicted],
        )
        await page.evaluate("auth => settings.getState().setCollabAuth(auth)", auth)
        await go_online(True)
        assert any(p["id"] == project for p in await page.evaluate("cloud.listProjects()"))
        await page.evaluate("id => projectApi.deleteProject(id)", project)
        assert all(p["id"] != project for p in await page.evaluate("cloud.listProjects()"))
        print("Account changes remove downloads and the catalogue, and explicit deletion removes queued copies")
        await browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frontend")
    parser.add_argument("api")
    parser.add_argument("auth")
    asyncio.run(run(parser.parse_args()))

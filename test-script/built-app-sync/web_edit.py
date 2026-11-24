"""Edit a cloud screenplay through the WEB app's editor, as another device would.

usage: web_edit.py <base-url> <email> <password> <project name> <screenplay title> <text to type>
Signs in through the API (the login form is not under test), then opens the
screenplay from the Projects screen and types at the end of its first line, so
the save goes through the web app's normal autosave.
"""
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parents[1] / "output" / "built-app-sync"


async def main(base, email, password, project, title, text):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        context = await browser.new_context(viewport={"width": 1300, "height": 900})
        r = await context.request.post(base + "/api/auth/login", data={"email": email, "password": password})
        assert r.status == 200, (r.status, await r.text())
        login = await r.json()
        auth = {"accessToken": login["accessToken"], "refreshToken": login.get("refreshToken"), "user": login["user"]}
        page = await context.new_page()
        await page.add_init_script(f"localStorage.setItem('opendraft:collabAuth', {json.dumps(json.dumps(auth))});")
        await page.goto(base + "/projects")
        await page.get_by_text(project, exact=True).first.click()
        await page.get_by_text(title, exact=True).first.click()
        editor = page.locator(".ProseMirror").first
        await editor.locator("p, div").first.wait_for(timeout=15_000)
        first_line = editor.locator("> *").first
        await first_line.click()
        await page.keyboard.press("End")
        await page.keyboard.type(text)
        # Wait for the web autosave to land on the server.
        for _ in range(30):
            await page.wait_for_timeout(1000)
            status = await page.locator(".status-item").all_inner_texts()
            if any(s.strip() == "Saved" for s in status):
                break
        await page.screenshot(path=str(OUT / "web-edit.png"))
        print("web editor now shows:", (await first_line.inner_text())[:200])
        await browser.close()

asyncio.run(main(*sys.argv[1:7]))

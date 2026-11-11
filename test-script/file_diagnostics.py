"""Check Help → Diagnostics and its copied report using synthetic native IPC.

Requires Python Playwright and Vite at OPENDRAFT_TEST_URL. No file is written.
OPENDRAFT_DIAGNOSTICS_SCREENSHOT optionally captures the synthetic report.
"""

import json
import os
import re
from playwright.sync_api import expect, sync_playwright

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get("OPENDRAFT_CHROMIUM")
        or ("/usr/bin/chromium" if os.path.isfile("/usr/bin/chromium") else None),
        args=["--no-sandbox"],
    )
    context = browser.new_context(
        viewport={"width": 1280, "height": 900},
        permissions=["clipboard-read", "clipboard-write"],
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173/"))
    page.locator(".editor-main").wait_for()
    blank = page.get_by_role("button", name="Blank Document", exact=False)
    if blank.count():
        blank.click()
    page.locator(".ProseMirror").wait_for()
    page.evaluate("""async () => {
        const moduleUrl=path=>performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname===path)?.name ?? path;
        window.diagnosticFiles=await import(moduleUrl('/src/utils/fileOps.ts'));
        window.diagnosticFailure='Save failed during staging: Operation not permitted (os error 1)';
        window.diagnosticCancelled=false;
        window.__TAURI_INTERNALS__={invoke:async (command)=>{
            if(command==='plugin:app|version')return '8.7.6';
            if(command.startsWith('plugin:path|'))return '/synthetic/application-data';
            if(command==='plugin:dialog|save')return diagnosticCancelled ? null : '/synthetic/example.fdx';
            if(command==='save_text_to_path' && diagnosticFailure)throw diagnosticFailure;
            return null;
        }};
        try {await diagnosticFiles.saveFile('SYNTHETIC CONTENT MUST NOT BE RECORDED','example.fdx');} catch {}
    }""")

    def open_diagnostics():
        page.locator(".menu-item").filter(has_text=re.compile(r"^Help$")).click()
        page.locator(".menu-dropdown-item").filter(
            has_text=re.compile(r"^Diagnostics$")
        ).click()
        dialog = page.locator(".dialog-box.about-dialog")
        dialog.wait_for()
        return dialog

    dialog = open_diagnostics()
    expect(dialog.get_by_text("8.7.6", exact=True)).to_be_visible()
    expect(
        dialog.get_by_text("Last file failure (this session)", exact=True)
    ).to_be_visible()
    expect(dialog.locator("pre")).to_contain_text("Stage: staging")
    expect(dialog.locator("pre")).to_contain_text("Command: save_text_to_path")
    if os.environ.get("OPENDRAFT_DIAGNOSTICS_SCREENSHOT"):
        page.screenshot(path=os.environ["OPENDRAFT_DIAGNOSTICS_SCREENSHOT"])
    dialog.get_by_role("button", name="Copy Report", exact=True).click()
    expect(dialog.get_by_role("button", name="Copied ✓", exact=True)).to_be_visible()
    copied = page.evaluate("navigator.clipboard.readText()")
    for fragment in [
        "Version: 8.7.6",
        "Operation: export",
        "Format: fdx",
        "Stage: staging",
        "(os error 1)",
    ]:
        assert fragment in copied, copied
    assert "SYNTHETIC CONTENT MUST NOT BE RECORDED" not in copied
    dialog.get_by_role("button", name="Close", exact=True).click()
    # Each subsequent error is a new snapshot; a cancelled dialog is not an error.
    for stage in ["backup", "replacement"]:
        page.evaluate(
            """async stage => {
            diagnosticFailure='Save failed during '+stage+': synthetic OS failure';
            try {await diagnosticFiles.saveFile('private data','example.fdx');} catch {}
        }""",
            stage,
        )
        dialog = open_diagnostics()
        expect(dialog.locator("pre")).to_contain_text("Stage: " + stage)
        dialog.get_by_role("button", name="Close", exact=True).click()
    page.evaluate("""async () => {
        diagnosticCancelled=true;
        if(await diagnosticFiles.saveFile('private data','example.fdx')!==false)throw Error('Expected cancellation');
    }""")
    dialog = open_diagnostics()
    expect(dialog.locator("pre")).to_contain_text("Stage: replacement")
    assert not errors, errors
    print(
        json.dumps(
            {
                "native_version": True,
                "staging_backup_replacement": True,
                "copied_report": True,
                "no_script_contents": True,
                "cancellation": True,
                "errors": errors,
            }
        )
    )
    browser.close()

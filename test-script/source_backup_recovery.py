"""Recovery UI with synthetic native responses; run against local Vite.

Uses the real component, i18n, modal and saveFile path. This is not a signed
macOS/Powerbox test. The temporary harness is removed after the run.
"""

import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
HARNESS = ROOT / "frontend" / ".source-recovery-review.html"
HTML = """<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><div id="root"></div><script type="module">
window.calls=[];
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  calls.push({command,args});
  if(command==='list_source_backups')return [
    {name:'source-a/1700000000000-1-draft.fdx',originalName:'draft.fdx',sourcePath:'/Projects/Feature/draft.fdx',modifiedAt:1762862400000,size:5},
    {name:'source-b/1700000000001-2-draft.fdx',originalName:'draft.fdx',sourcePath:'/Projects/Short/draft.fdx',modifiedAt:1762776000000,size:5},
    {name:'1700000000002-3-legacy.fountain',size:5}
  ];
  if(command==='read_source_backup') {if(window.failRead)throw Error('Synthetic read failure');return [0,255,128,10,90];}
  if(command==='plugin:dialog|save')return window.cancelSave?null:'/Exports/recovered.fdx';
  return null;
}};
const React=await import('react');
const {createRoot}=await import('react-dom/client');
const {initI18n,setLanguage}=await import('/src/i18n/index.ts');
await initI18n();
window.setLanguage=setLanguage;
await import('/src/styles/screenplay.css');
const {default:Recovery}=await import('/src/components/SourceBackupRecovery.tsx');
window.root=createRoot(document.getElementById('root'));
window.showRecovery=()=>root.render(React.createElement(Recovery,{onClose:()=>root.render(null)}));
showRecovery();
</script></body></html>"""


def main() -> None:
    HARNESS.write_text(HTML)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=os.environ.get("OPENDRAFT_CHROMIUM")
                or "/usr/bin/chromium",
                args=["--no-sandbox"],
            )
            page = browser.new_page(viewport={"width": 1000, "height": 800})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(
                os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173").rstrip(
                    "/"
                )
                + "/.source-recovery-review.html"
            )
            dialog = page.get_by_role("dialog")
            expect(dialog).to_be_visible()
            rows = dialog.locator("li")
            expect(rows).to_have_count(3)
            expect(rows.nth(0)).to_contain_text("/Projects/Feature/draft.fdx")
            expect(rows.nth(1)).to_contain_text("/Projects/Short/draft.fdx")
            expect(rows.nth(0).locator("time")).to_have_count(1)
            expect(rows.nth(2).get_by_role("button")).to_have_text(
                "legacy.fountain (5 bytes)"
            )
            rows.nth(0).get_by_role("button").click()
            page.wait_for_function("calls.some(c=>c.command==='save_binary_to_path')")
            save = page.evaluate("calls.find(c=>c.command==='plugin:dialog|save').args")
            assert save["options"]["defaultPath"] == "draft.fdx", save
            assert page.evaluate(
                "calls.find(c=>c.command==='save_binary_to_path').args.contents"
            ) == [0, 255, 128, 10, 90]
            assert page.evaluate(
                "calls.find(c=>c.command==='read_source_backup').args.name"
            ).startswith("source-a/")
            expect(rows).to_have_count(3)
            page.evaluate("window.calls=[];window.cancelSave=true")
            rows.nth(2).get_by_role("button").click()
            page.wait_for_function("calls.some(c=>c.command==='plugin:dialog|save')")
            assert (
                page.evaluate(
                    "calls.find(c=>c.command==='plugin:dialog|save').args.options.defaultPath"
                )
                == "legacy.fountain"
            )
            assert not page.evaluate("calls.some(c=>c.command==='save_binary_to_path')")
            page.evaluate("window.cancelSave=false;window.failRead=true")
            rows.nth(1).get_by_role("button").click()
            expect(dialog.get_by_role("alert")).to_contain_text(
                "Synthetic read failure"
            )
            page.evaluate("window.failRead=false")
            rows.nth(1).get_by_role("button").click()
            expect(dialog.get_by_role("alert")).to_have_count(0)
            expect(rows.nth(1).get_by_role("button")).to_be_enabled()
            shots = os.environ.get("OPENDRAFT_SCREENSHOTS")
            if shots:
                Path(shots).mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(Path(shots) / "recovery-desktop.png"))
            page.set_viewport_size({"width": 390, "height": 800})
            page.evaluate("setLanguage('ar')")
            page.wait_for_function("document.documentElement.dir==='rtl'")
            assert page.evaluate("document.documentElement.scrollWidth") == 390
            assert rows.nth(0).get_by_role("button").get_attribute("aria-describedby")
            if shots:
                page.screenshot(path=str(Path(shots) / "recovery-rtl.png"))
            page.keyboard.press("Escape")
            expect(dialog).to_have_count(0)
            assert not errors, errors
            browser.close()
            print(
                "Recovery: source metadata, original filenames, exact bytes, legacy recovery, cancellation, retry, 390px RTL and Escape passed."
            )
    finally:
        HARNESS.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

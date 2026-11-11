"""Exercise every catalog language through the real menu against Vite.

Install Python Playwright first. OPENDRAFT_TEST_URL selects Vite's URL;
OPENDRAFT_SPELLCHECK_SCREENSHOT optionally captures the open menu. Downloads
use tiny Hunspell fixtures so this checks menu/engine integration reproducibly,
without fetching every upstream dictionary or requiring a network connection.
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
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(
        "localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false,viewLayout:'page'}));"
    )
    page.goto(os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173/"))
    page.locator(".editor-main").wait_for()
    blank = page.get_by_role("button", name="Blank Document", exact=False)
    if blank.count():
        blank.click()
    page.locator(".ProseMirror").wait_for()
    catalog = page.evaluate("""async () => {
        let element=document.querySelector('.ProseMirror');
        while(element && !window.testEditor) {
            const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
            let fiber=key && element[key];
            while(fiber) {
                const editor=fiber.memoizedProps?.editor;
                if(editor?.commands && editor.state) {window.testEditor=editor;break;}
                fiber=fiber.return;
            }
            element=element.parentElement;
        }
        if(!window.testEditor) throw Error('Editor not found');
        const moduleUrl=path=>performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname===path).name;
        window.testStore=(await import(moduleUrl('/src/stores/editorStore.ts'))).useEditorStore;
        window.checker=(await import(moduleUrl('/src/editor/spellchecker.ts'))).spellChecker;
        window.languages=await import(moduleUrl('/src/editor/languageCatalog.ts'));
        await checker.whenReady();
        testEditor.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'zażółć gęślą jaźń qzxinvalid'}]}]});
        return [languages.BUILTIN,...languages.CATALOG].map(language=>({...language,urls:languages.urlsFor(language)}));
    }""")

    def open_languages():
        page.locator(".menu-item").filter(has_text=re.compile(r"^Edit$")).click()
        page.locator(".menu-dropdown-item.has-children").filter(
            has=page.locator(
                ":scope > span", has_text=re.compile(r"^Spelling & Grammar$")
            )
        ).hover()
        parent = page.locator(".menu-dropdown-item.has-children").filter(
            has=page.locator(
                ":scope > span", has_text=re.compile(r"^Spellcheck Languages$")
            )
        )
        parent.hover()
        return parent.locator(":scope > .menu-submenu")

    def row(menu, label):
        return menu.locator(":scope > .menu-dropdown-item").filter(
            has_text=re.compile(r"^✓? ?" + re.escape(label) + r"(?: — .*)?$")
        )

    menu = open_languages()
    assert menu.locator(":scope > .menu-dropdown-item").count() == len(catalog)
    assert "disabled" in row(menu, "English (US)").get_attribute("class")
    page.mouse.click(1200, 100)

    # The first failed download must preserve the existing languages and show
    # a useful error; retrying the same menu item must then succeed.
    polish = next(language for language in catalog if language["code"] == "pl")
    page.route(
        polish["urls"]["aff"],
        lambda route: route.fulfill(status=503, body="Unavailable"),
    )
    page.route(polish["urls"]["dic"], lambda route: route.fulfill(body="1\nzażółć\n"))
    row(open_languages(), polish["label"]).click()
    page.get_by_text("Couldn't download", exact=False).wait_for()
    assert page.evaluate("checker.getEnabledLanguages()") == ["en_US"]
    page.unroute(polish["urls"]["aff"])
    page.unroute(polish["urls"]["dic"])
    for language in catalog[1:]:
        page.route(
            language["urls"]["aff"], lambda route: route.fulfill(body="SET UTF-8\n")
        )
        page.route(
            language["urls"]["dic"],
            lambda route: route.fulfill(body="3\nzażółć\ngęślą\njaźń\n"),
        )
        row(open_languages(), language["label"]).click()
        page.wait_for_function(
            "code=>checker.getEnabledLanguages().includes(code)", arg=language["code"]
        )
        assert page.evaluate("testStore.getState().spellCheckEnabled")
    page.wait_for_function(
        "() => [...document.querySelectorAll('.spell-error')].map(el=>el.textContent).join(' ')==='qzxinvalid'"
    )
    assert len(page.evaluate("checker.getLoadedLanguages()")) == len(catalog)
    menu = open_languages()
    assert "Install" not in menu.inner_text()
    if os.environ.get("OPENDRAFT_SPELLCHECK_SCREENSHOT"):
        page.screenshot(path=os.environ["OPENDRAFT_SPELLCHECK_SCREENSHOT"])
    # Toggle dictionaries off through the same menu; retain Polish only.
    page.mouse.click(1200, 100)
    for language in catalog:
        if language["code"] != "pl":
            row(open_languages(), language["label"]).click()
    assert page.evaluate("checker.getEnabledLanguages()") == ["pl"]
    assert "disabled" in row(open_languages(), polish["label"]).get_attribute("class")
    page.mouse.click(1200, 100)
    # Settings changes also update menu checkmarks and existing underlines.
    page.evaluate("checker.setEnabledLanguages(['en_US'])")
    page.wait_for_function("() => document.querySelectorAll('.spell-error').length===4")
    row(open_languages(), polish["label"]).click()
    page.wait_for_function("() => document.querySelectorAll('.spell-error').length===1")
    saved = page.evaluate("""async () => {
        const url=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/utils/saveContent.ts').name;
        return (await import(url)).buildSaveContent(testEditor)._enabledLanguages;
    }""")
    assert saved == ["en_US", "pl"], saved
    page.route("**/test-custom.aff", lambda route: route.fulfill(body="SET UTF-8\n"))
    page.route(
        "**/test-custom.dic", lambda route: route.fulfill(body="1\nqzxinvalid\n")
    )
    page.evaluate(
        "checker.loadLanguage('test-custom', {affUrl:'/test-custom.aff',dicUrl:'/test-custom.dic',label:'Custom dictionary',persist:false})"
    )
    row(open_languages(), "Custom dictionary").click()
    page.wait_for_function("() => document.querySelectorAll('.spell-error').length===0")
    row(open_languages(), "Custom dictionary").click()
    page.wait_for_function("() => document.querySelectorAll('.spell-error').length===1")
    page.reload()
    page.locator(".editor-main").wait_for()
    if blank.count():
        blank.click()
    page.locator(".ProseMirror").wait_for()
    page.get_by_role("button", name="Discard", exact=True).click()
    menu = open_languages()
    # Cached dictionaries survive a reload without offering to download again.

    expect(row(menu, polish["label"])).not_to_contain_text("Install")
    assert "Install" not in row(menu, polish["label"]).inner_text()
    assert not errors, errors
    print(
        json.dumps(
            {
                "catalog_languages": len(catalog),
                "install_and_toggle": True,
                "polish_live_underlines": True,
                "download_failure_and_retry": True,
                "cached_after_reload": True,
                "custom_dictionary": True,
                "saved_language_choices": True,
                "errors": errors,
            }
        )
    )
    browser.close()

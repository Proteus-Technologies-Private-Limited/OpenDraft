"""Check rendered scene-number geometry against Vite (Python Playwright).

OPENDRAFT_TEST_URL selects the server; OPENDRAFT_SCENE_SCREENSHOT optionally
captures the page. This exercises the real editor and generated CSS labels.
"""

import json
import os
from playwright.sync_api import sync_playwright

LABELS = ["1", "12", "86", "105", "105A", "1000"]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get("OPENDRAFT_CHROMIUM")
        or ("/usr/bin/chromium" if os.path.isfile("/usr/bin/chromium") else None),
        args=["--no-sandbox"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(
        "localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false,viewLayout:'page'}));"
    )
    page.goto(
        os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173/"),
        wait_until="domcontentloaded",
    )
    page.locator(".editor-main").wait_for()
    blank = page.get_by_role("button", name="Blank Document", exact=False)
    if blank.count():
        blank.click()
    page.locator(".ProseMirror").wait_for()
    page.evaluate(
        """async labels => {
        // Same editor lookup as act-page-break-live.mjs, without a production
        // test hook or changes to the document schema.
        let element = document.querySelector('.ProseMirror');
        while(element && !window.numberEditor) {
            const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
            let fiber=key && element[key];
            while(fiber) {
                const editor=fiber.memoizedProps?.editor;
                if(editor?.commands && editor.state) { window.numberEditor=editor;break; }
                fiber=fiber.return;
            }
            element=element.parentElement;
        }
        if(!window.numberEditor) throw new Error('Could not find the running editor');
        const url=performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/stores/editorStore.ts').name;
        window.numberStore=(await import(url)).useEditorStore;
        numberStore.getState().setSceneNumbersLocked(true);
        numberStore.getState().setSceneNumbersVisible(true);
        numberEditor.commands.setContent({type:'doc',content:labels.flatMap((label,index)=>[
            {type:'sceneHeading',attrs:{sceneNumber:label},content:[{type:'text',text:`INT. STUDIO ${index+1} - DAY`}]},
            {type:'action',content:[{type:'text',text:'The scene number stays beside its heading.'}]},
        ])});
        await document.fonts.ready;
    }""",
        LABELS,
    )
    page.wait_for_function(
        "labels=>JSON.stringify([...document.querySelectorAll('.ProseMirror .scene-heading')].map(el=>el.dataset.sceneNumber))===JSON.stringify(labels)",
        arg=LABELS,
    )
    measure = """() => [...document.querySelectorAll('.ProseMirror .scene-heading')].flatMap(el=>
        ['::before','::after'].map(side=>{
            const style=getComputedStyle(el,side);
            return {label:el.dataset.sceneNumber,side,content:style.content,
                height:parseFloat(style.height),line:parseFloat(style.lineHeight),
                width:parseFloat(style.width)};
        }))"""
    rows = page.evaluate(measure)
    if os.environ.get("OPENDRAFT_SCENE_SCREENSHOT"):
        page.screenshot(path=os.environ["OPENDRAFT_SCENE_SCREENSHOT"])
    for zoom in [100, 75, 150]:
        page.evaluate("zoom=>numberStore.getState().setZoomLevel(zoom)", zoom)
        for row in page.evaluate(measure):
            assert row["height"] <= row["line"] + 1, (zoom, row)
            assert json.loads(row["content"]) == row["label"], row
    page.evaluate("numberStore.getState().setSceneNumbersVisible(false)")
    page.locator(".page.show-scene-numbers").wait_for(state="detached")
    # Hide margin labels so they do not contribute to scrollWidth when checking
    # that the actual heading and body text still wrap inside the text column.
    page.evaluate("""() => {
        numberEditor.commands.setContent({type:'doc',content:[
            {type:'sceneHeading',attrs:{sceneNumber:'105A'},content:[{type:'text',text:'INT. '+ 'A VERY LONG STUDIO LOCATION '.repeat(8)+'- DAY'}]},
            {type:'action',content:[{type:'text',text:'https://example.test/'+ 'longpath'.repeat(40)}]},
        ]});
    }""")
    for selector in [".scene-heading", ".action"]:
        box = page.locator(".ProseMirror " + selector).first.evaluate(
            "el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),scale:numberStore.getState().zoomLevel/100, width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth})"
        )
        assert box["height"] > box["line"] * box["scale"] + 1, (selector, box)
        assert box["scroll"] <= box["client"] + 1, (selector, box)
    assert not errors, errors
    print(
        json.dumps(
            {
                "labels": LABELS,
                "both_margins_one_line": True,
                "zooms": [100, 75, 150],
                "heading_and_body_wrap": True,
                "toggle_off": True,
                "errors": errors,
            }
        )
    )
    browser.close()

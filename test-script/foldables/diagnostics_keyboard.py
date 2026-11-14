"""Read-only display diagnostics and keyboard menus across real CDP postures.

Synthetic script text only. Browser geometry is not a native keyboard/device.
"""

import json
import os
from pathlib import Path
import unittest

from playwright.sync_api import expect, sync_playwright

URL = os.environ.get("OPENDRAFT_TEST_URL", "http://127.0.0.1:5173/")


class FoldDiagnosticsKeyboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("OPENDRAFT_CHROMIUM")
            or ("/usr/bin/chromium" if os.path.isfile("/usr/bin/chromium") else None),
            args=["--no-sandbox", "--enable-experimental-web-platform-features"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(no_viewport=True)
        self.page.set_default_timeout(10000)
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.add_init_script("""
            localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen:false}));
            localStorage.setItem('opendraft:hiddenModeIntroShown','1');
            Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
                writeText:async text=>{window.copiedDiagnostics=text;}
            }});
        """)
        self.cdp = self.page.context.new_cdp_session(self.page)
        self.posture()
        self.page.goto(URL, wait_until="domcontentloaded")
        self.page.locator(".editor-main").wait_for()
        blank = self.page.get_by_role("button", name="Blank Document", exact=False)
        if blank.count():
            blank.click()
        self.page.locator(".ProseMirror").wait_for()
        self.page.evaluate("""async () => {
            const module=path=>import(performance.getEntriesByType('resource')
                .find(e=>new URL(e.name).pathname==='/src/'+path+'.ts').name);
            window.diagStore=(await module('stores/editorStore')).useEditorStore;
            window.diagI18n=await module('i18n/index');
            const registry=(await module('plugins/registry')).pluginRegistry;
            let element=document.querySelector('.ProseMirror');
            while(element && !window.diagEditor) {
                const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
                let fiber=key && element[key];
                while(fiber) {
                    if(fiber.memoizedProps?.editor?.commands) {window.diagEditor=fiber.memoizedProps.editor;break;}
                    fiber=fiber.return;
                }
                element=element.parentElement;
            }
            diagEditor.commands.setContent({type:'doc',content:[{type:'action',content:[
                {type:'text',text:'DO_NOT_COPY_SCRIPT synthetic text'}
            ]}]});
            diagEditor.commands.setTextSelection({from:1,to:10});
            diagEditor.commands.focus();
            diagStore.getState().setDocumentTitle('DO_NOT_COPY_TITLE');
            window.diagActivations=0;
            registry.register({id:'fold-menu-fixture',name:'Fold menu fixture',version:'1',menuItems:[{
                id:'root',section:'Tools',label:'Fold menu fixture',children:[{
                    id:'branch',label:'Fixture branch',children:[{
                        id:'leaf',label:'Fixture format',action:({editor})=>{
                            window.diagActivations++;editor.chain().focus().toggleBold().run();
                        }
                    }]
                }]
            }]});
        }""")

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def posture(self, width=951, height=669, axis="vertical", fold="continuous"):
        metrics = dict(
            width=width,
            height=height,
            screenWidth=width,
            screenHeight=height,
            deviceScaleFactor=1,
            mobile=True,
        )
        if axis:
            metrics["displayFeature"] = dict(
                orientation=axis,
                offset=(width if axis == "vertical" else height) // 2 - 10,
                maskLength=20,
            )
        self.cdp.send("Emulation.setDeviceMetricsOverride", metrics)
        self.cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
        self.cdp.send("Emulation.setDevicePostureOverride", {"posture": {"type": fold}})
        if self.page.url != "about:blank":
            expected = (
                "book"
                if axis == "vertical" and fold == "folded"
                else "laptop" if axis == "horizontal" and fold == "folded" else "flat"
            )
            self.page.wait_for_function(
                "state=>innerWidth===state.width && (document.documentElement.classList.contains('fold-book')?'book':document.documentElement.classList.contains('fold-laptop')?'laptop':'flat')===state.fold",
                arg={"width": width, "fold": expected},
            )
            self.page.wait_for_timeout(250)

    def open_diagnostics(self):
        self.page.evaluate("diagEditor.view.focus()")
        self.page.keyboard.press("F10")
        self.page.locator("[data-menu-top=Help]").focus()
        self.page.keyboard.press("ArrowDown")
        label = self.page.evaluate("diagI18n.t('menu:help.diagnostics')")
        self.page.get_by_role("menuitem", name=label, exact=True).focus()
        self.page.keyboard.press("Enter")
        details = self.page.locator(".diagnostics-display")
        expect(details).to_be_visible()
        self.assertEqual(self.page.locator(".menu-bar--floating:visible").count(), 0)
        fab = self.page.locator(".menu-fab")
        if fab.count():
            expect(fab).to_have_attribute("aria-expanded", "false")
        details.locator("summary").focus()
        self.page.keyboard.press("Enter")
        expect(details).to_have_attribute("open", "")
        return details.locator("pre")

    def close_diagnostics(self):
        self.page.locator(".diagnostics-display").locator(
            'xpath=ancestor::div[contains(@class,"dialog-box")]'
        ).locator(".dialog-actions button").last.click()

    def screenshot(self, name):
        folder = os.environ.get("OPENDRAFT_SCREENSHOTS")
        if folder:
            Path(folder).mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(Path(folder) / name))

    def test_snapshot_copy_and_geometry_after_each_posture(self):
        for width, height, axis, posture, expected in [
            (951, 669, "vertical", "continuous", "flat"),
            (951, 669, "vertical", "folded", "book"),
            (951, 800, "horizontal", "folded", "laptop"),
            (390, 800, None, "continuous", "flat"),
        ]:
            self.posture(width, height, axis, posture)
            before = self.page.evaluate(
                "({classes:document.documentElement.className,prefs:localStorage.getItem('opendraft:viewState')})"
            )
            pre = self.open_diagnostics()
            report = json.loads(pre.inner_text())
            self.assertTrue(report["applied"]["confirmed"])
            self.assertEqual(report["applied"]["posture"], expected)
            self.assertEqual(report["viewport"]["layout"]["width"], width)
            self.assertEqual(report["devicePosture"]["value"], posture)
            if axis:
                self.assertEqual(report["segmentsSource"], "window.viewport.segments")
                self.assertEqual(report["windowSegments"]["count"], 2)
                self.assertEqual(
                    report["applied"]["crease"][
                        "width" if axis == "vertical" else "height"
                    ],
                    20,
                )
            self.page.evaluate("window.copiedDiagnostics=null")
            self.page.get_by_role("button", name="Copy Report", exact=True).click()
            self.page.wait_for_function("typeof copiedDiagnostics==='string'")
            copied = self.page.evaluate("copiedDiagnostics")
            self.assertIn(pre.inner_text(), copied)
            self.assertIn("Display and posture (browser snapshot):", copied)
            self.assertNotIn("DO_NOT_COPY_SCRIPT", copied)
            self.assertNotIn("DO_NOT_COPY_TITLE", copied)
            self.assertEqual(
                self.page.evaluate(
                    "({classes:document.documentElement.className,prefs:localStorage.getItem('opendraft:viewState')})"
                ),
                before,
            )
            if expected == "book":
                self.page.locator(
                    ".diagnostics-display summary"
                ).scroll_into_view_if_needed()
                self.screenshot("fold-diagnostics-book.png")
            self.close_diagnostics()

    def test_report_is_a_snapshot_and_reopening_refreshes_it(self):
        self.posture(fold="folded")
        pre = self.open_diagnostics()
        old = pre.inner_text()
        self.posture(axis="horizontal", height=800, fold="folded")
        self.assertEqual(pre.inner_text(), old)
        self.close_diagnostics()
        self.assertEqual(
            json.loads(self.open_diagnostics().inner_text())["applied"]["posture"],
            "laptop",
        )

    def test_cold_cover_launch_stays_unconfirmed(self):
        cold = self.browser.new_page(no_viewport=True)
        try:
            cdp = cold.context.new_cdp_session(cold)
            cdp.send(
                "Emulation.setDeviceMetricsOverride",
                dict(
                    width=390,
                    height=800,
                    screenWidth=390,
                    screenHeight=800,
                    deviceScaleFactor=1,
                    mobile=True,
                ),
            )
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
            cold.goto(URL, wait_until="domcontentloaded")
            cold.locator(".editor-main").wait_for()
            report = cold.evaluate(
                "async()=> (await import('/src/services/diagnostics.ts')).collectDiagnostics()"
            )
            self.assertFalse(report["display"]["applied"]["confirmed"])
            self.assertFalse(
                cold.locator("html").evaluate("el=>el.classList.contains('foldable')")
            )
        finally:
            cold.close()

    def test_phone_rtl_report_does_not_overflow(self):
        self.posture(390, 800, None)
        self.page.evaluate("diagI18n.setLanguage('ar')")
        self.page.wait_for_function("document.documentElement.dir==='rtl'")
        pre = self.open_diagnostics()
        self.assertEqual(json.loads(pre.inner_text())["applied"]["direction"], "rtl")
        self.assertEqual(pre.get_attribute("dir"), "ltr")
        box = self.page.locator(".diagnostics-display").locator(
            'xpath=ancestor::div[contains(@class,"dialog-box")]'
        )
        self.assertTrue(box.evaluate("el=>el.scrollWidth<=el.clientWidth+1"))
        self.page.locator(".diagnostics-display summary").scroll_into_view_if_needed()
        self.screenshot("fold-diagnostics-rtl.png")

    def test_nested_menu_focus_and_format_selection_across_postures_and_rtl(self):
        for index, profile in enumerate(
            [
                (951, 669, "vertical", "continuous"),
                (951, 669, "vertical", "folded"),
                (951, 800, "horizontal", "folded"),
                (390, 800, None, "continuous"),
            ]
        ):
            self.posture(*profile)
            if index == 3:
                self.page.evaluate("diagI18n.setLanguage('ar')")
                self.page.wait_for_function("document.documentElement.dir==='rtl'")
            forward = "ArrowLeft" if index == 3 else "ArrowRight"
            self.page.evaluate("diagEditor.view.focus()")
            self.page.keyboard.press("F10")
            self.page.locator("[data-menu-top=Tools]").focus()
            self.page.keyboard.press("ArrowDown")
            self.page.get_by_role(
                "menuitem", name="Fold menu fixture", exact=True
            ).focus()
            self.page.keyboard.press(forward)
            self.page.keyboard.press(forward)
            expect(
                self.page.get_by_role("menuitem", name="Fixture format", exact=True)
            ).to_be_focused()
            self.page.keyboard.press("Escape")
            expect(
                self.page.get_by_role("menuitem", name="Fixture branch", exact=True)
            ).to_be_focused()
            self.page.keyboard.press(forward)
            self.page.keyboard.press("Enter")
            expect(self.page.locator(".ProseMirror")).to_be_focused()
            self.assertEqual(self.page.evaluate("diagActivations"), index + 1)
            self.assertEqual(
                self.page.evaluate(
                    "({from:diagEditor.state.selection.from,to:diagEditor.state.selection.to})"
                ),
                {"from": 1, "to": 10},
            )
            self.page.keyboard.press("ControlOrMeta+z")
            self.assertEqual(self.page.locator(".ProseMirror strong").count(), 0)
            self.page.keyboard.press("F10")
            self.page.keyboard.press("F10")
            expect(self.page.locator(".ProseMirror")).to_be_focused()


if __name__ == "__main__":
    unittest.main(verbosity=2)

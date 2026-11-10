"""Review #236: ordinary-device zoom and reversible emulation detection."""
import os
import unittest
from playwright.sync_api import sync_playwright

URL = os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/')


class ReviewRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get('OPENDRAFT_CHROMIUM') or ('/usr/bin/chromium' if os.path.isfile('/usr/bin/chromium') else None),
            args=['--no-sandbox', '--enable-experimental-web-platform-features'],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def context(self, **options):
        context = self.browser.new_context(**options)
        self.addCleanup(context.close)
        self.errors = []
        context.on('page', lambda page: page.on('pageerror', lambda error: self.errors.append(str(error))))
        return context

    def ready(self, page):
        page.locator('.editor-main').wait_for()
        blank = page.get_by_role('button', name='Blank Document', exact=False)
        if blank.count():
            blank.click()
        page.locator('.ProseMirror').wait_for()
        page.evaluate("""async () => {
            const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/editorStore.ts').name;
            window.reviewStore=(await import(url)).useEditorStore;
            const read=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/stores/tableReadStore.ts').name;
            window.reviewRead=(await import(read)).useTableReadStore;
        }""")
        page.wait_for_timeout(400)

    def test_panel_and_toolbar_changes_keep_ordinary_page_zoom(self):
        variants = [
            ('narrow desktop', dict(viewport=dict(width=600,height=900))),
            ('ordinary iPhone', dict(viewport=dict(width=390,height=844),screen=dict(width=390,height=844),is_mobile=True,has_touch=True,user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1')),
            ('iPad Slide Over', dict(viewport=dict(width=475,height=669),screen=dict(width=820,height=1180),is_mobile=True,has_touch=True,user_agent='Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1')),
        ]
        for label, options in variants:
            with self.subTest(device=label):
                context = self.context(**options)
                context.add_init_script("if(location.origin!=='null')localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen:false,viewLayout:'page',toolbarMode:'comfortable'}));")
                page = context.new_page();page.goto(URL,wait_until='domcontentloaded');self.ready(page)
                self.assertEqual(page.locator('html.foldable').count(),0)
                if label == 'iPad Slide Over':
                    self.assertEqual(page.locator('html.phone').count(),0)
                page.evaluate('reviewStore.getState().setZoomLevel(135)')
                actions = [
                    'reviewStore.getState().toggleScriptNotes()',
                    'reviewStore.getState().toggleScriptNotes()',
                    'reviewStore.getState().toggleNavigator()',
                    'reviewStore.getState().toggleNavigator()',
                    'reviewRead.getState().openTableRead()',
                    'reviewRead.getState().setOpen(false)',
                    "reviewStore.getState().setToolbarMode('hidden')",
                    "reviewStore.getState().setToolbarMode('comfortable')",
                ]
                for action in actions:
                    page.evaluate(action);page.wait_for_timeout(200)
                    self.assertEqual(page.evaluate('reviewStore.getState().zoomLevel'),135,(label,action))
                    if 'hidden' in action:
                        self.assertEqual(page.locator('.toolbar').count(),0)
                self.assertEqual(self.errors,[])
                context.close()

    def test_legacy_foldable_marker_is_discarded(self):
        context = self.context(viewport=dict(width=1200,height=800))
        self.seed_marker(context)
        page=context.new_page();page.goto(URL,wait_until='domcontentloaded');self.ready(page)
        self.assertEqual(page.locator('html.foldable').count(),0)
        self.assertIsNone(page.evaluate("localStorage.getItem('opendraft:foldable')"))
        self.assertEqual(page.evaluate('reviewStore.getState().toolbarMode'),'comfortable')
        self.assertEqual(page.evaluate('reviewStore.getState().viewLayout'),'page')
        self.assertTrue(page.locator('.toolbar').is_visible())
        self.assertEqual(self.errors,[])

    def seed_marker(self, context):
        context.add_init_script("""
            if(location.origin!=='null') {
            localStorage.setItem('opendraft:foldable','1');
            localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen:false,toolbarMode:'comfortable',viewLayout:'page',byPosture:{open:{toolbarMode:'hidden',viewLayout:'phone'}}}));
            }
        """)

    def test_legacy_choices_keep_comfortable_toolbar_in_both_postures(self):
        context=self.context(no_viewport=True)
        context.add_init_script("if(location.origin!=='null')localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false,toolbarMode:'comfortable',viewLayout:'page'}));")
        page=context.new_page();cdp=context.new_cdp_session(page)
        cdp.send('Emulation.setDeviceMetricsOverride',dict(width=951,height=669,screenWidth=951,screenHeight=669,deviceScaleFactor=1,mobile=True,displayFeature=dict(orientation='vertical',offset=465,maskLength=20)))
        cdp.send('Emulation.setTouchEmulationEnabled',dict(enabled=True))
        page.goto(URL,wait_until='domcontentloaded');self.ready(page)
        self.assertEqual(page.evaluate('reviewStore.getState().toolbarMode'),'comfortable')
        self.assertEqual(page.evaluate('reviewStore.getState().viewLayout'),'page')
        self.assertGreaterEqual(page.locator('.toolbar.toolbar-comfortable').bounding_box()['height'],36)
        cdp.send('Emulation.setDeviceMetricsOverride',dict(width=390,height=800,screenWidth=390,screenHeight=800,deviceScaleFactor=1,mobile=True))
        page.wait_for_function("document.documentElement.classList.contains('phone')")
        self.assertEqual(page.evaluate('reviewStore.getState().toolbarMode'),'comfortable')
        self.assertEqual(page.evaluate('reviewStore.getState().viewLayout'),'page')
        self.assertGreaterEqual(page.locator('.toolbar.toolbar-comfortable').bounding_box()['height'],52)
        self.assertEqual(self.errors,[])

    def test_detection_resets_after_disabling_emulation_and_reloading(self):
        context=self.context(no_viewport=True);self.seed_marker(context)
        page=context.new_page();cdp=context.new_cdp_session(page)
        cdp.send('Emulation.setDeviceMetricsOverride',dict(width=800,height=800,screenWidth=800,screenHeight=800,deviceScaleFactor=1,mobile=True,displayFeature=dict(orientation='vertical',offset=390,maskLength=20)))
        cdp.send('Emulation.setTouchEmulationEnabled',dict(enabled=True))
        page.goto(URL,wait_until='domcontentloaded');self.ready(page)
        self.assertEqual(page.locator('html.foldable').count(),1)
        self.assertEqual(page.evaluate('reviewStore.getState().toolbarMode'),'hidden')
        cdp.send('Emulation.setDeviceMetricsOverride',dict(width=1200,height=800,screenWidth=1200,screenHeight=800,deviceScaleFactor=1,mobile=False))
        cdp.send('Emulation.setTouchEmulationEnabled',dict(enabled=False))
        page.reload(wait_until='domcontentloaded');self.ready(page)
        self.assertEqual(page.locator('html.foldable').count(),0)
        self.assertEqual(page.evaluate('reviewStore.getState().toolbarMode'),'comfortable')
        self.assertEqual(page.evaluate('reviewStore.getState().viewLayout'),'page')
        self.assertIsNone(page.evaluate("localStorage.getItem('opendraft:foldable')"))
        self.assertEqual(self.errors,[])


if __name__ == '__main__':
    unittest.main(verbosity=2)

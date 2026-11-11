"""Review #236: scroll/zoom preservation and reversible emulation detection."""
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
            let element=document.querySelector('.ProseMirror');
            while (element && !window.reviewEditor) {
                const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
                let fiber=key && element[key];
                while (fiber) {
                    const editor=fiber.memoizedProps?.editor;
                    if (editor?.commands && editor.state) {window.reviewEditor=editor;break;}
                    fiber=fiber.return;
                }
                element=element.parentElement;
            }
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

    def test_resize_after_zoom_and_scrolling_preserves_position(self):
        variants = [
            ('desktop', dict(width=1440, height=1000), dict(width=1360, height=1000), False, 'page', 0),
            ('tablet', dict(width=1024, height=1100), dict(width=944, height=1100), True, 'page', 0),
            ('phone keyboard height', dict(width=390, height=844), dict(width=390, height=600), True, 'phone', 0),
            # A real size-class transition still notifies readers. It must not
            # restore a zoom anchor after the writer has scrolled elsewhere.
            ('size class change', dict(width=800, height=650), dict(width=800, height=590), True, 'phone', 1),
        ]
        for label, viewport, resized, touch, layout, changes in variants:
            with self.subTest(device=label):
                context = self.context(viewport=viewport, has_touch=touch)
                context.add_init_script("if(location.origin!=='null')localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen:false,toolbarMode:'compact',viewLayout:'" + layout + "'}));")
                page=context.new_page();page.goto(URL,wait_until='domcontentloaded');self.ready(page)
                page.evaluate("""() => {
                    reviewEditor.commands.setContent({type:'doc',content:Array.from({length:240},(_,n)=>({
                        type:'action',content:[{type:'text',text:`Marker ${n}: `+'A long synthetic script for the resize regression. '.repeat(8)}],
                    }))});
                    reviewStore.getState().setZoomLevel(110);
                }""")
                page.evaluate('document.fonts.ready')
                # Let the zoom hold expire before moving away from its anchor.
                page.wait_for_timeout(900)
                before=page.evaluate("""() => {
                    const main=document.querySelector('.editor-main');
                    main.scrollTop=9000;
                    window.resizeFoldChanges=0;
                    window.addEventListener('opendraft:foldchange',()=>window.resizeFoldChanges++);
                    return {scroll:main.scrollTop,selection:reviewEditor.state.selection.toJSON()};
                }""")
                self.assertGreater(before['scroll'],8000,label)
                page.set_viewport_size(resized)
                page.wait_for_timeout(700)
                after=page.evaluate("""({scroll:document.querySelector('.editor-main').scrollTop,
                    selection:reviewEditor.state.selection.toJSON(),changes:resizeFoldChanges})""")
                print(f"{label}: scroll {before['scroll']} -> {after['scroll']}, fold events {after['changes']}", flush=True)
                self.assertAlmostEqual(after['scroll'],before['scroll'],delta=8,msg=label)
                self.assertEqual(after['selection'],before['selection'],label)
                self.assertEqual(after['changes'],changes,label)
                self.assertEqual(self.errors,[])
                context.close()

    def test_cover_panels_keep_custom_zoom_but_posture_still_fits(self):
        context=self.context(no_viewport=True)
        context.add_init_script("if(location.origin!=='null'){localStorage.setItem('opendraft:hiddenModeIntroShown','1');localStorage.setItem('opendraft:viewState',JSON.stringify({navigatorOpen:false,toolbarMode:'comfortable',viewLayout:'page'}));}")
        page=context.new_page();cdp=context.new_cdp_session(page)
        cdp.send('Emulation.setDeviceMetricsOverride',dict(width=951,height=669,screenWidth=951,screenHeight=669,deviceScaleFactor=1,mobile=True,displayFeature=dict(orientation='vertical',offset=465,maskLength=20)))
        cdp.send('Emulation.setTouchEmulationEnabled',dict(enabled=True))
        page.goto(URL,wait_until='domcontentloaded');self.ready(page)
        cdp.send('Emulation.setDeviceMetricsOverride',dict(width=390,height=800,screenWidth=390,screenHeight=800,deviceScaleFactor=1,mobile=True))
        page.wait_for_function("document.documentElement.classList.contains('phone')")
        page.wait_for_timeout(400)
        self.assertLessEqual(page.evaluate('reviewStore.getState().zoomLevel'),100)
        page.evaluate('reviewStore.getState().setZoomLevel(135)')
        for action in [
            'reviewStore.getState().toggleScriptNotes()',
            'reviewStore.getState().toggleScriptNotes()',
            'reviewStore.getState().toggleNavigator()',
            'reviewStore.getState().toggleNavigator()',
            'reviewRead.getState().openTableRead()',
            'reviewRead.getState().setOpen(false)',
            "reviewStore.getState().setToolbarMode('hidden')",
            "reviewStore.getState().setToolbarMode('comfortable')",
        ]:
            page.evaluate(action);page.wait_for_timeout(200)
            self.assertEqual(page.evaluate('reviewStore.getState().zoomLevel'),135,action)
        page.evaluate('reviewStore.getState().toggleNavigator()')
        page.locator('.panel-resize-handle').first.dispatch_event('pointerdown', {'clientX':240,'pointerId':1})
        page.evaluate("""() => {
            document.dispatchEvent(new PointerEvent('pointermove',{clientX:300,bubbles:true}));
            document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
        }""")
        page.wait_for_timeout(200)
        self.assertEqual(page.evaluate('reviewStore.getState().navPanelWidth'),300)
        self.assertEqual(page.evaluate('reviewStore.getState().zoomLevel'),135)
        page.evaluate('reviewStore.getState().toggleNavigator()')
        # A genuine viewport/posture change on this confirmed foldable still
        # fits the page rather than leaving a cover-width page at 135%.
        cdp.send('Emulation.setDeviceMetricsOverride',dict(width=951,height=669,screenWidth=951,screenHeight=669,deviceScaleFactor=1,mobile=True,displayFeature=dict(orientation='vertical',offset=465,maskLength=20)))
        page.wait_for_function("!document.documentElement.classList.contains('phone')")
        page.wait_for_timeout(400)
        self.assertLessEqual(page.evaluate('reviewStore.getState().zoomLevel'),100)
        self.assertEqual(self.errors,[])

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

"""Foldable regressions against Vite, using real Chrome CDP signals.

Requires Python Playwright and system Chromium. No native keyboard or device
behavior is simulated; keyboard checks use browser key events.
"""
import os
import unittest
from playwright.sync_api import sync_playwright

URL = os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/')


class FoldableRegressions(unittest.TestCase):
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

    def setUp(self):
        self.page = self.browser.new_page(no_viewport=True)
        self.page.set_default_timeout(10000)
        self.addCleanup(self.page.close)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script("localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen:false}));")
        self.cdp = self.page.context.new_cdp_session(self.page)
        self.posture()
        self.page.goto(URL, wait_until='domcontentloaded')
        self.page.locator('.editor-main').wait_for()
        blank = self.page.get_by_role('button', name='Blank Document', exact=False)
        if blank.count():
            blank.click()
        self.page.locator('.ProseMirror').wait_for()
        self.page.evaluate("""async () => {
            const module = path => import(performance.getEntriesByType('resource')
                .find(e => new URL(e.name).pathname === '/src/' + path + '.ts').name);
            window.testStore = (await module('stores/editorStore')).useEditorStore;
            window.testTable = (await module('stores/tableReadStore')).useTableReadStore;
            window.testRegistry = (await module('plugins/registry')).pluginRegistry;
            const {default:React} = await import(performance.getEntriesByType('resource')
                .find(e => new URL(e.name).pathname.endsWith('/react.js')).name);
            function Probe({editor}) {
                window.testEditor = editor;
                const [text, setText] = React.useState('');
                return React.createElement('textarea', {
                    'aria-label': 'Regression draft', value: text,
                    onChange: e => setText(e.target.value),
                });
            }
            window.testRegistry.register({id:'fold-regression',name:'Regression',version:'1',panels:[
                {id:'probe-a',label:'Probe A',slot:'right-sidebar',component:Probe},
                {id:'probe-b',label:'Probe B',slot:'right-sidebar',component:Probe},
            ]});
        }""")
        self.page.get_by_role('tab', name='Probe A', exact=True).wait_for()
        self.page.get_by_role('tab', name='Probe A', exact=True).click()
        self.page.get_by_role('textbox', name='Regression draft').wait_for()
        self.page.evaluate('document.fonts.ready')
        self.page.wait_for_timeout(300)

    def tearDown(self):
        try:
            self.assertEqual(self.errors, [])
        finally:
            self.page.close()

    def posture(self, width=951, height=669, axis='vertical', fold='continuous'):
        metrics = dict(width=width, height=height, deviceScaleFactor=1, mobile=True,
                       screenWidth=width, screenHeight=height)
        if axis:
            metrics['displayFeature'] = dict(orientation=axis,
                offset=(width if axis == 'vertical' else height)//2-10, maskLength=20)
        self.cdp.send('Emulation.setDeviceMetricsOverride', metrics)
        self.cdp.send('Emulation.setTouchEmulationEnabled', {'enabled':True})
        self.cdp.send('Emulation.setDevicePostureOverride', {'posture':{'type':fold}})
        self.page.wait_for_timeout(800)

    def open_plugin(self, panel='probe-a'):
        self.page.evaluate("id => document.dispatchEvent(new CustomEvent('plugin-panel:open', {detail:{panelId:id}}))", panel)

    def locations(self):
        self.page.evaluate('testStore.getState().toggleLocationDatabase()')
        self.page.get_by_role('tab', name='Locations', exact=True).click()

    def test_focused_panel_input_survives_folding(self):
        self.check_panel_focus()

    def test_focused_panel_input_on_append_child_fallback(self):
        self.page.evaluate("Element.prototype.moveBefore = undefined")
        self.check_panel_focus()

    def check_panel_focus(self):
        field = self.page.get_by_role('textbox', name='Regression draft')
        field.fill('Keep the selected words in this draft.')
        field.evaluate("el => { el.focus(); el.setSelectionRange(9,23); window.testInput = el; }")
        self.posture(390, 800, None)
        self.assertTrue(field.evaluate('el => el === window.testInput && el === document.activeElement'))
        self.assertEqual(field.evaluate('el => [el.selectionStart, el.selectionEnd]'), [9,23])
        self.posture()
        self.assertTrue(field.evaluate('el => el === window.testInput && el === document.activeElement'))
        self.assertEqual(field.input_value(), 'Keep the selected words in this draft.')
        self.page.keyboard.type('replacement')
        self.assertEqual(field.input_value(), 'Keep the replacement in this draft.')

    def test_plugin_open_requests_bring_the_panel_forward(self):
        self.locations()
        self.open_plugin()
        self.page.get_by_role('textbox', name='Regression draft').wait_for(state='visible', timeout=3000)
        self.page.get_by_role('tab', name='Locations', exact=True).click()
        self.open_plugin('probe-b')
        self.page.get_by_role('textbox', name='Regression draft').wait_for(state='visible', timeout=3000)
        self.page.evaluate("testRegistry.unregister('fold-regression')")
        self.page.locator('.plugin-panel-tabs__content').wait_for(state='detached')
        self.assertTrue(self.page.get_by_role('tab', name='Locations', exact=True).is_visible())

    def test_dock_keyboard_and_accessible_panels(self):
        self.locations()
        tabs = self.page.locator('.fold-panel-tabs [role=tab]')
        tabs.first.focus()
        tabs.first.press('End')
        self.assertTrue(tabs.last.evaluate("el => el === document.activeElement && el.getAttribute('aria-selected') === 'true'"))
        tabs.last.press('ArrowRight')
        self.assertTrue(tabs.first.evaluate('el => el === document.activeElement'))
        tabs.first.press('ArrowLeft')
        self.assertTrue(tabs.last.evaluate('el => el === document.activeElement'))
        tabs.last.press('Home')
        self.assertTrue(tabs.first.evaluate('el => el === document.activeElement'))
        for tab in tabs.all():
            tab.click()
            panel_id = tab.get_attribute('aria-controls')
            panel = self.page.locator('[id="' + panel_id + '"]')
            self.assertEqual(panel.get_attribute('role'), 'tabpanel')
            self.assertEqual(panel.get_attribute('aria-labelledby'), tab.get_attribute('id'))
            self.assertEqual(panel.get_attribute('tabindex'), '0')
            tab.press('Tab')
            self.assertTrue(panel.evaluate('el => el === document.activeElement || el.contains(document.activeElement)'))
        # Hidden panel controls must not be exposed to the accessibility tree.
        self.page.get_by_role('tab', name='Locations', exact=True).click()
        self.assertEqual(self.page.get_by_role('textbox', name='Regression draft').count(), 0)

    def test_plugin_keyboard_and_close_focus(self):
        rail = self.page.locator('.plugin-panel-tabs__strip')
        first = rail.get_by_role('tab', name='Probe A', exact=True)
        first.focus()
        first.press('ArrowDown')
        second = rail.get_by_role('tab', name='Probe B', exact=True)
        self.assertTrue(second.evaluate("el=>el===document.activeElement && el.getAttribute('aria-selected')==='true'"))
        self.assertEqual(rail.get_attribute('aria-orientation'), 'vertical')
        second.press('Home')
        self.assertTrue(first.evaluate('el=>el===document.activeElement'))
        second.press('End')
        self.assertTrue(second.evaluate('el=>el===document.activeElement'))
        content = self.page.locator('[id="' + second.get_attribute('aria-controls') + '"]')
        self.assertEqual(content.get_attribute('aria-labelledby'), second.get_attribute('id'))
        content.get_by_role('button', name='Close Probe B', exact=True).click()
        self.assertTrue(second.evaluate('el=>el===document.activeElement'))

    def test_rtl_tabs_and_closing_selected_panel(self):
        self.locations()
        self.page.evaluate("document.documentElement.dir='rtl'")
        tabs = self.page.locator('.fold-panel-tabs [role=tab]')
        tabs.first.focus()
        tabs.first.press('ArrowLeft')
        self.assertTrue(tabs.last.evaluate('el=>el===document.activeElement'))
        tabs.last.press('ArrowRight')
        self.assertTrue(tabs.first.evaluate('el=>el===document.activeElement'))
        self.page.get_by_role('tab', name='Locations', exact=True).click()
        self.page.locator('.fold-panel-dock .location-db-close').click()
        self.page.wait_for_function("document.activeElement?.getAttribute('role')==='tab' && document.activeElement?.textContent==='Probe A'")
        self.page.locator('.ProseMirror').click()
        self.page.evaluate("testRegistry.unregister('fold-regression')")
        self.page.locator('.plugin-panel-tabs__strip').wait_for(state='detached')
        self.assertTrue(self.page.locator('.ProseMirror').evaluate('el=>el===document.activeElement'))

    def test_docking_reacts_to_wide_resizes_without_live_segments(self):
        self.page.evaluate("document.dispatchEvent(new CustomEvent('plugin-panel:close'))")
        self.page.evaluate('testStore.getState().toggleNavigator()')
        for width, expected in [(951,'fold-nav-docked'),(800,'fold-nav-overlay'),(951,'fold-nav-docked')]:
            self.posture(width=width, axis=None)
            classes = self.page.locator('.editor-layout').get_attribute('class').split()
            self.assertIn(expected, classes)
            self.assertNotIn('fold-nav-overlay' if expected=='fold-nav-docked' else 'fold-nav-docked', classes)

    def test_long_script_keeps_selection_and_reading_anchor(self):
        # The probe supplies the editor reference; close it for the reading
        # check. Focused/open panel preservation is exercised separately.
        self.page.evaluate("document.dispatchEvent(new CustomEvent('plugin-panel:close'))")
        self.page.locator('.plugin-panel-tabs__content').wait_for(state='detached')
        self.page.evaluate("""() => {
            const text = n => `Marker ${n}: A writer walks past the station and studies the changing light. `.repeat(3);
            testEditor.commands.setContent({type:'doc', content:Array.from({length:240},(_,n)=>({
                type:n%20===0?'sceneHeading':'action',
                content:[{type:'text',text:n%20===0?`EXT. STREET ${n} - DAY`:text(n)}],
            }))});
            let target;
            testEditor.state.doc.descendants((node,pos)=>{if(node.isBlock && node.textContent.startsWith('Marker 143:'))target=pos;});
            testEditor.commands.setTextSelection({from:target+12,to:target+30});
            testEditor.commands.focus(undefined,{scrollIntoView:false});
        }""")
        self.page.wait_for_timeout(700)
        self.page.evaluate("""() => {
            const main=document.querySelector('.editor-main');
            const el=[...document.querySelector('.ProseMirror').children].find(el=>el.textContent.startsWith('Marker 143:'));
            main.scrollTop+=el.getBoundingClientRect().top-main.getBoundingClientRect().top-140;
            window.testSelection={...testEditor.state.selection.toJSON()};
        }""")
        for kwargs in [dict(fold='folded'), dict(axis='horizontal',fold='folded'),
                       dict(width=390,height=800,axis=None), dict()]:
            # Follow the actual reading point for each transition. The selected
            # paragraph can be elsewhere after text reflows; selection itself
            # is checked independently below.
            self.page.evaluate("""() => {
                const main=document.querySelector('.editor-main').getBoundingClientRect();
                const y=main.top+main.height/2;
                const blocks=[...document.querySelector('.ProseMirror').children];
                const el=blocks.find(el=>el.getBoundingClientRect().bottom>=y) ?? blocks.at(-1);
                const box=el.getBoundingClientRect();
                window.testAnchor=el;
                window.testAnchorFraction=Math.max(0,Math.min(1,(y-box.top)/Math.max(1,box.height)));
            }""")
            self.posture(**kwargs)
            actual = self.page.evaluate("""() => {
                const main=document.querySelector('.editor-main').getBoundingClientRect();
                const rect=testAnchor.getBoundingClientRect();
                return {offset:rect.top+testAnchorFraction*rect.height-main.top, height:main.height, connected:testAnchor.isConnected,
                    selection:testEditor.state.selection.toJSON(),scroll:document.querySelector('.editor-main').scrollTop};
            }""")
            self.assertEqual(actual['selection'], self.page.evaluate('testSelection'), actual)
            self.assertTrue(actual['connected'],(kwargs,actual))
            self.assertGreater(actual['offset'], -20, (kwargs,actual))
            self.assertLess(actual['offset'], actual['height']-20, (kwargs,actual))
        before = self.page.evaluate('testEditor.state.doc.textContent')
        start = self.page.evaluate('testEditor.state.selection.from')
        # One browser text input is one undoable edit. Per-character typing
        # can legitimately form several history groups on a slow CI runner.
        self.page.keyboard.insert_text('continued')
        self.assertEqual(self.page.evaluate('(start)=>testEditor.state.doc.textBetween(start,start+9)', start), 'continued')
        self.page.keyboard.press('ControlOrMeta+z')
        self.assertEqual(self.page.evaluate('testEditor.state.doc.textContent'), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)

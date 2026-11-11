"""Keyboard menu regressions against Vite, using Python Playwright + Chromium.

Run: OPENDRAFT_TEST_URL=http://127.0.0.1:5173 python test-script/menu-keyboard/regressions.py
OPENDRAFT_CHROMIUM overrides the system Chromium executable. No native devices
or screen readers are simulated; the fixture uses only synthetic script text.
"""
import os
import unittest
from playwright.sync_api import sync_playwright, expect


class MenuKeyboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get('OPENDRAFT_CHROMIUM') or '/usr/bin/chromium',
            args=['--no-sandbox'],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 1000})
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.add_init_script("""
            localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen:false,toolbarMode:'compact'}));
            localStorage.setItem('opendraft:hiddenModeIntroShown','1');
        """)
        self.page.goto(os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/'))
        self.page.locator('.editor-main').wait_for()
        blank = self.page.get_by_role('button', name='Blank Document', exact=False)
        if blank.count():
            blank.click()
        self.page.locator('.ProseMirror').wait_for()
        self.page.evaluate("""async () => {
            let element=document.querySelector('.ProseMirror');
            while (element && !window.testEditor) {
                const key=Object.keys(element).find(key=>key.startsWith('__reactFiber$'));
                let fiber=key && element[key];
                while (fiber) {
                    const editor=fiber.memoizedProps?.editor;
                    if (editor?.commands && editor.state) {window.testEditor=editor;break;}
                    fiber=fiber.return;
                }
                element=element.parentElement;
            }
            const url=path=>performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname===path).name;
            window.testStore=(await import(url('/src/stores/editorStore.ts'))).useEditorStore;
            window.testRegistry=(await import(url('/src/plugins/registry.ts'))).pluginRegistry;
            window.testI18n=await import(url('/src/i18n/index.ts'));
            window.activations=0;
            testRegistry.register({id:'keyboard-fixture',name:'Keyboard fixture',version:'1',menuItems:[{
                id:'root',section:'Tools',label:'Keyboard fixture',children:[
                    {id:'disabled',label:'Disabled action',disabled:true,action:()=>window.activations+=100},
                    {id:'sep',label:'',separator:true},
                    {id:'alpha',label:'Alpha action',action:()=>window.activations++},
                    {id:'another',label:'Another action',action:()=>window.activations++},
                    {id:'deep',label:'Deeper menu',children:[
                        {id:'more',label:'Further menu',children:[
                            {id:'final',label:'Final action',action:()=>window.activations++},
                            {id:'check',label:'Checked fixture',checked:()=>true,action:()=>window.activations++},
                        ]},
                    ]},
                ],
            }]});
            testEditor.commands.setContent({type:'doc',content:[{type:'action',content:[{type:'text',text:'Synthetic keyboard selection'}]}]});
            testEditor.commands.setTextSelection({from:1,to:10});
            testEditor.commands.focus();
        }""")

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def row(self, label, role='menuitem'):
        return self.page.get_by_role(role, name=label, exact=True)

    def press(self, key):
        self.page.keyboard.press(key)

    def open(self, label):
        self.page.locator('[role=menubar]').get_by_role('menuitem', name=label, exact=True).focus()
        self.press('ArrowDown')

    def fixture(self):
        self.open('Tools')
        self.press('k')
        expect(self.row('Keyboard fixture')).to_be_focused()
        self.press('ArrowRight')

    def test_entry_roving_wrap_home_end_and_f10_return(self):
        self.press('F10')
        expect(self.row('File')).to_be_focused()
        self.assertEqual(self.page.locator('[role=menubar] > [tabindex="0"]').count(), 1)
        self.press('ArrowLeft')
        expect(self.row('Help')).to_be_focused()
        self.press('Home')
        expect(self.row('File')).to_be_focused()
        self.press('End')
        expect(self.row('Help')).to_be_focused()
        self.press('F10')
        expect(self.page.locator('.ProseMirror')).to_be_focused()
        self.open('File')
        self.press('End')
        last = self.page.locator(':focus').get_attribute('aria-label')
        self.press('ArrowDown')
        expect(self.row('New Script')).to_be_focused()
        self.press('ArrowUp')
        expect(self.row(last)).to_be_focused()
        self.press('Home')
        expect(self.row('New Script')).to_be_focused()

    def test_nested_skip_disabled_typeahead_and_escape(self):
        self.fixture()
        expect(self.row('Alpha action')).to_be_focused()
        expect(self.row('Disabled action')).to_have_attribute('aria-disabled', 'true')
        self.press('a')
        expect(self.row('Another action')).to_be_focused()
        self.press('a')
        expect(self.row('Alpha action')).to_be_focused()
        self.press('d')
        expect(self.row('Deeper menu')).to_be_focused()
        self.press('Enter')
        expect(self.row('Further menu')).to_be_focused()
        self.press('ArrowRight')
        expect(self.row('Final action')).to_be_focused()
        self.press('Escape')
        expect(self.row('Further menu')).to_be_focused()
        expect(self.row('Further menu')).to_have_attribute('aria-expanded', 'false')
        self.press('ArrowLeft')
        expect(self.row('Deeper menu')).to_be_focused()
        self.press('Escape')
        expect(self.row('Keyboard fixture')).to_be_focused()
        self.press('Escape')
        expect(self.row('Tools')).to_be_focused()
        self.assertEqual(self.page.locator('.menu-dropdown').count(), 0)

    def test_action_once_and_checkbox_radio_semantics(self):
        self.fixture()
        self.press('Space')
        self.assertEqual(self.page.evaluate('activations'), 1)
        expect(self.row('Tools')).to_be_focused()
        self.open('View')
        self.press('t')
        expect(self.row('Theme')).to_be_focused()
        self.press('ArrowRight')
        self.assertEqual(self.page.locator('[role=menuitemradio][aria-checked=true]:visible').count(), 1)
        self.assertGreater(self.page.locator('[role=menuitemradio][aria-checked=false]:visible').count(), 0)
        self.press('Escape')
        self.press('Escape')
        self.fixture()
        self.press('End')
        self.press('ArrowRight')
        self.press('ArrowRight')
        expect(self.row('Checked fixture', 'menuitemcheckbox')).to_have_attribute('aria-checked', 'true')

    def test_tab_and_shift_tab_leave_menu(self):
        for key in ['Tab', 'Shift+Tab']:
            self.fixture()
            self.press(key)
            self.assertEqual(self.page.locator('.menu-dropdown').count(), 0)
            self.assertFalse(self.page.evaluate("!!document.activeElement.closest('[role=menu], [role=menubar]')"))

    def test_editor_selection_formatting_and_pointer_behavior(self):
        self.open('Format')
        self.press('s')
        expect(self.row('Style')).to_be_focused()
        self.press('ArrowRight')
        expect(self.row('Bold')).to_be_focused()
        self.press('Enter')
        self.page.wait_for_function("testEditor.isActive('bold')")
        self.assertEqual(self.page.evaluate('({from:testEditor.state.selection.from,to:testEditor.state.selection.to})'), {'from':1,'to':10})
        self.assertEqual(self.page.locator('.ProseMirror strong').inner_text(), 'Synthetic')
        self.page.evaluate('testEditor.commands.undo()')
        self.assertEqual(self.page.locator('.ProseMirror strong').count(), 0)
        self.row('Format').click()
        self.row('Style').hover()
        self.row('Bold').click()
        self.assertEqual(self.page.locator('.ProseMirror strong').inner_text(), 'Synthetic')

    def test_hidden_toolbar_fab_and_layout_changes(self):
        self.page.evaluate("testStore.getState().setToolbarMode('hidden')")
        fab = self.page.get_by_role('button', name='Application menu', exact=True)
        fab.wait_for()
        self.press('F10')
        expect(self.row('File')).to_be_focused()
        self.press('ArrowDown')
        self.press('Escape')
        expect(self.row('File')).to_be_focused()
        self.press('Escape')
        expect(fab).to_be_focused()
        expect(fab).to_have_attribute('aria-expanded', 'false')
        self.press('Space')
        expect(self.row('File')).to_be_focused()
        self.press('ArrowDown')
        self.press('Tab')
        expect(fab).to_have_attribute('aria-expanded', 'false')
        self.assertEqual(self.page.locator('.menu-dropdown').count(), 0)
        fab.focus()
        self.press('Enter')
        expect(self.row('File')).to_be_focused()
        self.page.evaluate("testStore.getState().setToolbarMode('compact')")
        expect(self.row('File')).to_be_focused()

    def test_dialog_focus_and_return(self):
        self.open('File')
        self.press('p')
        expect(self.row('Page Setup…')).to_be_focused()
        self.press('Enter')
        self.page.wait_for_function("!!document.activeElement.closest('.dialog-overlay')")
        self.page.get_by_role('button', name='Cancel', exact=True).focus()
        self.press('Enter')
        expect(self.row('File')).to_be_focused()

    def test_locale_change_and_removed_plugin_recover_focus(self):
        self.fixture()
        self.page.evaluate("testRegistry.unregister('keyboard-fixture')")
        self.assertTrue(self.page.locator(':focus').is_visible())
        self.assertTrue(self.page.locator(':focus').evaluate("el=>!!el.closest('[role=menu]')"))
        self.press('Escape')
        expect(self.row('Tools')).to_be_focused()
        self.open('View')
        self.press('t')
        self.press('ArrowRight')
        self.page.evaluate("testI18n.setLanguage('fr')")
        self.page.wait_for_function("document.documentElement.lang === 'fr'")
        self.assertTrue(self.page.locator(':focus').is_visible())
        self.assertEqual(self.page.locator('[role=menubar] > [tabindex=\"0\"]').count(), 1)

    def test_mobile_and_rtl_nested_navigation(self):
        self.page.set_viewport_size({'width':390,'height':844})
        self.fixture()
        expect(self.row('Alpha action')).to_be_focused()
        self.press('End')
        self.press('ArrowRight')
        self.press('ArrowRight')
        expect(self.row('Final action')).to_be_focused()
        self.assertEqual(self.page.locator(':focus').evaluate('el=>getComputedStyle(el.parentElement).position'), 'static')
        self.press('Escape')
        self.press('Escape')
        self.press('Escape')
        self.press('Escape')
        self.page.set_viewport_size({'width':1440,'height':1000})
        self.page.evaluate("document.documentElement.dir='rtl'")
        self.open('Tools')
        self.press('k')
        self.press('ArrowLeft')
        expect(self.row('Alpha action')).to_be_focused()
        self.press('End')
        self.press('ArrowLeft')
        expect(self.row('Further menu')).to_be_focused()
        self.press('ArrowRight')
        expect(self.row('Deeper menu')).to_be_focused()


if __name__ == '__main__':
    unittest.main(verbosity=2)

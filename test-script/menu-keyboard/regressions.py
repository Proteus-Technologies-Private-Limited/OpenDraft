"""Keyboard menu regressions against Vite, using Python Playwright + Chromium.

Run: OPENDRAFT_TEST_URL=http://127.0.0.1:5173 python test-script/menu-keyboard/regressions.py
OPENDRAFT_CHROMIUM overrides the system Chromium executable. No native devices
or screen readers are simulated; the fixture uses only synthetic script text.
"""
import os
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


class MenuKeyboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get('OPENDRAFT_CHROMIUM') or '/usr/bin/chromium',
            args=['--no-sandbox', '--enable-experimental-web-platform-features'],
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
        if os.environ.get('OPENDRAFT_MENU_FOLDABLE') == '1':
            cdp = self.page.context.new_cdp_session(self.page)
            cdp.send('Emulation.setDeviceMetricsOverride', {
                'width':1440, 'height':1000, 'screenWidth':1440, 'screenHeight':1000,
                'deviceScaleFactor':1, 'mobile':True,
                'displayFeature':{'orientation':'vertical','offset':710,'maskLength':20},
            })
            cdp.send('Emulation.setTouchEmulationEnabled', {'enabled':True})
            cdp.send('Emulation.setDevicePostureOverride', {'posture':{'type':'continuous'}})
        self.page.goto(os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/'))
        self.page.locator('.editor-main').wait_for()
        blank = self.page.get_by_role('button', name='Blank Document', exact=False)
        if blank.count():
            blank.click()
        self.page.locator('.ProseMirror').wait_for()
        if os.environ.get('OPENDRAFT_MENU_FOLDABLE') == '1':
            self.page.wait_for_function("document.documentElement.classList.contains('foldable')")
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
            },{id:'typeahead',section:'Tools',label:'Typeahead fixture',children:[
                {id:'karma',label:'कर्म',action:()=>window.activations++},
                {id:'kiran',label:'किरण',action:()=>window.activations++},
                {id:'kitab',label:'किताब',action:()=>window.activations++},
                {id:'kshama',label:'क्षमा',action:()=>window.activations++},
                {id:'kshetra',label:'क्षेत्र',action:()=>window.activations++},
                {id:'slow',label:'Slow dialog',action:()=>setTimeout(()=>{
                    const dialog=document.createElement('dialog');dialog.id='async-menu-dialog';
                    dialog.innerHTML='<button>Async dialog button</button>';
                    document.body.append(dialog);dialog.showModal();
                    // A native dialog may take focus itself. Exercise the case
                    // where its mounting code has not moved focus yet.
                    document.querySelector('.ProseMirror').focus();
                    testStore.getState().setZoomLevel(110);
                },100)},
            ]}]});
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

    def test_nested_focus_disabled_typeahead_and_escape(self):
        self.fixture()
        disabled=self.row('Disabled action')
        expect(disabled).to_be_focused()
        expect(disabled).to_have_attribute('aria-disabled', 'true')
        self.press('Enter');self.press('Space')
        self.assertEqual(self.page.evaluate('activations'),0)
        expect(disabled).to_be_focused()
        self.press('ArrowDown')
        expect(self.row('Alpha action')).to_be_focused()
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
        self.press('ArrowDown')
        self.press('Space')
        self.assertEqual(self.page.evaluate('activations'), 1)
        expect(self.page.locator('.ProseMirror')).to_be_focused()
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

    def test_panel_theme_layout_and_zoom_commands_return_to_the_script(self):
        self.open('View');self.press('p');self.press('ArrowRight')
        expect(self.row('Navigator','menuitemcheckbox')).to_be_focused()
        self.press('Enter')
        expect(self.page.locator('.ProseMirror')).to_be_focused()
        self.assertEqual(self.page.evaluate('({from:testEditor.state.selection.from,to:testEditor.state.selection.to})'),{'from':1,'to':10})
        self.page.keyboard.type('x')
        self.assertEqual(self.page.locator('.ProseMirror').inner_text(),'x keyboard selection')
        for submenu, choice in [('Theme','Light'),('Layout','Phone')]:
            self.open('View');self.row(submenu).focus();self.press('ArrowRight')
            self.row(choice,'menuitemradio').focus();self.press('Enter')
            expect(self.page.locator('.ProseMirror')).to_be_focused()
        self.open('View');self.press('z');self.press('ArrowRight')
        expect(self.row('Zoom In')).to_be_focused()
        self.press('ArrowDown');self.press('ArrowDown')
        expect(self.row('50%','menuitemradio')).to_be_focused()
        self.press('ArrowUp')
        expect(self.row('Zoom Out')).to_be_focused()
        self.row('125%','menuitemradio').focus();self.press('Enter')
        expect(self.page.locator('.ProseMirror')).to_be_focused()

    def test_shortcuts_and_radio_groups_have_accessible_metadata(self):
        self.open('File')
        expect(self.row('Save Script')).to_have_attribute('aria-keyshortcuts','Control+S')
        expect(self.row('Save Script As…')).to_have_attribute('aria-keyshortcuts','Shift+Control+S')
        ax=self.page.context.new_cdp_session(self.page).send('Accessibility.getFullAXTree')['nodes']
        save=next(node for node in ax if node.get('role',{}).get('value')=='menuitem' and node.get('name',{}).get('value')=='Save Script')
        self.assertIn({'name':'keyshortcuts','value':{'type':'string','value':'Control+S'}},save['properties'])
        self.press('Escape')
        self.open('View');self.press('z');self.press('ArrowRight')
        group=self.page.get_by_role('group',name='Zoom (100%)',exact=True)
        expect(group).to_be_visible()
        self.assertEqual(group.get_by_role('menuitemradio').count(),7)
        self.assertEqual(group.get_by_role('menuitem').count(),0)
        self.assertEqual(group.locator('[aria-checked=true]').count(),1)
        self.press('End')
        expect(self.row('300%','menuitemradio')).to_be_focused()
        self.press('ArrowDown')
        expect(self.row('Zoom In')).to_be_focused()
        shots=os.environ.get('OPENDRAFT_SCREENSHOTS')
        if shots:
            Path(shots).mkdir(parents=True,exist_ok=True)
            self.page.screenshot(path=str(Path(shots)/'keyboard-radio-group.png'))

    def test_indic_typeahead_keeps_vowel_signs_and_ignores_an_isolated_mark(self):
        self.page.evaluate("testI18n.setLanguage('hi')")
        self.page.wait_for_function("document.documentElement.lang==='hi'")
        self.page.locator('[data-menu-top=Tools]').focus();self.press('ArrowDown')
        self.row('Typeahead fixture').focus();self.press('ArrowRight')
        expect(self.row('कर्म')).to_be_focused()
        self.page.locator(':focus').dispatch_event('keydown',{'key':'ि','bubbles':True})
        expect(self.row('कर्म')).to_be_focused()
        self.page.locator(':focus').dispatch_event('keydown',{'key':'क','bubbles':True})
        expect(self.row('किरण')).to_be_focused()
        self.page.locator(':focus').dispatch_event('keydown',{'key':'ि','bubbles':True})
        expect(self.row('किरण')).to_be_focused()
        self.page.locator(':focus').dispatch_event('keydown',{'key':'त','bubbles':True})
        expect(self.row('किताब')).to_be_focused()
        self.page.locator(':focus').dispatch_event('keydown',{'key':'क्ष','bubbles':True})
        expect(self.row('क्षमा')).to_be_focused()
        self.page.locator(':focus').dispatch_event('keydown',{'key':'क्ष','bubbles':True})
        expect(self.row('क्षेत्र')).to_be_focused()
        self.page.locator(':focus').dispatch_event('keydown',{'key':'क','bubbles':True,'isComposing':True})
        expect(self.row('क्षेत्र')).to_be_focused()
        self.assertEqual(self.page.evaluate('activations'),0)

    def test_non_dialog_command_returns_to_its_originating_input(self):
        self.page.evaluate("const input=document.createElement('input');input.id='menu-origin';document.body.append(input);input.focus()")
        self.fixture();self.press('ArrowDown');self.press('Enter')
        expect(self.page.locator('#menu-origin')).to_be_focused()
        self.page.keyboard.type('x')
        expect(self.page.locator('#menu-origin')).to_have_value('x')
        self.assertEqual(self.page.evaluate('activations'),1)
        self.page.evaluate("testStore.getState().setToolbarMode('hidden')")
        self.press('F10');self.fixture();self.press('ArrowDown');self.press('Enter')
        expect(self.page.locator('#menu-origin')).to_be_focused()
        self.assertEqual(self.page.evaluate('activations'),2)

    def test_async_dialog_takes_focus_after_command_returns_to_origin(self):
        self.open('Tools');self.row('Typeahead fixture').focus();self.press('ArrowRight')
        self.press('End');self.press('Enter')
        expect(self.page.locator('.ProseMirror')).to_be_focused()
        expect(self.page.get_by_role('button',name='Async dialog button')).to_be_focused()

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
        expect(self.row('Disabled action')).to_be_focused()
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
        expect(self.row('Disabled action')).to_be_focused()
        self.press('End')
        self.press('ArrowLeft')
        expect(self.row('Further menu')).to_be_focused()
        self.press('ArrowRight')
        expect(self.row('Deeper menu')).to_be_focused()


if __name__ == '__main__':
    unittest.main(verbosity=2)

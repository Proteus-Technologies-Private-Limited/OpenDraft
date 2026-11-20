"""Phone vs desktop: the layout customisation offered matches what takes effect.

On a phone (and any window 1100px or narrower) the panel docks do not exist,
so View > Layout, the Layout dialog, the toolbar's right-click menu, the Views
menu and the customiser must not offer panel layouts. The toolbar and footer
customisation does apply there and must still be offered.

Run against the dev server: venv/bin/python test-script/probe_phone_customisation.py
"""
import os
import sys
import unittest
from playwright.sync_api import sync_playwright

URL = os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/')
OUT = os.path.join(os.path.dirname(__file__), 'output')


class PhoneLayoutCustomisation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def open(self, width, height, mobile):
        page = self.browser.new_page(viewport={'width': width, 'height': height}, is_mobile=mobile, has_touch=mobile)
        self.addCleanup(page.close)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        self.addCleanup(lambda: self.assertEqual(errors, []))
        page.goto(URL, wait_until='domcontentloaded')
        page.locator('.editor-main').wait_for(timeout=20000)
        blank = page.get_by_role('button', name='Blank Document', exact=False)
        if blank.count():
            blank.click()
        page.locator('.ProseMirror').wait_for()
        page.evaluate("""async () => {
          const m = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/editorStore.ts');
          window.testStore = (await import(m.name)).useEditorStore;
          const s = testStore.getState();
          // Layout switcher on the toolbar and footer, labelled, so it is easy to find.
          s.setToolbarLayout({ bars: { top: ['undo-redo', 'notes', 'layout'], bottom: ['zoom', 'layout'] },
                               options: {}, labels: { top: 'both', bottom: 'both' } });
        }""")
        page.wait_for_timeout(400)
        return page

    def view_layout_items(self, page):
        page.get_by_role('menuitem', name='View', exact=True).click()
        page.get_by_role('menuitem', name='Layout', exact=True).hover()
        page.wait_for_timeout(300)
        items = page.evaluate("""() => [...document.querySelectorAll('.menu-dropdown [role=menuitem], .menu-dropdown [role=menuitemradio], .menu-dropdown [role=menuitemcheckbox]')]
            .map(e => e.textContent.trim())""")
        page.keyboard.press('Escape')
        page.keyboard.press('Escape')
        return items

    def dialog_state(self, page, tab):
        page.evaluate(f"testStore.getState().setLayoutDialog('{tab}')")
        page.locator('.layout-dialog').wait_for()
        state = page.evaluate("""() => ({
            tabs: [...document.querySelectorAll('.layout-dialog [role=tab]')].map(e => e.textContent.trim()),
            selected: document.querySelector('.layout-dialog [role=tab][aria-selected=true]')?.textContent.trim(),
            quickSwitch: !!document.querySelector('.layout-quick-switch'),
            barsTab: !!document.querySelector('.bars-tab'),
            layoutItemListed: [...document.querySelectorAll('.bars-tab .bars-list-body')].some(e => /\\bLayout\\b/.test(e.textContent)),
        })""")
        page.evaluate("testStore.getState().setLayoutDialog(null)")
        return state

    def switchers_on_bars(self, page):
        return page.locator('.layout-switcher').count()

    def test_phone_hides_panel_layouts(self):
        page = self.open(390, 800, True)
        page.screenshot(path=os.path.join(OUT, 'phone_layout_customisation.png'))
        self.assertEqual(self.switchers_on_bars(page), 0)
        items = self.view_layout_items(page)
        self.assertTrue(any('Page' in i for i in items), items)
        self.assertFalse(any('Edit layouts' in i for i in items), items)
        self.assertFalse(any('Classic' in i for i in items), items)
        state = self.dialog_state(page, 'panels')
        self.assertEqual(len(state['tabs']), 1, state)
        self.assertTrue(state['barsTab'], state)
        self.assertFalse(state['quickSwitch'], state)
        self.assertFalse(state['layoutItemListed'], state)

    def test_desktop_keeps_panel_layouts(self):
        page = self.open(1400, 900, False)
        self.assertGreaterEqual(self.switchers_on_bars(page), 1)
        items = self.view_layout_items(page)
        self.assertTrue(any('Edit layouts' in i for i in items), items)
        state = self.dialog_state(page, 'panels')
        self.assertEqual(len(state['tabs']), 2, state)
        self.assertFalse(state['barsTab'], state)
        self.assertTrue(state['quickSwitch'], state)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    sys.exit(0 if unittest.main(exit=False, verbosity=2).result.wasSuccessful() else 1)

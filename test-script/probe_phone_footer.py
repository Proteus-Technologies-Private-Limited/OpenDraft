"""The footer: status lines and controls as the writer configured them.

- At every width (a desktop window, a phone, a foldable held open like a book)
  the strip shows what the writer placed, on the side they placed it, for as
  long as it fits, in their order: start side, centre, end side. Nothing on it
  is cut off at the edge.
- What does not fit opens in a row above the strip from the arrow at its end,
  in the same order. The row wraps onto more lines rather than hiding
  controls past the screen's edge, and the Views menu opening from it is not
  cut off. Tapping the script closes it.
- On a narrow footer the script's name and save state shorten to fit.
- There is one zoom control, on either bar, drawn as its setting says
  (buttons, slider or both), with Fit width.
- A phone's toolbar shows icons only, whatever labels were chosen.

Run against the dev server: venv/bin/python test-script/probe_phone_footer.py
Screenshots go to test-script/output/phone-footer/.
"""
import os
import sys
import unittest
from playwright.sync_api import sync_playwright

URL = os.environ.get('OPENDRAFT_TEST_URL', 'http://127.0.0.1:5173/')
OUT = os.path.join(os.path.dirname(__file__), 'output', 'phone-footer')

STATUS = ['status-title', 'status-save', 'status-element', 'status-acts', 'status-runtime',
          'status-words', 'status-revision', 'status-progress', 'status-page']

# Where each footer item shows its text in the row.
ROW_SELECTOR = {
    'status-page': '.status-page', 'status-element': '.status-element', 'status-progress': '.status-goals',
    'status-runtime': '.status-timing', 'status-words': '.status-words', 'zoom': '.zoom-control',
    'theme': '[data-item="theme"]', 'views': '[data-item="views"]', 'navigator': '[data-item="navigator"]',
    'search': '[data-item="search"]', 'notes': '[data-item="notes"]', 'document': '[data-item="document"]',
    'production': '[data-item="production"]', 'title-page': '[data-item="title-page"]',
    'panel:scenes': '[data-item="panel:scenes"]',
}


class Footer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(args=['--enable-experimental-web-platform-features'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def open(self, width, height, mobile, page=None):
        if page is None:
            page = self.browser.new_page(viewport={'width': width, 'height': height}, is_mobile=mobile, has_touch=mobile)
            self.addCleanup(page.close)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        self.addCleanup(lambda: self.assertEqual(errors, []))
        page.goto(URL, wait_until='domcontentloaded')
        page.locator('.editor-main').wait_for(timeout=30000)
        blank = page.get_by_role('button', name='Blank Document', exact=False)
        if blank.count():
            blank.click()
        page.locator('.ProseMirror').wait_for()
        page.evaluate("""async () => {
          const m = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/stores/editorStore.ts');
          window.testStore = (await import(m.name)).useEditorStore;
          testStore.getState().applyToolbarPreset('default');
        }""")
        # Focused from the page: on a mid-width window the navigator overlay sits over the script.
        page.evaluate("document.querySelector('.ProseMirror').focus()")
        page.keyboard.type('Rain hammers the window of the harbour office while Maya sorts receipts.')
        page.wait_for_timeout(1200)
        return page

    def set_bottom(self, page, bottom, options=None, labels=None, top=None):
        page.evaluate("""([bottom, options, labels, top]) => { const s = testStore.getState();
          s.setToolbarLayout({ ...s.toolbarLayout, bars: { top: top ?? s.toolbarLayout.bars.top, bottom },
            options: options ?? s.toolbarLayout.options, labels: labels ?? s.toolbarLayout.labels }); }""",
                      [bottom, options, labels, top])
        page.wait_for_timeout(500)

    def strip(self, page):
        return page.evaluate("""() => {
          // What did not fit stays in the strip unseen (.is-overflow), to be measured.
          const text = (sel) => [...document.querySelectorAll(sel)].filter(e => !e.closest('.is-overflow'))
            .map(e => e.textContent.trim()).filter(Boolean);
          const bar = document.querySelector('.status-bar').getBoundingClientRect();
          return {
            left: text('.status-bar .status-left .status-item'),
            center: text('.status-bar .status-center .status-item'),
            right: text('.status-bar .status-right .status-item'),
            height: Math.round(bar.height),
            toggle: !!document.querySelector('.status-row-toggle'),
            row: !!document.querySelector('.status-row'),
          };
        }""")

    def strip_fit(self, page):
        """Everything on the strip: shown ones must sit wholly inside it, before the arrow."""
        return page.evaluate("""() => {
          const bar = document.querySelector('.status-bar'); const b = bar.getBoundingClientRect();
          const arrow = document.querySelector('.status-row-toggle')?.getBoundingClientRect();
          const shown = [], hidden = [];
          bar.querySelectorAll('.status-slot, .footer-controls > .toolbar-priority-block').forEach(el => {
            const id = el.dataset.slot || el.dataset.item;
            const kids = (el.classList.contains('status-slot') ? [...el.children] : [el])
              .filter(k => getComputedStyle(k).display !== 'none' && k.getBoundingClientRect().width > 0);
            if (!kids.length) return;
            if (el.classList.contains('is-overflow')) { hidden.push(id); return; }
            for (const k of kids) {
              const r = k.getBoundingClientRect();
              shown.push({ id, text: k.textContent.trim().slice(0, 30), left: r.left, right: r.right,
                           clipped: k.scrollWidth > k.clientWidth + 1,
                           inside: r.left >= b.left - 0.5 && r.right <= (arrow ? arrow.left : b.right) + 0.5 });
            }
          });
          return { shown, hidden };
        }""")

    def row_box(self, page):
        return page.evaluate("""() => {
          const r = document.querySelector('.status-row-scroll'); const b = r.getBoundingClientRect();
          const bar = document.querySelector('.status-bar').getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height,
                   barTop: bar.top, scrollW: r.scrollWidth, clientW: r.clientWidth,
                   open: document.querySelector('.status-row').classList.contains('is-open') };
        }""")

    def visible_in_row(self, page):
        """Each item in the open row, and whether all of it is on screen and inside the row."""
        return page.evaluate("""() => {
          const row = document.querySelector('.status-row-scroll').getBoundingClientRect();
          return [...document.querySelectorAll('.status-row-scroll .toolbar-priority-block, .status-row-scroll > .status-item')]
            .map(e => { const b = e.getBoundingClientRect();
              return { name: e.textContent.trim().slice(0, 20), left: b.left, right: b.right, top: b.top,
                       shown: b.width > 0 && b.left >= row.left - 1 && b.right <= row.right + 1
                              && b.left >= -1 && b.right <= innerWidth + 1
                              && b.top >= row.top - 1 && b.bottom <= row.bottom + 1 }; });
        }""")

    def assert_fits_then_row(self, page, name):
        """The strip shows a prefix of the writer's order, none of it cut off; the row has the rest."""
        fit = self.strip_fit(page)
        page.screenshot(path=os.path.join(OUT, f'{name}.png'))
        self.assertTrue(fit['shown'], fit)
        self.assertEqual([s for s in fit['shown'] if not s['inside']], [], fit)
        # Only the name and save state may shorten, and only on a narrow strip.
        narrow = page.evaluate("!!document.querySelector('.status-bar-wrap.is-narrow')")
        allowed = ('status-title', 'status-save') if narrow else ()
        self.assertEqual([s for s in fit['shown'] if s['clipped'] and s['id'] not in allowed], [], fit)
        if not fit['hidden']:
            self.assertFalse(self.strip(page)['toggle'])
            return fit
        page.locator('.status-row-toggle').click()
        page.wait_for_timeout(450)
        page.screenshot(path=os.path.join(OUT, f'{name}_open.png'))
        for item in fit['hidden']:
            if item == 'status-title':
                self.assertIn('Untitled Screenplay', page.locator('.status-row-scroll').inner_text(), fit)
                continue
            sel = ROW_SELECTOR.get(item, f'[data-item="{item}"]')
            self.assertGreaterEqual(page.locator(f'.status-row-scroll {sel}').count(), 1, (item, fit))
        self.assertEqual([i for i in self.visible_in_row(page) if not i['shown']], [])
        box = self.row_box(page)
        self.assertAlmostEqual(box['bottom'], box['barTop'], delta=1.5)
        self.assertLessEqual(box['scrollW'], box['clientW'] + 1, box)
        return fit

    # ── Desktop ──
    def test_desktop_default_and_customise(self):
        page = self.open(1400, 900, False)
        strip = self.strip(page)
        page.screenshot(path=os.path.join(OUT, 'desktop_default.png'))
        self.assertIn('Untitled Screenplay', strip['left'])
        self.assertTrue(any('Page 1 of 1' in t for t in strip['right']), strip)
        self.assertTrue(any('words' in t for t in strip['right']), strip)
        self.assertEqual(len(strip['center']), 1, strip)  # the current element
        # The one zoom, at the footer's end, with its slider and Fit width.
        self.assertEqual(page.locator('.zoom-control').count(), 1)
        self.assertEqual(page.locator('.status-bar .zoom-control .zoom-slider').count(), 1)
        self.assertEqual(page.locator('.status-bar .zoom-control .zoom-fit').count(), 1)
        self.assertEqual(page.locator('.toolbar .zoom-control').count(), 0)
        self.assertFalse(strip['toggle'], strip)
        self.assertEqual(strip['height'], 24)
        # Every status line can come off and go back.
        self.set_bottom(page, ['status-title', 'status-page', 'zoom'])
        strip = self.strip(page)
        self.assertFalse(any('words' in t for t in strip['right']), strip)
        self.assertEqual(strip['center'], [], strip)
        # Words to the centre.
        self.set_bottom(page, STATUS + ['zoom'], {'status-words': {'side': 'center'}})
        strip = self.strip(page)
        self.assertTrue(any('words' in t for t in strip['center']), strip)
        page.screenshot(path=os.path.join(OUT, 'desktop_words_centre.png'))

    def test_desktop_footer_too_full_gets_the_expander(self):
        # Full screen too: what the strip has no room for opens from the arrow.
        # Above 1100px, where the panels dock rather than overlay the footer.
        page = self.open(1200, 800, False)
        self.set_bottom(page, STATUS + ['zoom', 'views', 'navigator', 'theme', 'document', 'production',
                                        'title-page', 'panel:scenes', 'panel:pages', 'panel:locations', 'search', 'notes'],
                        {'theme': {'side': 'end'}, 'search': {'side': 'end'}, 'notes': {'side': 'end'}})
        fit = self.assert_fits_then_row(page, 'desktop_too_full')
        self.assertTrue(fit['hidden'], fit)
        # The writer's order: what went up is the end of it.
        self.assertEqual(fit['hidden'][-1], 'notes', fit)

    def test_zoom_is_one_control_drawn_as_set(self):
        page = self.open(1400, 900, False)
        zoom = '.status-bar .zoom-control'
        self.set_bottom(page, STATUS + ['zoom'], {'zoom': {'zoomStyle': 'buttons'}})
        self.assertEqual(page.locator(f'{zoom} .zoom-slider').count(), 0)
        self.assertEqual(page.locator(f'{zoom} .toolbar-btn:not(.zoom-fit)').count(), 2)
        self.set_bottom(page, STATUS + ['zoom'], {'zoom': {'zoomStyle': 'slider'}})
        self.assertEqual(page.locator(f'{zoom} .zoom-slider').count(), 1)
        self.assertEqual(page.locator(f'{zoom} .toolbar-btn:not(.zoom-fit)').count(), 0)
        page.screenshot(path=os.path.join(OUT, 'zoom_slider_only.png'))
        # Up to the toolbar: the same control, there and not on the footer.
        self.set_bottom(page, STATUS, {}, top=['undo-redo', 'element', 'search', 'notes', 'zoom'])
        self.assertEqual(page.locator('.zoom-control').count(), 1)
        self.assertEqual(page.locator('.toolbar .zoom-control .zoom-fit').count(), 1)
        page.screenshot(path=os.path.join(OUT, 'zoom_on_toolbar.png'))
        before = page.evaluate('testStore.getState().zoomLevel')
        page.locator('.toolbar .zoom-control .toolbar-btn').nth(1).click()
        self.assertEqual(page.evaluate('testStore.getState().zoomLevel'), before + 10)
        # A layout saved with both zoom controls loads with one, on the footer.
        merged = page.evaluate("""async () => {
          const m = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/utils/toolbarLayout.ts');
          const tl = await import(m.name);
          return tl.normaliseToolbarLayout({ version: 2, bars: { top: ['undo-redo', 'zoom'], bottom: ['status-page', 'status-zoom'] } }).bars;
        }""")
        self.assertEqual(merged, {'top': ['undo-redo'], 'bottom': ['status-page', 'zoom']})

    # ── Phone ──
    def test_phone_default_strip_and_row(self):
        page = self.open(390, 800, True)
        strip = self.strip(page)
        self.assertEqual(strip['height'], 24, strip)
        self.assertTrue(strip['toggle'], strip)
        box = self.row_box(page)
        self.assertFalse(box['open'])
        self.assertEqual(page.locator('.status-row').evaluate('el => el.inert'), True)
        self.assert_fits_then_row(page, 'phone_default')
        box = self.row_box(page)
        self.assertTrue(box['open'])
        self.assertEqual(page.locator('.status-row-toggle').get_attribute('aria-expanded'), 'true')
        # The zoom went up to the row, whole: buttons, slider and Fit width.
        self.assertEqual(page.locator('.status-row .zoom-control').count(), 1)
        self.assertTrue(page.locator('.status-row .zoom-fit').is_visible())
        self.assertTrue(page.locator('.status-row .zoom-slider').is_visible())
        # The strip did not grow.
        self.assertEqual(self.strip(page)['height'], 24)
        # The zoom in the row works.
        before = page.evaluate('testStore.getState().zoomLevel')
        page.locator('.status-row .zoom-control .toolbar-btn').nth(1).click()
        self.assertEqual(page.evaluate('testStore.getState().zoomLevel'), before + 10)
        # Tapping the script closes it.
        page.locator('.ProseMirror').click()
        page.wait_for_timeout(400)
        self.assertFalse(self.row_box(page)['open'])

    def test_phone_strip_follows_the_configuration(self):
        # The layout from the report: every status line, the zoom at the end.
        # The strip shows what fits in this order, controls and centre
        # included; the row the rest.
        bottom = ['status-title', 'status-save', 'status-element', 'status-runtime', 'status-acts', 'status-words',
                  'status-revision', 'status-progress', 'status-page', 'zoom']
        for width in (277, 320, 390):
            with self.subTest(width=width):
                page = self.open(width, 800, True)
                self.set_bottom(page, bottom, {}, {'top': 'icon', 'bottom': 'icon'})
                fit = self.assert_fits_then_row(page, f'phone_config_{width}')
                self.assertIn('zoom', fit['hidden'], fit)
        # Room for a control: it stays on the strip, where it was placed.
        page = self.open(390, 800, True)
        self.set_bottom(page, ['status-page', 'theme'], {'theme': {'side': 'end'}})
        fit = self.strip_fit(page)
        self.assertEqual(fit['hidden'], [], fit)
        self.assertIn('theme', [s['id'] for s in fit['shown']], fit)
        self.assertFalse(self.strip(page)['toggle'])
        page.screenshot(path=os.path.join(OUT, 'phone_control_on_strip.png'))

    def test_phone_row_wraps_controls_after_the_zoom(self):
        # The zoom alone is most of a phone's width; what was placed after it
        # used to sit past the screen's edge in a sideways scroll with no bar.
        for width in (390, 320):
            with self.subTest(width=width):
                page = self.open(width, 800, True)
                self.set_bottom(page, STATUS + ['zoom', 'theme', 'search', 'notes', 'views'],
                                {'theme': {'side': 'end'}, 'search': {'side': 'end'},
                                 'notes': {'side': 'end'}, 'views': {'side': 'end'}})
                self.assert_fits_then_row(page, f'phone_row_after_zoom_{width}')
                for name in ('Light', 'Find', 'Notes', 'Views'):
                    self.assertIn(name, page.locator('.status-row-scroll').inner_text())
                self.assertGreater(self.row_box(page)['height'], 60)

    def test_phone_full_row_and_menu_is_not_clipped(self):
        page = self.open(390, 800, True)
        self.set_bottom(page, STATUS + ['zoom', 'navigator', 'views', 'theme', 'search', 'notes',
                                        'title-page', 'production', 'document'],
                        {k: {'side': 'end'} for k in ('navigator', 'views', 'theme', 'search', 'notes',
                                                      'title-page', 'production', 'document')},
                        labels={'top': 'icon', 'bottom': 'both'})
        self.assert_fits_then_row(page, 'phone_row_full')
        box = self.row_box(page)
        # It stays a footer: no taller than half the screen.
        self.assertLessEqual(box['height'], 800 * 0.45 + 1, box)
        views = page.locator('.status-row .toolbar-views-btn')
        views.click()
        menu = page.locator('.status-row .toolbar-views-menu')
        menu.wait_for()
        mb = menu.bounding_box()
        page.screenshot(path=os.path.join(OUT, 'phone_row_views_menu.png'))
        self.assertGreater(mb['height'], 100, mb)
        self.assertLessEqual(mb['y'] + mb['height'], box['top'] + 1, (mb, box))
        self.assertGreaterEqual(mb['y'], 0, mb)
        # What is drawn at the menu's centre is the menu, not something over it.
        hit = page.evaluate("([x, y]) => !!document.elementFromPoint(x, y)?.closest('.toolbar-views-menu')",
                            [mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2])
        self.assertTrue(hit)

    def test_phone_status_lines_customisable(self):
        page = self.open(390, 800, True)
        self.set_bottom(page, ['status-page', 'status-words'])
        strip = self.strip(page)
        self.assertEqual(strip['left'], [], strip)
        self.assertTrue(any('words' in t for t in strip['right']), strip)
        # Everything fits: no arrow.
        self.assertFalse(strip['toggle'], strip)
        page.screenshot(path=os.path.join(OUT, 'phone_custom_strip.png'))

    def test_phone_toolbar_shows_icons_only(self):
        page = self.open(390, 800, True)
        page.evaluate("""() => { const s = testStore.getState();
          s.setToolbarLayout({ ...s.toolbarLayout, labels: { top: 'text', bottom: 'text' } }); }""")
        page.wait_for_timeout(500)
        labels = page.locator('.toolbar .toolbar-btn-label')
        visible = [labels.nth(i).text_content() for i in range(labels.count()) if labels.nth(i).is_visible()]
        page.screenshot(path=os.path.join(OUT, 'phone_toolbar_text_setting.png'))
        self.assertEqual(visible, [])
        # The dialog says so instead of offering the choice.
        page.evaluate("testStore.getState().setLayoutDialog('toolbar')")
        page.locator('.bars-tab').wait_for()
        self.assertEqual(page.get_by_role('radiogroup', name='Toolbar shows').count(), 0)
        self.assertEqual(page.get_by_role('radiogroup', name='Footer shows').count(), 1)
        # Status lines are listed, and can only go on the footer.
        page.locator('.bars-tab').get_by_text('Word count', exact=True).first.click()
        place = page.get_by_role('radiogroup', name='Place on')
        self.assertTrue(place.get_by_role('radio', name='Toolbar').is_disabled())
        page.screenshot(path=os.path.join(OUT, 'phone_customise_dialog.png'))

    # ── A foldable held open like a book: the footer spans the left half ──
    def test_foldable_book_footer(self):
        page = self.browser.new_page(no_viewport=True)
        self.addCleanup(page.close)
        cdp = page.context.new_cdp_session(page)
        width, height = 800, 800

        def posture(fold):
            cdp.send('Emulation.setDeviceMetricsOverride', {
                'width': width, 'height': height, 'deviceScaleFactor': 1, 'mobile': True,
                'screenWidth': width, 'screenHeight': height,
                'displayFeature': {'orientation': 'vertical', 'offset': width // 2 - 10, 'maskLength': 20}})
            cdp.send('Emulation.setTouchEmulationEnabled', {'enabled': True})
            cdp.send('Emulation.setDevicePostureOverride', {'posture': {'type': fold}})
            page.wait_for_timeout(300)

        # Open flat first, then fold to a book, as a writer would (foldables/posture.py).
        posture('continuous')
        self.open(width, height, True, page=page)
        self.assertFalse(self.strip(page)['toggle'])
        posture('folded')
        page.wait_for_function("document.documentElement.classList.contains('fold-book')", timeout=10000)
        page.wait_for_timeout(500)
        # A screenshot or a Playwright click resets CDP's device emulation and
        # unfolds the page, so the arrow is pressed from the page and the
        # screenshots come last.
        strip = self.strip(page)
        self.assertTrue(strip['toggle'], strip)
        self.assertEqual(strip['height'], 24, strip)
        fit = self.strip_fit(page)
        self.assertEqual([s for s in fit['shown'] if not s['inside']], [], fit)
        page.locator('.status-row-toggle').evaluate('el => el.click()')
        page.wait_for_timeout(450)
        self.assertIn('fold-book', page.evaluate('document.documentElement.className'))
        box = self.row_box(page)
        self.assertTrue(box['open'], box)
        self.assertLessEqual(box['right'], width / 2 + 1, box)
        self.assertAlmostEqual(box['bottom'], box['barTop'], delta=1.5)
        self.assertEqual(page.locator('.status-row .zoom-control').count(), 1)
        page.screenshot(path=os.path.join(OUT, 'fold_book_row_open.png'))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    sys.exit(0 if unittest.main(exit=False, verbosity=2).result.wasSuccessful() else 1)

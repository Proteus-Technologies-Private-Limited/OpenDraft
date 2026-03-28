import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log(`\n=== Opening ${URL} ===\n`);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // Let editor fully initialize

  // 1. Check if the page loaded
  const title = await page.title();
  console.log('Page title:', title);

  // 2. Check key DOM elements exist
  const checks = [
    '.app-container',
    '.page',
    '.tiptap',
    '.ProseMirror',
    '.screenplay-content',
    '.scene-heading',
    '.character',
    '.dialogue',
    '.action',
    '.page-sep',       // React overlay separator
    '.page-break',     // Old widget separator (should NOT exist)
    '[data-page-break]', // Node decoration
  ];

  console.log('\n--- DOM Element Check ---');
  for (const sel of checks) {
    const count = await page.locator(sel).count();
    console.log(`  ${sel}: ${count} found`);
  }

  // 3. Check editor root structure
  console.log('\n--- Editor Root Children ---');
  const editorInfo = await page.evaluate(() => {
    const root = document.querySelector('.tiptap') || document.querySelector('.ProseMirror') || document.querySelector('.screenplay-content');
    if (!root) return { error: 'No editor root found' };
    const children = Array.from(root.children);
    return {
      rootTag: root.tagName,
      rootClasses: root.className,
      childCount: children.length,
      first5: children.slice(0, 5).map(c => ({
        tag: c.tagName,
        class: c.className,
        dataType: c.getAttribute('data-type'),
        text: c.textContent?.substring(0, 50),
      })),
      last5: children.slice(-5).map(c => ({
        tag: c.tagName,
        class: c.className,
        dataType: c.getAttribute('data-type'),
        text: c.textContent?.substring(0, 50),
      })),
    };
  });
  console.log(JSON.stringify(editorInfo, null, 2));

  // 4. Check pagination plugin state
  console.log('\n--- Pagination State ---');
  const paginationState = await page.evaluate(() => {
    // Try to access the editor instance
    const editorEl = document.querySelector('.tiptap');
    if (!editorEl) return { error: 'No .tiptap element' };

    // Check if there's a PM editor view
    // @ts-ignore
    const view = editorEl.pmViewDesc?.view || editorEl.__view;
    if (view) {
      const state = view.state;
      // Try to find pagination plugin state
      for (const plugin of state.plugins) {
        const pState = plugin.getState(state);
        if (pState && typeof pState === 'object' && 'pageCount' in pState) {
          return {
            found: true,
            pageCount: pState.pageCount,
            breaksCount: pState.breaks?.length || 0,
            breaks: (pState.breaks || []).map(b => ({
              nodeIndex: b.nodeIndex,
              pageNumber: b.pageNumber,
              linesOnPage: b.linesOnPage,
            })),
          };
        }
      }
      return { error: 'Pagination plugin state not found in plugins', pluginCount: state.plugins.length };
    }
    return { error: 'No PM view found on element' };
  });
  console.log(JSON.stringify(paginationState, null, 2));

  // 5. Check page-sep overlays
  console.log('\n--- Page Sep Overlays ---');
  const sepInfo = await page.evaluate(() => {
    const seps = document.querySelectorAll('.page-sep');
    return {
      count: seps.length,
      details: Array.from(seps).map(s => ({
        style: s.getAttribute('style'),
        innerHTML: s.innerHTML.substring(0, 200),
      })),
    };
  });
  console.log(JSON.stringify(sepInfo, null, 2));

  // 6. Check if margin-top was injected on any elements
  console.log('\n--- Elements with large margin-top ---');
  const marginInfo = await page.evaluate(() => {
    const root = document.querySelector('.tiptap') || document.querySelector('.ProseMirror');
    if (!root) return [];
    return Array.from(root.children)
      .map((el, i) => {
        const style = el.style.marginTop;
        const computed = getComputedStyle(el).marginTop;
        if (style || parseFloat(computed) > 50) {
          return { index: i, tag: el.tagName, class: el.className, inlineMargin: style, computedMargin: computed };
        }
        return null;
      })
      .filter(Boolean);
  });
  console.log(JSON.stringify(marginInfo, null, 2));

  // 7. Check console errors
  console.log('\n--- Console Errors ---');
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.waitForTimeout(500);
  if (errors.length === 0) console.log('  (none captured in last 500ms)');
  else errors.forEach(e => console.log('  ERROR:', e));

  // 8. Screenshot
  const ssPath = '/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/debug-screenshot.png';
  await page.screenshot({ path: ssPath, fullPage: true });
  console.log(`\nScreenshot saved to: ${ssPath}`);

  await browser.close();
  console.log('\n=== Debug Complete ===');
})();

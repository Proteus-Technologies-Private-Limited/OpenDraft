import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Simulate what updateOverlays does
  const result = await page.evaluate(() => {
    const page = document.querySelector('.page');
    if (!page) return { error: 'No .page element' };

    const editorRoot = page.querySelector('.tiptap') ||
                       page.querySelector('.ProseMirror') ||
                       page.querySelector('.screenplay-content');
    if (!editorRoot) return { error: 'No editor root' };

    const blockEls = Array.from(editorRoot.children).filter(
      el => el.nodeType === Node.ELEMENT_NODE
    );

    // Check what types these elements are
    const elementTypes = blockEls.map((el, i) => ({
      index: i,
      class: el.className,
      dataType: el.getAttribute('data-type'),
      tag: el.tagName,
    }));

    return {
      editorRootTag: editorRoot.tagName,
      editorRootClass: editorRoot.className,
      blockElsCount: blockEls.length,
      // Show elements around expected break indices (around 20 and 43)
      around20: elementTypes.slice(18, 23),
      around43: elementTypes.slice(41, 46),
      // Check if nodeIndex 20 exists
      el20: elementTypes[20] || 'NOT FOUND',
      el43: elementTypes[43] || 'NOT FOUND',
    };
  });

  console.log('=== Editor DOM Analysis ===');
  console.log(JSON.stringify(result, null, 2));

  // Now check what the React component's breaksRef has
  // We can check by looking at the overlays state
  const overlayState = await page.evaluate(() => {
    const seps = document.querySelectorAll('.page-sep');
    return Array.from(seps).map(s => ({
      style: s.getAttribute('style'),
      dataPage: s.getAttribute('data-page'),
    }));
  });
  console.log('\n=== Overlay Elements ===');
  console.log(JSON.stringify(overlayState, null, 2));

  // Check page dimensions
  const pageDims = await page.evaluate(() => {
    const p = document.querySelector('.page');
    if (!p) return null;
    const rect = p.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
  });
  console.log('\n=== Page Dimensions ===');
  console.log(JSON.stringify(pageDims, null, 2));

  await browser.close();
})();

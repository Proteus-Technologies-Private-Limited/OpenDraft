import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const seps = document.querySelectorAll('.page-sep');
    const pageEl = document.querySelector('.page');
    const pageRect = pageEl?.getBoundingClientRect();

    // Check for elements with Decoration.node style
    const styledEls = [];
    const root = document.querySelector('.tiptap');
    if (root) {
      Array.from(root.children).forEach((el, i) => {
        const mt = el.style?.marginTop;
        if (mt && parseFloat(mt) > 50) {
          styledEls.push({ index: i, marginTop: mt, class: el.className.substring(0, 50) });
        }
      });
    }

    return {
      sepCount: seps.length,
      seps: Array.from(seps).map(s => ({
        top: s.getAttribute('style'),
        children: s.children.length,
      })),
      pageHeight: pageRect?.height,
      styledElements: styledEls,
    };
  });

  console.log('=== Results ===');
  console.log(JSON.stringify(result, null, 2));

  await page.screenshot({
    path: '/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/debug-final.png',
    fullPage: true
  });
  console.log('Screenshot saved');

  await browser.close();
})();

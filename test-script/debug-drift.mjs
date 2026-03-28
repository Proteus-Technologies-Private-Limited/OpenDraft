import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Import FDX
  await page.locator('.menu-item').filter({ hasText: 'File' }).click();
  await page.waitForTimeout(300);
  const fcPromise = page.waitForEvent('filechooser');
  await page.locator('.menu-dropdown-item').filter({ hasText: /Import/i }).first().click();
  const fc = await fcPromise;
  await fc.setFiles(path.resolve('test-doc.fdx'));
  await page.waitForTimeout(3000);

  // Check actual content height vs expected for each page break
  const analysis = await page.evaluate(() => {
    const root = document.querySelector('.tiptap');
    if (!root) return { error: 'no tiptap' };

    const pageEl = document.querySelector('.page');
    const pageRect = pageEl.getBoundingClientRect();

    // Find all children with margin-top (break elements from Decoration.node)
    const children = Array.from(root.children);
    const breakEls = [];
    children.forEach((el, i) => {
      const mt = parseFloat(el.style?.marginTop);
      if (mt > 100) {
        breakEls.push({
          index: i,
          marginTop: mt,
          topFromPage: el.getBoundingClientRect().top - pageRect.top,
          className: el.className.substring(0, 40),
          text: el.textContent?.substring(0, 40),
        });
      }
    });

    // For first 5 breaks, check the element BEFORE the break
    // to see where content actually ends
    const details = breakEls.slice(0, 8).map((brk, brkIdx) => {
      const prevEl = children[brk.index - 1];
      const prevRect = prevEl?.getBoundingClientRect();
      const prevBottom = prevRect ? prevRect.bottom - pageRect.top : 0;

      // Expected content end for this page
      // Page 1 content: 96px (top margin) to 96 + 928 = 1024px
      // Page 2 content: 1024 + 232 (sep) to 1024 + 232 + 928 = 2184px
      // Page N+1 content start: 96 + N * (928 + 232)
      // Page N+1 content end: 96 + (N+1) * 928 + N * 232
      const expectedContentEnd = 96 + (brkIdx + 1) * 928 + brkIdx * 232;

      return {
        breakIndex: brkIdx,
        nodeIndex: brk.index,
        prevElBottom: Math.round(prevBottom),
        expectedContentEnd,
        drift: Math.round(prevBottom - expectedContentEnd),
        breakElTop: Math.round(brk.topFromPage),
        marginTop: Math.round(brk.marginTop),
        text: brk.text,
      };
    });

    return {
      totalChildren: children.length,
      breakCount: breakEls.length,
      details,
    };
  });

  console.log('=== Page Break Drift Analysis ===');
  console.log(JSON.stringify(analysis, null, 2));

  // Screenshot pages 1-2 break, 2-3 break, and later
  for (const [label, scroll] of [['break1', 850], ['break2', 2000], ['break5', 5500], ['break10', 11500]]) {
    await page.evaluate((s) => document.querySelector('.editor-main')?.scrollTo(0, s), scroll);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/drift-${label}.png`,
    });
  }
  console.log('Screenshots saved');

  await browser.close();
})();

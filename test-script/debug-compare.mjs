import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
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

  // Detailed analysis of break positions and content
  const analysis = await page.evaluate(() => {
    const root = document.querySelector('.tiptap');
    const pageEl = document.querySelector('.page');
    if (!root || !pageEl) return { error: 'missing elements' };

    const pageRect = pageEl.getBoundingClientRect();
    const pageStyle = getComputedStyle(pageEl);
    const children = Array.from(root.children);

    // Find all break elements (with decoration margin)
    const breakEls = [];
    children.forEach((el, i) => {
      const mt = parseFloat(el.style?.marginTop);
      if (mt > 100) {
        breakEls.push({ index: i, marginTop: mt });
      }
    });

    // For first 5 breaks, get the last text on current page and first text on next page
    const details = breakEls.slice(0, 5).map((brk, brkIdx) => {
      const prevEl = children[brk.index - 1];
      const breakEl = children[brk.index];
      const prevRect = prevEl?.getBoundingClientRect();
      const breakRect = breakEl?.getBoundingClientRect();

      return {
        breakIdx: brkIdx,
        nodeIndex: brk.index,
        marginTop: brk.marginTop,
        // Last element of current page
        prevText: prevEl?.textContent?.substring(0, 60),
        prevBottom: Math.round(prevRect?.bottom - pageRect.top),
        prevClass: prevEl?.className?.split(' ').pop(),
        // First element of next page
        breakText: breakEl?.textContent?.substring(0, 60),
        breakTop: Math.round(breakRect?.top - pageRect.top),
        breakClass: breakEl?.className?.split(' ').pop(),
        // Gap between prev bottom and break top (should be separator height)
        gapPx: Math.round((breakRect?.top - prevRect?.bottom)),
      };
    });

    return {
      pageWidth: pageStyle.width,
      pagePadLeft: pageStyle.paddingLeft,
      pagePadRight: pageStyle.paddingRight,
      pagePadTop: pageStyle.paddingTop,
      pagePadBottom: pageStyle.paddingBottom,
      contentWidth: root.getBoundingClientRect().width,
      breakCount: breakEls.length,
      details,
    };
  });

  console.log('=== Detailed Break Analysis ===');
  console.log(JSON.stringify(analysis, null, 2));

  // Take screenshots at each of first 4 page breaks, focused on the break area
  for (let i = 0; i < 4; i++) {
    // Scroll to just before each break
    const scrollTarget = analysis.details?.[i]?.prevBottom - 300 || i * 1200;
    await page.evaluate((s) => document.querySelector('.editor-main')?.scrollTo(0, s), scrollTarget);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/compare-break${i+1}.png`,
    });
  }
  console.log('Screenshots saved');

  await browser.close();
})();

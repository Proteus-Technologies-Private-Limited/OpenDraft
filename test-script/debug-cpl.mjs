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

  // Measure chars per line the same way the code does
  const cpl = await page.evaluate(() => {
    const root = document.querySelector('.tiptap');
    if (!root) return { error: 'no root' };

    const types = [
      'scene-heading', 'action', 'character', 'dialogue',
      'parenthetical', 'transition', 'general',
    ];
    const result = {};
    const testStr = 'X'.repeat(300);

    for (const cssType of types) {
      const el = document.createElement('div');
      el.className = `screenplay-element ${cssType}`;
      el.setAttribute('data-type', cssType);
      el.style.visibility = 'hidden';
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '0';
      el.style.right = '0';
      el.textContent = testStr;
      root.appendChild(el);

      const rect = el.getBoundingClientRect();
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      const padL = getComputedStyle(el).paddingLeft;
      const padR = getComputedStyle(el).paddingRight;
      const width = rect.width;
      const height = rect.height;
      const numLines = Math.round(height / fontSize);
      const cpl = numLines > 0 ? Math.floor(300 / numLines) : 60;

      result[cssType] = { width, height, fontSize, padL, padR, numLines, cpl };
      root.removeChild(el);
    }

    // Also check actual content area width
    const rootRect = root.getBoundingClientRect();
    result['_rootWidth'] = rootRect.width;

    return result;
  });

  console.log('=== Measured Chars Per Line ===');
  console.log(JSON.stringify(cpl, null, 2));

  await browser.close();
})();

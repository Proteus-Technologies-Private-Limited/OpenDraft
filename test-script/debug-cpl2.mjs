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

  // Measure using the NEW approach (char width based)
  const cpl = await page.evaluate(() => {
    const root = document.querySelector('.tiptap');
    if (!root) return { error: 'no root' };

    // Measure char width
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-family:inherit;font-size:inherit;';
    probe.textContent = 'X'.repeat(100);
    root.appendChild(probe);
    const charWidth = probe.getBoundingClientRect().width / 100;
    root.removeChild(probe);

    const types = ['scene-heading', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'general'];
    const result = { charWidth };

    for (const cssType of types) {
      const el = document.createElement('div');
      el.className = `screenplay-element ${cssType}`;
      el.setAttribute('data-type', cssType);
      el.style.visibility = 'hidden';
      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '0';
      el.style.right = '0';
      el.textContent = 'X';
      root.appendChild(el);
      const cs = getComputedStyle(el);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const elWidth = el.getBoundingClientRect().width;
      const availableWidth = elWidth - padL - padR;
      const cplVal = Math.floor(availableWidth / charWidth);
      result[cssType] = { elWidth, padL, padR, availableWidth, cpl: cplVal };
      root.removeChild(el);
    }
    return result;
  });

  console.log('=== New CPL Measurement ===');
  console.log(JSON.stringify(cpl, null, 2));

  // Now run the 15-page comparison
  console.log('\n=== Running 15-page comparison ===');

  await browser.close();
})();

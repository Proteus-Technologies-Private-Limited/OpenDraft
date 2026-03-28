import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', msg => { if (msg.type() === 'error') console.log(`[ERR]`, msg.text()); });

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

  // Screenshot at various deep scroll positions (pages 10, 20, 40, 80)
  for (const scrollPos of [10000, 22000, 44000, 88000]) {
    await page.evaluate((pos) => {
      document.querySelector('.editor-main')?.scrollTo(0, pos);
    }, scrollPos);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/fdx-deep-${scrollPos}.png`,
    });
    console.log(`Screenshot at scroll=${scrollPos}`);
  }

  await browser.close();
})();

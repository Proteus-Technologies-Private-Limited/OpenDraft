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

  const info = await page.evaluate(() => {
    const pageEl = document.querySelector('.page');
    const seps = document.querySelectorAll('.page-sep');
    const pageStyle = pageEl ? getComputedStyle(pageEl) : null;
    return {
      pageWidth: pageStyle?.width,
      pageMinHeight: pageStyle?.minHeight,
      pagePaddingTop: pageStyle?.paddingTop,
      pagePaddingBottom: pageStyle?.paddingBottom,
      sepCount: seps.length,
      firstSepTop: seps[0]?.getAttribute('style'),
      secondSepTop: seps[1]?.getAttribute('style'),
      // Check page break gap in first separator
      firstSepBottom: seps[0]?.querySelector('.page-sep-bottom')?.getBoundingClientRect().height,
      firstSepGap: seps[0]?.querySelector('.page-sep-gap')?.getBoundingClientRect().height,
      firstSepTopMargin: seps[0]?.querySelector('.page-sep-top')?.getBoundingClientRect().height,
    };
  });
  console.log('=== Page Layout After FDX Import ===');
  console.log(JSON.stringify(info, null, 2));

  // Expected: A4 with 72pt margins
  // Page width: 8.26in = 793px
  // Page height: 11.69in = 1122px
  // Top margin: 72pt = 96px
  // Bottom margin: 72pt = 96px
  // Content height: 1122 - 96 - 96 = 930px
  // Lines per page: floor(698pt / 12pt) = 58
  // Page content px: 58 * 16 = 928px
  // Sep height: 96 + 40 + 96 = 232px
  // First sep top: 96 + 928 = 1024px

  console.log('\nExpected values for A4 + 72pt margins:');
  console.log('  Page width: 793px (8.26in)');
  console.log('  Lines per page: 58');
  console.log('  Content area: 928px (58*16)');
  console.log('  First sep top: ~1024px (96 + 928)');
  console.log('  Sep height: ~232px (96+40+96)');

  // Screenshot first page break
  await page.evaluate(() => {
    document.querySelector('.editor-main')?.scrollTo(0, 800);
  });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: '/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/layout-break1.png',
  });
  console.log('\nScreenshot saved');

  await browser.close();
})();

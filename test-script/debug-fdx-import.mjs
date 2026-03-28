import { chromium } from 'playwright';
import path from 'path';

const URL = process.argv[2] || 'http://localhost:8000';
const FDX_PATH = path.resolve('test-doc.fdx');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[ERR]`, msg.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Import the FDX file via the File menu
  // Find and click "File" menu
  const fileMenu = page.locator('.menu-item').filter({ hasText: 'File' });
  await fileMenu.click();
  await page.waitForTimeout(300);

  // Set up file chooser handler before clicking import
  const fileChooserPromise = page.waitForEvent('filechooser');

  // Click "Import FDX"
  const importItem = page.locator('.menu-dropdown-item').filter({ hasText: /Import.*FDX/i });
  if (await importItem.count() > 0) {
    await importItem.click();
  } else {
    // Try just "Import"
    const importAny = page.locator('.menu-dropdown-item').filter({ hasText: /Import/i });
    console.log('Import options:', await importAny.count());
    const texts = await importAny.allTextContents();
    console.log('Available:', texts);
    await importAny.first().click();
  }

  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(FDX_PATH);
  await page.waitForTimeout(3000);

  // Check the content loaded
  const info = await page.evaluate(() => {
    const root = document.querySelector('.tiptap');
    if (!root) return { error: 'no tiptap' };
    const children = Array.from(root.children);
    const seps = document.querySelectorAll('.page-sep');
    return {
      childCount: children.length,
      firstText: children[0]?.textContent?.substring(0, 60),
      sepCount: seps.length,
      seps: Array.from(seps).map(s => s.getAttribute('style')),
    };
  });
  console.log('After import:', JSON.stringify(info, null, 2));

  // Screenshot at each page break
  for (let scrollPos = 0; scrollPos < 5000; scrollPos += 800) {
    await page.evaluate((pos) => {
      document.querySelector('.editor-main')?.scrollTo(0, pos);
    }, scrollPos);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/fdx-scroll-${scrollPos}.png`,
    });
  }
  console.log('Screenshots saved for scroll positions 0-4800');

  await browser.close();
})();

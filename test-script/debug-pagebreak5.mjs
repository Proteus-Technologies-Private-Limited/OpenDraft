import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Scroll to first page break area and screenshot
  await page.evaluate(() => {
    const main = document.querySelector('.editor-main');
    if (main) main.scrollTop = 700; // Scroll to near page break 1
  });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/pagebreak1.png',
  });
  console.log('Page break 1 screenshot saved');

  // Scroll to second page break area
  await page.evaluate(() => {
    const main = document.querySelector('.editor-main');
    if (main) main.scrollTop = 1800;
  });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/pagebreak2.png',
  });
  console.log('Page break 2 screenshot saved');

  // Full page screenshot
  await page.evaluate(() => {
    const main = document.querySelector('.editor-main');
    if (main) main.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: '/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/fullpage.png',
    fullPage: true
  });
  console.log('Full page screenshot saved');

  await browser.close();
})();

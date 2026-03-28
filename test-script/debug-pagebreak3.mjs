import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture all console output from the page
  page.on('console', msg => console.log(`[BROWSER ${msg.type()}]`, msg.text()));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Inject a manual test: simulate what updateOverlays should do
  const result = await page.evaluate(() => {
    const log = [];

    const pageEl = document.querySelector('.page');
    if (!pageEl) { log.push('ERROR: no .page'); return log; }

    const editorRoot = pageEl.querySelector('.tiptap');
    if (!editorRoot) { log.push('ERROR: no .tiptap'); return log; }

    const blockEls = Array.from(editorRoot.children).filter(
      el => el.nodeType === Node.ELEMENT_NODE
    );
    log.push(`Block elements: ${blockEls.length}`);

    // Try to set margin on element 20
    const el20 = blockEls[20];
    if (!el20) { log.push('ERROR: no element at index 20'); return log; }

    log.push(`Element 20: ${el20.className}, text="${el20.textContent?.substring(0,30)}"`);

    // Set margin
    el20.style.marginTop = '500px';
    log.push(`Set marginTop=500px on element 20`);
    log.push(`Verify: el20.style.marginTop = "${el20.style.marginTop}"`);
    log.push(`Computed: ${getComputedStyle(el20).marginTop}`);

    // Check page-sep overlays
    const seps = document.querySelectorAll('.page-sep');
    log.push(`page-sep count: ${seps.length}`);
    seps.forEach((s, i) => {
      log.push(`  sep[${i}] style="${s.getAttribute('style')}"`);
    });

    // Measure positions after margin
    const pageRect = pageEl.getBoundingClientRect();
    const elRect = el20.getBoundingClientRect();
    log.push(`pageRect.top=${pageRect.top}, elRect.top=${elRect.top}`);
    log.push(`elRect.top - pageRect.top = ${elRect.top - pageRect.top}`);
    log.push(`Overlay should be at: ${elRect.top - pageRect.top - 243}`);

    return log;
  });

  console.log('\n=== Manual Margin Injection Test ===');
  result.forEach(l => console.log(l));

  // Take screenshot after manual margin injection
  await page.screenshot({
    path: '/Users/kandarpbaghar/ai-projects/OpenDraft/test-script/output/debug-after-margin.png',
    fullPage: true
  });
  console.log('\nScreenshot saved');

  await browser.close();
})();

import { chromium } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';

(async () => {
  // 1. Extract first content line of each PDF page (pages 3-17 = content pages 1-15)
  console.log('=== PDF Page Starts (Final Draft) ===');
  const pdfStarts = [];
  for (let p = 3; p <= 17; p++) {
    const text = execSync(
      `pdftotext -f ${p} -l ${p} -layout test-doc.pdf -`,
      { encoding: 'utf8' }
    );
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    // Skip page number line (contains only digits and dots)
    const firstContent = lines.find(l => !/^\s*\d+\.\s*$/.test(l)) || '';
    pdfStarts.push({ pdfPage: p, contentPage: p - 2, first: firstContent.trim().substring(0, 70) });
  }
  pdfStarts.forEach(s => console.log(`  Content page ${s.contentPage}: "${s.first}"`));

  // 2. Open app and import FDX
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  await page.locator('.menu-item').filter({ hasText: 'File' }).click();
  await page.waitForTimeout(300);
  const fcPromise = page.waitForEvent('filechooser');
  await page.locator('.menu-dropdown-item').filter({ hasText: /Import/i }).first().click();
  const fc = await fcPromise;
  await fc.setFiles(path.resolve('test-doc.fdx'));
  await page.waitForTimeout(3000);

  // 3. Get our app's break info
  const appBreaks = await page.evaluate(() => {
    const root = document.querySelector('.tiptap');
    if (!root) return [];
    const children = Array.from(root.children);
    const breaks = [{ pageNum: 1, firstText: children[0]?.textContent?.substring(0, 70) || '' }];
    children.forEach((el, i) => {
      const mt = parseFloat(el.style?.marginTop);
      if (mt > 100) {
        breaks.push({
          pageNum: breaks.length + 1,
          firstText: el.textContent?.substring(0, 70) || '',
          nodeIndex: i,
          marginTop: Math.round(mt),
        });
      }
    });
    return breaks.slice(0, 15);
  });

  console.log('\n=== OpenDraft Page Starts ===');
  appBreaks.forEach(b => console.log(`  Page ${b.pageNum}: "${b.firstText}"${b.marginTop ? ` (margin: ${b.marginTop}px)` : ''}`));

  // 4. Compare
  console.log('\n=== Comparison (first 15 pages) ===');
  console.log('Page | PDF Start | App Start | Match?');
  console.log('-----|-----------|-----------|-------');
  for (let i = 0; i < 15; i++) {
    const pdf = pdfStarts[i]?.first || '(n/a)';
    const app = appBreaks[i]?.firstText || '(n/a)';
    const pdfShort = pdf.substring(0, 45);
    const appShort = app.substring(0, 45);
    const match = pdfShort.toLowerCase().includes(appShort.substring(0, 20).toLowerCase()) ||
                  appShort.toLowerCase().includes(pdfShort.substring(0, 20).toLowerCase());
    console.log(`  ${String(i+1).padStart(2)}  | ${pdfShort.padEnd(45)} | ${appShort.padEnd(45)} | ${match ? 'YES' : '*** NO ***'}`);
  }

  await browser.close();
})();

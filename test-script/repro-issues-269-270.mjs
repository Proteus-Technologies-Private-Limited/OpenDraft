/**
 * Issues #269 (Polish letters change font in the PDF) and #270 (font size is
 * ignored by pagination and by the PDF), reproduced against the RUNNING app.
 *
 * Usage:  node test-script/repro-issues-269-270.mjs <before|after>
 * Needs the dev server on :5173 and puppeteer-core in /tmp/od-pw
 * (kept outside the repo so package.json is untouched).
 * Writes screenshots and PDFs to test-script/output/issues-269-270/<label>-*.
 */
import puppeteer from '/tmp/od-pw/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { mkdirSync, readdirSync, renameSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = process.argv[2] || 'before';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'output', 'issues-269-270');
mkdirSync(OUT, { recursive: true });
const DL = join(OUT, `.dl-${label}`);
rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
});
const t = await b.newPage();
await t.setViewport({ width: 1500, height: 1100 });
t.on('console', (m) => { if (m.type() === 'error') console.log('[page error]', m.text()); });
t.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await t.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

const ED = `(()=>{let el=document.querySelector('.tiptap');while(el){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));if(k){let f=el[k];while(f){const p=f.memoizedProps;if(p&&p.editor&&p.editor.commands&&p.editor.state)return p.editor;f=f.return;}}el=el.parentElement;}return null;})()`;

const txt = (text, size) => ({
  type: 'text', text,
  ...(size ? { marks: [{ type: 'textStyle', attrs: { fontSize: `${size}pt` } }] } : {}),
});
const PL = 'Zażółć gęślą jaźń, a potem łódź płynęła przez Kraków, Gdańsk i Wrocław.';
function doc({ size, polish }) {
  const content = [];
  for (let i = 1; i <= 26; i++) {
    content.push({ type: 'sceneHeading', content: [txt(polish ? `INT. POKÓJ ${i} - DZIEŃ` : `INT. ROOM ${i} - DAY`, size)] });
    content.push({ type: 'action', content: [txt(polish
      ? `${PL} Maria patrzy w okno, a wiatr szarpie zasłonami przez całą noc.`
      : 'Maria looks out of the window while the wind tugs at the curtains all night long.', size)] });
    content.push({ type: 'character', content: [txt('MARIA', size)] });
    content.push({ type: 'dialogue', content: [txt(polish ? PL : 'We should leave before the storm gets any worse than this.', size)] });
  }
  return { type: 'doc', content };
}

/** The welcome dialog covers the page on a fresh profile. */
async function dismissWelcome() {
  // A real mouse click on the "Blank Document" card, as a person would.
  const pt = await t.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Blank Document');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (pt) { await t.mouse.click(pt.x, pt.y); await sleep(1200); }
}

/** What the reporter did: Select All, then pick a size in the toolbar. */
async function chooseSizeForWholeScript(size) {
  await t.evaluate(`(()=>{const ed=${ED};ed.commands.focus();ed.commands.selectAll();})()`);
  await sleep(300);
  await t.click('.font-size-selector');
  await sleep(400);
  const ok = await t.evaluate((size) => {
    const o = [...document.querySelectorAll('.od-select-option')].find((e) => parseInt((e.textContent || '').trim(), 10) === size && /pt/.test(e.textContent || ''));
    if (o) { o.click(); return true; }
    return false;
  }, size);
  if (!ok) throw new Error(`size ${size}pt not found in the toolbar list`);
  await sleep(2500);
  await t.evaluate(`(()=>{const ed=${ED};ed.commands.setTextSelection(1);ed.commands.scrollIntoView();})()`);
  await sleep(500);
}

async function load(spec) {
  await t.evaluate(`(()=>{${ED}.commands.setContent(${JSON.stringify(doc(spec))},true);})()`);
  await sleep(2500);
}
/** The page count the status bar shows ("Page 1 of 5"). */
const pages = () => t.evaluate(() => {
  const m = (document.body.innerText || '').match(/Page \d+ of (\d+)/);
  return m ? Number(m[1]) : null;
});

async function exportPdf(name) {
  for (const f of readdirSync(DL)) rmSync(join(DL, f));
  // File -> Export -> PDF through the real menu.
  await t.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'File');
    (el.closest('button,div[class*=menu-item]') || el).click();
  });
  await sleep(600);
  await t.evaluate(() => {
    const el = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0).find((e) => /^Export/.test((e.textContent || '').trim()));
    (el.closest('div[class*=menu-dropdown-item],button,li') || el).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    (el.closest('div[class*=menu-dropdown-item],button,li') || el).click();
  });
  await sleep(600);
  await t.evaluate(() => {
    const el = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0).find((e) => /^PDF/.test((e.textContent || '').trim()));
    (el.closest('div[class*=menu-dropdown-item],button,li') || el).click();
  });
  await sleep(800);
  // An options dialog may follow.
  await t.screenshot({ path: join(OUT, `${label}-${name}-export-dialog.png`) });
  await t.evaluate(() => {
    const a = [...document.querySelectorAll('button')].find((x) => /^(Export|Save|Download|OK)( PDF)?$/i.test((x.textContent || '').trim()));
    if (a) a.click();
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const f = readdirSync(DL).find((x) => x.endsWith('.pdf'));
    if (f) { const dest = join(OUT, `${label}-${name}.pdf`); renameSync(join(DL, f), dest); return dest; }
  }
  throw new Error('no PDF was downloaded');
}

function raster(pdf, name) {
  execSync(`pdftoppm -png -r 80 -f 1 -l 2 "${pdf}" "${join(OUT, `${label}-${name}-pdf`)}"`);
  console.log(name, 'fonts:\n' + execSync(`pdffonts "${pdf}"`).toString());
  console.log(name, 'pages:', execSync(`pdfinfo "${pdf}" | grep Pages`).toString().trim());
}

await t.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
await t.waitForSelector('.tiptap', { timeout: 30000 }); await sleep(2500);
await dismissWelcome();

// ---- #269: Polish text at the default size
await load({ polish: true });
console.log('#269 editor pages:', await pages());
await t.screenshot({ path: join(OUT, `${label}-269-editor.png`) });
raster(await exportPdf('269-polish'), '269-polish');

// ---- #270: the same English script at 12, 8 and 18 pt
for (const size of [12, 8, 18]) {
  await load({});
  if (size !== 12) await chooseSizeForWholeScript(size);
  const n = await pages();
  console.log(`#270 ${size}pt editor pages:`, n);
  await t.screenshot({ path: join(OUT, `${label}-270-${size}pt-editor.png`) });
  raster(await exportPdf(`270-${size}pt`), `270-${size}pt`);
}
await b.close();

/**
 * Issue #269, with the reporter's own Polish script, against the RUNNING app:
 * select all -> font family (default / Courier New / Arial) -> File > Export > PDF
 * -> which fonts the PDF embeds and how page 1 looks.
 *
 * Usage:  node test-script/repro-issue-269-reporter.mjs
 * Needs the dev server on :5173 and puppeteer-core in /tmp/od-pw.
 * Uses a fresh headless profile, so the user's own browser data is untouched.
 * Output: test-script/output/issue-269-reporter/
 */
import puppeteer from '/tmp/od-pw/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'output', 'issue-269-reporter');
mkdirSync(OUT, { recursive: true });
const DL = join(OUT, '.dl');
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

const txt = (text) => ({ type: 'text', text });
const SCENES = [
  ['WN. POKÓJ SCENARZYSTY - NOC', [
    'Scenarzysta z zapałem wystukuje na klawiaturze laptopa kolejne literki układające się w słowa na ekranie.',
    'Okazuje się, że to scenariusz w programie... OpenDraft. Eleganckie tryb nocny pozwala nam się skupić na białej kartce papieru, na której przybywa słów.',
    'Scenarzysta jest w prawdziwym szale twórczym. Zadowolony z siebie, podniecony procesem.'], 'CIĘCIE DO --'],
  ['WN. POKÓJ SCENARZYSTY - ŚWIT', [
    'Na ekranie komputera pojawiaja się sakramentalne słowo "KONIEC" wieńczące dzieło scenarzysty.',
    'Scenarzysta jest zadowolony, dumny. Wzdycha wzruszony.'], 'CIĘCIE DO --'],
  ['WN. POKÓJ SCENARZYSTY - ŚWIT', [
    'BUM! -- korek od szampna wystrzeliwuje z hukiem. Szampan leje się do kieliszka. Bąbelki z złotym trunku radośnie unoszą się ku powierzchni.',
    'Scenarzysta przypieczętowuje sukces lampką szampana.',
    'Odkłada kieliszek. Na ekranie wybiera opcję: "File - Export - PDF"',
    'Przełącza na ekranie z OpenDraft na okienko windowsa -- klika dwukrotnie by otworzyć dokumet i... jest w szoku. Nie może uwierzyć...',
    'Na ekranie scenariusz wygląda jak... kupa. Gdy tylko w tekście pojawiają się polskie znaki czcionka zmienie na zupełnie inną niż courier... Co to za straszny bałagan? Przecież w Open Draft wszystko wyglądało dobrze...'], null],
];
const doc = () => {
  const content = [];
  for (let rep = 0; rep < 1; rep++) for (const [h, acts, tr] of SCENES) {
    content.push({ type: 'sceneHeading', content: [txt(h)] });
    for (const a of acts) content.push({ type: 'action', content: [txt(a)] });
    if (tr) content.push({ type: 'transition', content: [txt(tr)] });
  }
  return { type: 'doc', content };
};

async function dismissWelcome() {
  const pt = await t.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Blank Document');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (pt) { await t.mouse.click(pt.x, pt.y); await sleep(1200); }
}
// The reporter's steps: Select All, then pick the size in the toolbar.
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
  if (!ok) throw new Error(`size ${size}pt not in the toolbar list`);
  await sleep(2500);
  await t.evaluate(`(()=>{const ed=${ED};ed.commands.setTextSelection(1);ed.commands.scrollIntoView();})()`);
  await sleep(500);
}
const pages = () => t.evaluate(() => {
  const m = (document.body.innerText || '').match(/Page \d+ of (\d+)/);
  return m ? Number(m[1]) : null;
});
async function exportPdf(name) {
  for (const f of readdirSync(DL)) rmSync(join(DL, f));
  const click = (re, sel) => t.evaluate((src, sel) => {
    const re = new RegExp(src);
    const el = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0).find((e) => re.test((e.textContent || '').trim()));
    const tgt = el.closest(sel) || el;
    tgt.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); tgt.click();
  }, re, sel);
  await click('^File$', 'button,div[class*=menu-item]'); await sleep(600);
  await click('^Export', 'div[class*=menu-dropdown-item],button,li'); await sleep(600);
  await click('^PDF', 'div[class*=menu-dropdown-item],button,li'); await sleep(800);
  await t.evaluate(() => {
    const a = [...document.querySelectorAll('button')].find((x) => /^(Export|Save|Download|OK)( PDF)?$/i.test((x.textContent || '').trim()));
    if (a) a.click();
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const f = readdirSync(DL).find((x) => x.endsWith('.pdf'));
    if (f) { const dest = join(OUT, `${name}.pdf`); renameSync(join(DL, f), dest); return dest; }
  }
  throw new Error('no PDF was downloaded');
}

try {
  await t.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await t.waitForSelector('.tiptap', { timeout: 30000 }); await sleep(2500);
  await dismissWelcome();
  for (const font of ['Courier Prime', 'Courier New', 'Arial']) {
    const tag = font.replace(/ /g, '');
    await t.evaluate(`(()=>{${ED}.commands.setContent(${JSON.stringify(doc())},true);})()`);
    await sleep(2000);
    if (font !== 'Courier Prime') {
      await t.evaluate(`(()=>{const ed=${ED};ed.chain().focus().selectAll().setFontFamily(${JSON.stringify(font)}).run();ed.commands.setTextSelection(1);})()`);
      await sleep(2000);
    }
    await t.screenshot({ path: join(OUT, `${tag}-editor.png`) });
    const pdf = await exportPdf(tag);
    execSync(`pdftoppm -png -r 110 -f 1 -l 1 "${pdf}" "${join(OUT, `${tag}-pdf`)}"`);
    console.log(`--- ${font}: ${execSync(`pdfinfo "${pdf}" | grep Pages`).toString().trim()}`);
    console.log(execSync(`pdffonts "${pdf}" | grep -v Type\\ 1 | grep -v -- '---'`).toString());
  }
} catch (e) {
  console.error('FAILED:', e.message);
  await t.screenshot({ path: join(OUT, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await b.close();
}

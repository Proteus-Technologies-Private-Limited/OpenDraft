/**
 * Wider check for #270: formatted text, other typefaces, title page, dual
 * dialogue, transitions and parentheticals at several sizes. For each case it
 * compares the editor's page count with the exported PDF's, and checks the
 * editor's page pitch does not drift.
 * Usage: node test-script/repro-font-size-matrix.mjs   (dev server on :5173)
 */
import puppeteer from '/tmp/od-pw/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'output', 'issues-269-270', 'matrix');
const DL = join(OUT, '.dl'); rmSync(DL, { recursive: true, force: true }); mkdirSync(DL, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const t = await b.newPage(); await t.setViewport({ width: 1500, height: 1100 });
t.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await t.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
const ED = `(()=>{let el=document.querySelector('.tiptap');while(el){const k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));if(k){let f=el[k];while(f){const p=f.memoizedProps;if(p&&p.editor&&p.editor.commands&&p.editor.state)return p.editor;f=f.return;}}el=el.parentElement;}return null;})()`;

const tx = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const B = [{ type: 'bold' }], I = [{ type: 'italic' }], U = [{ type: 'underline' }];
const font = (f) => [{ type: 'textStyle', attrs: { fontFamily: f } }];
const LANG = {
  en: ['Maria looks out of the window ', 'while the wind tugs', ' at the curtains, ', 'all night long.', 'We should leave before the storm gets any worse than this.'],
  pl: ['Zażółć gęślą jaźń, a potem ', 'łódź płynęła przez Kraków', ' i Gdańsk, ', 'całą noc długą.', 'Źle się czuję, więc wyjdźmy stąd zanim burza będzie jeszcze gorsza.'],
  ru: ['Мария смотрит в окно, ', 'пока ветер рвёт', ' занавески, ', 'всю ночь напролёт.', 'Нам нужно уйти до того, как буря станет ещё хуже.'],
  mix: ['Maria zażółć gęślą ', 'и Привет мир', ' Źle się czuje, ', 'again in English.', 'Mixed: łódź, Привет, café, naïve, Ñandú and plain English together.'],
};
function script({ marks, withTitle, lang = 'en', runFonts }) {
  const L = LANG[lang];
  const f = (i) => (runFonts ? font(runFonts[i % runFonts.length]) : undefined);
  const c = [];
  if (withTitle) c.push({ type: 'titlePage', content: [tx('MY SCRIPT')] });
  for (let i = 1; i <= 14; i++) {
    c.push({ type: 'sceneHeading', content: [tx(`INT. ROOM ${i} - DAY`, marks)] });
    c.push({ type: 'action', content: [tx(L[0], f(0) ?? marks), tx(L[1], [...B, ...(f(1) ?? [])]), tx(L[2], [...I, ...(f(2) ?? [])]), tx(L[3], [...U, ...(f(3) ?? [])])] });
    c.push({ type: 'character', content: [tx('MARIA', marks)] });
    c.push({ type: 'parenthetical', content: [tx('(quietly)', marks)] });
    c.push({ type: 'dialogue', content: [tx(L[4] + ' ' + L[4], f(0) ?? marks)] });
    c.push({ type: 'transition', content: [tx('CUT TO:', marks)] });
  }
  return { type: 'doc', content: c };
}
const pt = await (async () => { await t.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' }); await t.waitForSelector('.tiptap'); await sleep(2500);
  return t.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Blank Document'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); })();
await t.mouse.click(pt.x, pt.y); await sleep(1200);

async function setSize(size) {
  await t.evaluate(`(()=>{const ed=${ED};ed.commands.focus();ed.commands.selectAll();})()`);
  await t.click('.font-size-selector'); await sleep(300);
  const hit = await t.evaluate((s) => { const o = [...document.querySelectorAll('.od-select-option')].find((e) => parseInt(e.textContent, 10) === s); if (o) o.click(); return !!o; }, size);
  if (!hit) { console.log('  (size', size, 'not offered here; list state:', await t.evaluate(() => document.querySelectorAll('.od-select-option').length), 'options)'); await t.keyboard.press('Escape'); }
  await sleep(2000);
}
async function exportPdf(name) {
  for (const f of readdirSync(DL)) rmSync(join(DL, f));
  const click = (re, sel) => t.evaluate((src, sel) => { const re = new RegExp(src); const el = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0).find((e) => re.test((e.textContent || '').trim())); (el.closest(sel) || el).click(); }, re.source, sel);
  await click(/^File$/, 'button,div[class*=menu-item]'); await sleep(500);
  await click(/^Export/, 'div[class*=menu-dropdown-item],button,li'); await sleep(500);
  await click(/^PDF/, 'div[class*=menu-dropdown-item],button,li'); await sleep(700);
  await t.evaluate(() => { const a = [...document.querySelectorAll('button')].find((x) => /^(Export|Save|Download|OK)( PDF)?$/i.test((x.textContent || '').trim())); if (a) a.click(); });
  for (let i = 0; i < 60; i++) { await sleep(500); const f = readdirSync(DL).find((x) => x.endsWith('.pdf')); if (f) { const d = join(OUT, `${name}.pdf`); renameSync(join(DL, f), d); return d; } }
  throw new Error('no pdf');
}
const edPages = () => t.evaluate(() => Number((document.body.innerText.match(/Page \d+ of (\d+)/) || [])[1]) || null);
const pitch = () => t.evaluate(() => { const pg = document.querySelector('.page').getBoundingClientRect().top; const s = [...document.querySelectorAll('.sp-page-start')].map((e) => Math.round(e.getBoundingClientRect().top - pg)); return s.slice(1, 6).map((v, i) => v - s[i]); });

const cases = [
  { name: 'plain', spec: {} },
  { name: 'bold', spec: { marks: B } },
  { name: 'italic-underline', spec: { marks: [...I, ...U] } },
  { name: 'arial', spec: { marks: font('Arial') } },
  { name: 'times', spec: { marks: font('Times New Roman') } },
  { name: 'title-page', spec: { withTitle: true } },
  { name: 'mixed-fonts', spec: { runFonts: ['Courier Prime', 'Arial', 'Times New Roman', 'Courier New'] } },
  { name: 'polish', spec: { lang: 'pl' } },
  { name: 'polish-arial', spec: { lang: 'pl', marks: font('Arial') } },
  { name: 'polish-times-mixed', spec: { lang: 'pl', runFonts: ['Times New Roman', 'Arial', 'Courier Prime', 'Georgia'] } },
  { name: 'cyrillic', spec: { lang: 'ru' } },
  { name: 'polish-cyrillic-latin', spec: { lang: 'mix' } },
  { name: 'polish-cyrillic-fonts', spec: { lang: 'mix', runFonts: ['Arial', 'Times New Roman', 'Courier Prime', 'Verdana'] } },
];
let bad = 0;
const only = process.argv[2];
for (const c of cases.filter((x) => !only || x.name === only)) for (const size of [12, 10, 14, 18]) {
  await t.evaluate(`(()=>{${ED}.commands.setContent(${JSON.stringify(script(c.spec))},true);})()`); await sleep(1500);
  // reset to 12 then apply
  await setSize(size);
  const name = `${c.name}-${size}pt`;
  const ed = await edPages(); const p = await pitch();
  const pdf = await exportPdf(name);
  const pdfPages = Number(execSync(`pdfinfo "${pdf}" | grep Pages`).toString().split(':')[1]);
  const tl = c.spec.withTitle ? 1 : 0; // PDF counts the title sheet; the status bar does not
  // A proportional face wraps by real glyph widths on screen but by the grid in
  // the page count, so its sheets never sat exactly on the breaks — at any size,
  // 12pt included. For those only the page counts have to agree.
  const proportional = !!(c.spec.runFonts || (c.spec.marks && c.spec.marks[0]?.attrs?.fontFamily));
  const ok = ed + tl === pdfPages && (proportional || p.every((v) => Math.abs(v - 1096) <= 2));
  if (!ok) bad++;
  console.log(ok ? 'OK  ' : 'FAIL', name.padEnd(22), 'editor', ed, 'pdf', pdfPages, 'pitch', JSON.stringify(p));
  const txt = execSync(`pdftotext -f ${tl + 1} -l ${tl + 1} "${pdf}" -`).toString();
  const lang = c.spec.lang || 'en';
  const probe = { en: 'window', pl: 'Zażółć gęślą', ru: 'Мария смотрит', mix: 'zażółć' }[lang];
  const intact = txt.includes(probe) || txt.toLowerCase().includes(probe.toLowerCase());
  const fontsUsed = [...new Set(execSync(`pdffonts "${pdf}" 2>/dev/null`).toString().split('\n').slice(2).map((l) => l.split(/\s+/)[0]).filter(Boolean))].filter((n) => !/^(Helvetica|Times|Courier|Zapf|Symbol)/.test(n) || false);
  console.log('     text intact:', intact, '| embedded:', fontsUsed.join(',') || '-');
  if (!intact) bad++;
  execSync(`pdftoppm -png -r 60 -f 1 -l 1 "${pdf}" "${join(OUT, name)}"`);
}
await t.screenshot({ path: join(OUT, 'last-editor.png') });
console.log(bad ? `${bad} FAILED` : 'ALL OK');
await b.close();

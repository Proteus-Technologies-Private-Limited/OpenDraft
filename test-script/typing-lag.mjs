/**
 * How much main-thread work each keystroke costs in a long script (issue #229).
 *
 * Loads a generated screenplay at a requested size, puts the caret in the
 * middle, types 40 characters and then holds Backspace for 40, and reports per
 * key: main-thread time (Chrome's TaskDuration), the part of it that was
 * JavaScript, and keydown-to-next-frame latency. Optionally saves a CPU profile.
 *
 * Measure a production build, not the dev server (development React costs
 * several times as much):
 *
 *   cd frontend && npx vite build --minify false --outDir /tmp/od-dist
 *   npx vite preview --outDir /tmp/od-dist --port 4173 &
 *   node test-script/typing-lag.mjs http://127.0.0.1:4173/ 150 /tmp/typing-150
 *
 * Arguments: <url> [pages=150] [outPrefix] [--no-profile]. Writes
 * <outPrefix>.json, .png and (unless --no-profile) .cpuprofile, which Chrome
 * DevTools → Performance can open. Numbers vary run to run by ±10%; compare
 * builds by alternating them.
 *
 * PAGES is a synthetic size parameter, not an assertion of the rendered page
 * count: output includes the actual renderedPages after pagination settles.
 * OPENDRAFT_CHROMIUM selects an installed browser; OPENDRAFT_BENCH_REVISION
 * records the source of the served build (the harness cannot infer it from URL).
 * Needs Node's `playwright` with a Chromium.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Through require, so a global install on NODE_PATH is found as well as a local one.
const { chromium } = createRequire(import.meta.url)('playwright');

const [, , url, pagesArg, outPrefix = 'typing-lag', flag] = process.argv;
const PAGES = Number(pagesArg || 150);
const PROFILE = flag !== '--no-profile';
if (!url || !Number.isInteger(PAGES) || PAGES < 1) {
  console.error('Usage: node typing-lag.mjs <url> [positive size=150] [outPrefix] [--no-profile]');
  process.exit(1);
}

const LOREM = 'The room is quiet except for the hum of the refrigerator and the slow tick of a clock nobody has bothered to reset since the power went out. Rain taps the glass.';
const LINE = 'I told you this was going to happen. I told you and you smiled at me like I was making it up, like it was a story I tell at parties.';
const NAMES = ['MARGARET', 'DEV', 'OFFICER KANE', 'LUCY', 'THE STRANGER', 'HOLLIS'];

function screenplay(pages) {
  // ~9 blocks per page, a mixed feature.
  const blocks = [];
  const scenes = Math.max(1, Math.round(pages / 1.6));
  const perScene = Math.round((pages * 9) / scenes);
  for (let s = 0; s < scenes; s++) {
    blocks.push({ type: 'sceneHeading', content: [{ type: 'text', text: `${s % 3 ? 'INT.' : 'EXT.'} LOCATION ${s} - ${s % 2 ? 'DAY' : 'NIGHT'}` }] });
    for (let i = 0; i < perScene; i++) {
      if (i % 4 === 0) {
        blocks.push({ type: 'action', content: [{ type: 'text', text: LOREM.slice(0, 70 + ((i * 37 + s) % 90)) }] });
      } else {
        blocks.push({ type: 'character', content: [{ type: 'text', text: NAMES[(i + s) % NAMES.length] }] });
        if (i % 5 === 2) blocks.push({ type: 'parenthetical', content: [{ type: 'text', text: '(quietly)' }] });
        blocks.push({ type: 'dialogue', content: [{ type: 'text', text: LINE.slice(0, 40 + ((i * 13 + s) % 90)) }] });
      }
    }
    if (s % 6 === 5) blocks.push({ type: 'transition', content: [{ type: 'text', text: 'CUT TO:' }] });
  }
  return { type: 'doc', content: blocks };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.OPENDRAFT_CHROMIUM || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      localStorage.setItem('opendraft:viewState', JSON.stringify({navigatorOpen:true,toolbarMode:'compact'}));
      localStorage.setItem('opendraft:hiddenModeIntroShown', '1');
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.editor-main').waitFor({ timeout: 60000 });
    const blank = page.getByRole('button', { name: 'Blank Document', exact: false });
    if (await blank.count()) await blank.first().click();
    await page.locator('.ProseMirror').waitFor();
    await sleep(1500);
    // Dismiss any first-run dialog.
    await page.keyboard.press('Escape');

    const doc = screenplay(PAGES);
    const info = await page.evaluate(doc => {
      const editor = document.querySelector('.ProseMirror').editor;
      editor.commands.setContent(doc, true);
      return { blocks: editor.state.doc.childCount, size: editor.state.doc.content.size };
    }, doc);
    await sleep(6000); // let pagination, spellcheck etc. settle

    // Caret at the end of a dialogue block in the middle of the script.
    const where = await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror').editor;
      const d = editor.state.doc;
      let target = null, idx = 0; const mid = Math.floor(d.childCount / 2);
      d.forEach((node, offset) => { if (!target && idx >= mid && node.type.name === 'dialogue') target = offset + node.nodeSize - 1; idx++; });
      editor.chain().focus().setTextSelection(target).scrollIntoView().run();
      const renderedPages = document.querySelectorAll('.page-sep').length + 1;
      return { target, renderedPages };
    });
    await sleep(1500);

    await page.evaluate(() => {
      window.__lat = [];
      document.addEventListener('keydown', e => {
        const t = e.timeStamp;
        requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t), 0));
      }, true);
    });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    if (PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }

    const documentSize = () => page.evaluate(() => document.querySelector('.ProseMirror').editor.state.doc.content.size);
    const phase = async (name, fn, expectedDelta) => {
      await page.evaluate(() => { window.__lat = []; });
      const sizeBefore = await documentSize();
      const m0 = await metrics(); const t0 = Date.now();
      await fn();
      await sleep(1500); // trailing debounced work
      const m1 = await metrics(); const wall = Date.now() - t0;
      const lat = await page.evaluate(() => window.__lat.slice().sort((a, b) => a - b));
      const d = k => +(m1[k] - m0[k]).toFixed(3);
      const documentDelta = await documentSize() - sizeBefore;
      if (lat.length !== 40 || documentDelta !== expectedDelta) {
        throw new Error(`${name}: expected 40 editor keys and size change ${expectedDelta}, got ${lat.length} and ${documentDelta}`);
      }
      return {
        name, wallMs: wall, keys: lat.length, documentDelta,
        latencyMs: { median: +lat[Math.floor(lat.length / 2)]?.toFixed(1), p90: +lat[Math.floor(lat.length * 0.9)]?.toFixed(1), max: +lat[lat.length - 1]?.toFixed(1) },
        mainThreadSec: { task: d('TaskDuration'), script: d('ScriptDuration'), layout: d('LayoutDuration'), style: d('RecalcStyleDuration') },
        layoutCount: d('LayoutCount'), styleCount: d('RecalcStyleCount'),
      };
    };

    const results = [];
    results.push(await phase('type 40 chars @60ms', () => page.keyboard.type('and then she walked out the door forever', { delay: 60 }), 40));
    results.push(await phase('Backspace x40 @33ms', async () => { for (let i = 0; i < 40; i++) { await page.keyboard.press('Backspace'); await sleep(33); } }, -40));

    if (PROFILE) {
      const { profile } = await cdp.send('Profiler.stop');
      fs.writeFileSync(`${outPrefix}.cpuprofile`, JSON.stringify(profile));
    }
    await page.screenshot({ path: `${outPrefix}.png` });
    const out = { requestedSize: PAGES, profiling: PROFILE, sourceRevision: process.env.OPENDRAFT_BENCH_REVISION || null, browser: browser.version(), ...info, where, results, errors: errors.slice(0, 5) };
    fs.writeFileSync(`${outPrefix}.json`, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (errors.length) throw new Error(`Browser errors during benchmark: ${errors.join('; ')}`);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });

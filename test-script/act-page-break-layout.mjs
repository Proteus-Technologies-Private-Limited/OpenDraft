/**
 * Reproduces the "inserting an act pulls the next act back onto this page" glitch
 * at the CSS layout level, using the app's real stylesheet.
 *
 * The pagination model is already proven correct by unit tests: both acts get a
 * margin-top decoration, and the values are identical whether the inserted act
 * is empty or has text. So the only way the rendered result can differ is CSS.
 * This script measures the gap the browser actually produces for each case, and
 * re-measures with the candidate fix applied.
 *
 * Usage:  node test-script/act-page-break-layout.mjs [baseUrl]
 * Needs the app served (default http://localhost:8008) and puppeteer-core in
 * /tmp/od-pw (kept outside the repo so package.json is untouched).
 */

import puppeteer from '/tmp/od-pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const BASE = process.argv[2] || 'http://localhost:8008';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Margins the pagination plugin emits for this scenario (see pagination.ts). */
const FIRST_BREAK_MARGIN = 224;   // fills the remainder of the previous page
const SECOND_BREAK_MARGIN = 1080; // (linesPerPage - 1) * 16 + separator
/** One page of content plus the separator band — what the next act must clear. */
const PAGE_PITCH = 864 + 232;

/** The fix under test: an empty element still occupies its line, so it cannot
 *  self-collapse and swallow the neighbouring page-break margin. */
const CANDIDATE_FIX = `.screenplay-element { min-height: 1em; }`;

const CASES = [
  ['empty, no trailing <br>', ''],
  ['empty, ProseMirror trailing <br>', '<br class="ProseMirror-trailingBreak">'],
  ['text typed in', 'ACT THREE'],
];

function caseMarkup([label, inner], i) {
  return `<div class="page" style="width:8.5in;padding:72pt 1in">
  <div class="tiptap screenplay-content">
    <div class="screenplay-element action" id="a${i}">Opening action.</div>
    <div class="screenplay-element new-act" id="b${i}" style="margin-top: ${FIRST_BREAK_MARGIN}px !important">${inner}</div>
    <div class="screenplay-element new-act" id="c${i}" style="margin-top: ${SECOND_BREAK_MARGIN}px !important">ACT TWO</div>
  </div>
</div><!-- ${label} -->`;
}

const measure = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = document.getElementById(`b${i}`).getBoundingClientRect();
    const c = document.getElementById(`c${i}`).getBoundingClientRect();
    out.push({
      height: Math.round(b.height),
      // How far the next act sits below the top of the inserted one. It must
      // clear a whole page pitch to land on the following page.
      advance: Math.round(c.top - b.top),
    });
  }
  return out;
};

function report(title, rows) {
  console.log(`\n${title}`);
  let bad = 0;
  rows.forEach((m, i) => {
    const onNextPage = m.advance >= PAGE_PITCH;
    if (!onNextPage) bad++;
    console.log(
      `  ${onNextPage ? 'ok       ' : 'PULLED UP'}  ${CASES[i][0].padEnd(34)}` +
      `height=${String(m.height).padStart(3)}px  ` +
      `next act sits ${String(m.advance).padStart(5)}px below (needs >= ${PAGE_PITCH})`,
    );
  });
  return bad;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  const html = await fetch(`${BASE}/`).then((r) => r.text());
  const cssPath = /assets\/index-[A-Za-z0-9_-]+\.css/.exec(html)?.[0];
  if (!cssPath) throw new Error('could not find the built stylesheet on the page');
  const css = await fetch(`${BASE}/${cssPath}`).then((r) => r.text());

  const tab = await browser.newPage();
  await tab.setViewport({ width: 1400, height: 1000 });
  // Inline the stylesheet — no network fetch, so no flakey load waits.
  await tab.setContent(
    `<!doctype html><html><head><style>${css}</style><style id="fix"></style></head>` +
    `<body>${CASES.map(caseMarkup).join('')}</body></html>`,
  );

  console.log(`stylesheet: ${cssPath}  (${(css.length / 1024).toFixed(0)} kB)`);
  const before = report('BEFORE — current CSS', await tab.evaluate(measure, CASES.length));

  await tab.evaluate((fix) => { document.getElementById('fix').textContent = fix; }, CANDIDATE_FIX);
  const after = report(`AFTER — with \`${CANDIDATE_FIX}\``, await tab.evaluate(measure, CASES.length));

  console.log(
    `\n${before} of ${CASES.length} cases broken before, ${after} after.` +
    (before > 0 && after === 0 ? '  Fix confirmed.' : ''),
  );
  process.exitCode = after === 0 ? 0 : 1;
} finally {
  await browser.close();
}

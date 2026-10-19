#!/usr/bin/env node
// Issue #156: pinch-zooming must keep the writer's place in the script.
//
//   node test-script/android-pinch-zoom-156.mjs [adb-serial]
//
// Drives real two-finger pinches into OpenDraft's WebView on a running
// emulator (debug APK) over CDP — Input.dispatchTouchEvent, so the app's own
// touch handlers see them exactly as they would a finger. Before and after each
// pinch it reads the text under the pinch point and the status bar's page, and
// fails if the line under the fingers moved more than a line's height.
//
// Scroll the open script somewhere well past page 1 first; the test zooms from
// wherever it is.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const serial = process.argv[2] || 'emulator-5556';
const PORT = 9334;
const adb = `${homedir()}/Library/Android/sdk/platform-tools/adb`;

let ws;
let nextId = 1;
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`Timed out on ${method}`)), 15000);
    const onMsg = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMsg);
      if (msg.error) rej(new Error(`${method}: ${msg.error.message}`));
      else res(msg.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`Page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** What sits under (x, y): the editor block, how far into it, and the page. */
const probe = (x, y) => evaluate(`(() => {
  const root = document.querySelector('.ProseMirror');
  const main = document.querySelector('.editor-main');
  if (!root || !main) return { error: 'editor not found' };
  const kids = [...root.children];
  // The block under the point, or the nearest one when it falls in the gap
  // between two — the same block the app anchors to.
  let i = -1, best = Infinity;
  kids.forEach((k, j) => {
    const r = k.getBoundingClientRect();
    const d = ${y} < r.top ? r.top - ${y} : ${y} > r.bottom ? ${y} - r.bottom : 0;
    if (d < best) { best = d; i = j; }
  });
  const el = kids[i];
  const r = el ? el.getBoundingClientRect() : null;
  return {
    index: i,
    text: el ? el.textContent.slice(0, 50) : null,
    // Clamped to the block, as the anchor's fraction is.
    yInBlock: r ? Math.min(r.height, Math.max(0, ${y} - r.top)) : null,
    blockHeight: r ? r.height : null,
    page: document.querySelector('.status-page')?.textContent?.trim() ?? null,
    // The page the screen is really on, read off the phone view's dividers the
    // way the status bar counts it: the last one above the top of the screen.
    truePage: document.querySelector('.page.phone-view')
      ? ([...document.querySelectorAll('.phone-page-break')]
          .filter((b) => b.getBoundingClientRect().top - main.getBoundingClientRect().top < 50)
          .map((b) => b.textContent.trim().replace(/^Page /, ''))
          .at(-1) ?? '1')
      : null,
    scrollTop: Math.round(main.scrollTop),
    zoom: document.querySelector('.zoom-level, .status-zoom')?.textContent?.trim() ?? null,
  };
})()`);

/** Two fingers centred on (cx, cy), moving from `from` px apart to `to` px apart. */
async function pinch(cx, cy, from, to, steps = 12) {
  const pts = (d) => [
    { x: cx - d / 2, y: cy, id: 0 },
    { x: cx + d / 2, y: cy, id: 1 },
  ];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let s = 1; s <= steps; s++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * s) / steps) });
    await wait(30);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(800); // past the anchor's hold, after any remeasure
}

try {
  const sockets = execFileSync(adb, ['-s', serial, 'shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' })
    .match(/webview_devtools_remote_\d+/g);
  if (!sockets) throw new Error('No debuggable WebView found — is the debug APK running?');
  execFileSync(adb, ['-s', serial, 'forward', `tcp:${PORT}`, `localabstract:${sockets.at(-1)}`]);
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error(`No page target among ${pages.length} targets`);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket connect failed')); });

  const box = await evaluate(`(() => { const r = document.querySelector('.editor-main').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  // Off-centre on purpose: a fix that only held the middle of the screen, or
  // the top, would still drift here.
  const cx = Math.round(box.left + box.width / 2);
  const cy = Math.round(box.top + box.height * 0.35);

  const gestures = [
    ['zoom in', 120, 360],
    ['zoom in more', 120, 360],
    ['zoom out', 360, 120],
    ['zoom out more', 360, 120],
    ['zoom out further', 360, 120],
  ];
  let failed = 0;
  let before = await probe(cx, cy);
  console.log('start      ', JSON.stringify(before));
  for (const [label, from, to] of gestures) {
    await pinch(cx, cy, from, to);
    const after = await probe(cx, cy);
    // Same block under the fingers, at the same fraction of it.
    const fracBefore = before.yInBlock / before.blockHeight;
    const drift = after.index === before.index
      ? Math.abs(after.yInBlock - fracBefore * after.blockHeight)
      : Infinity;
    const placeOk = drift <= Math.max(24, after.blockHeight * 0.1);
    // The status bar must name the page actually on screen.
    const pageOk = after.truePage === null || after.page?.startsWith(`Page ${after.truePage} `);
    if (!placeOk || !pageOk) failed++;
    console.log(`${label.padEnd(17)} ${placeOk && pageOk ? 'PASS' : 'FAIL'} drift=${drift === Infinity ? 'other block' : drift.toFixed(1) + 'px'}${pageOk ? '' : ` status bar says "${after.page}", screen is on page ${after.truePage}`}`, JSON.stringify(after));
    before = after;
  }
  ws.close();
  if (failed) { console.error(`${failed} pinch(es) lost the writer's place`); process.exit(1); }
  console.log('All pinches kept the line under the fingers.');
} catch (err) {
  console.error(`android-pinch-zoom-156: ${err.message}`);
  process.exit(1);
}

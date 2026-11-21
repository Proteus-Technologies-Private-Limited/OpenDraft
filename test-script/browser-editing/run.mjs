/** Production browser editing with a real saved project and backend. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { screenplay } from '../../frontend/src/test/fixtures/longScreenplay.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const [url, revision, output, authPath, size = '150', profile = 'off', layout = 'page', nav = 'on', spell = 'on'] = process.argv.slice(2);
if (!url || !revision || !output || !authPath || !['short', '150'].includes(size)) {
  throw new Error('Usage: run.mjs URL REVISION OUTPUT AUTH_JSON [short|150] [off|profile] [page|speed] [on|off navigator] [on|off spellcheck]');
}
if (!['off', 'profile'].includes(profile) || !['page', 'speed'].includes(layout) || ![nav, spell].every(value => ['on', 'off'].includes(value))) throw new Error('Invalid benchmark option');
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Synthetic benchmark requires a loopback frontend');
const api = 'http://127.0.0.1:8137/api';
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
if (auth.user?.id !== 'browser-bench' || auth.user?.email !== 'browser-bench@example.invalid') throw new Error('Use only the isolated fixture server credentials');
const html = await (await fetch(url)).text();
const bundlePath = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
if (!bundlePath?.startsWith('/assets/')) throw new Error('Use a production preview build');
const bundleHash = crypto.createHash('sha256').update(Buffer.from(await (await fetch(new URL(bundlePath, url))).arrayBuffer())).digest('hex');
const apiRequest = async (path, data) => {
  const r = await fetch(api + path, {
    method: data ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + auth.accessToken, 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok) throw new Error(`Fixture API ${r.status}: ${await r.text()}`);
  return r.json();
};
const doc = screenplay(size === '150' ? 184 : 12);
if (size === '150') doc.content.splice(-14);
Object.assign(doc, { _sceneHeadingSpaceBefore: null, _templateId: 'screenplay', _spellCheckEnabled: spell === 'on', _grammarCheckEnabled: false, _enabledGlobalDicts: [], _enabledLanguages: ['en_US'] });
const fixtureHash = crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');
const project = await apiRequest('/projects/', { name: 'Synthetic browser benchmark ' + crypto.randomUUID() });
const script = await apiRequest(`/projects/${project.id}/scripts/`, { title: `Synthetic ${size}-page screenplay`, content: doc });
const sid = script.meta.id;
const browser = await chromium.launch({ executablePath: process.env.OPENDRAFT_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(({ auth, api, layout, nav }) => {
  localStorage.setItem('opendraft:collabAuth', JSON.stringify(auth));
  localStorage.setItem('opendraft:cloudApiUrl', api);
  localStorage.setItem('opendraft:collabServerUrl', 'ws://127.0.0.1:8137');
  localStorage.setItem('opendraft:autoSaveIntervalSeconds', '5');
  localStorage.setItem('opendraft:autoSaveLibrary', '1');
  localStorage.setItem('opendraft:viewState', JSON.stringify({ navigatorOpen: nav === 'on', toolbarMode: 'compact', viewLayout: layout, zoomLevel: 100, speedZoomLevel: 100 }));
  localStorage.setItem('opendraft:hiddenModeIntroShown', '1');
  window.bench = { phase: 'setup', keys: [], recovery: [], saves: [], longTasks: [] };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    const start = performance.now();
    const result = set.call(this, key, value);
    if (key.startsWith('opendraft:recovery')) window.bench.recovery.push({ phase: window.bench.phase, ms: performance.now() - start, bytes: value.length, at: performance.now() });
    return result;
  };
  const fetchOriginal = window.fetch;
  window.fetch = async function (input, options) {
    const start = performance.now();
    const response = await fetchOriginal.call(this, input, options);
    if (options?.method === 'PUT' && String(input).includes('/scripts/')) window.bench.saves.push({ phase: window.bench.phase, ms: performance.now() - start, status: response.status, bytes: options.body?.length ?? 0, at: performance.now() });
    return response;
  };
  document.addEventListener('keydown', event => {
    if (!['typing', 'backspace'].includes(window.bench.phase)) return;
    const phase = window.bench.phase, start = event.timeStamp, key = event.key, repeat = event.repeat;
    requestAnimationFrame(() => setTimeout(() => window.bench.keys.push({ phase, key, repeat, ms: performance.now() - start }), 0));
  }, true);
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) window.bench.longTasks.push({ phase: window.bench.phase, ms: entry.duration });
  }).observe({ type: 'longtask', buffered: false });
}, { auth, api, layout, nav });
try {
  await page.goto(`${url}/project/${project.id}/edit/${sid}`);
  await page.locator('.ProseMirror').waitFor();
  await page.waitForFunction(() => document.querySelector('.ProseMirror').editor.state.doc.childCount > 100);
  await page.waitForTimeout(6500);
  const initial = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror').editor;
    let target = null, index = 0;
    editor.state.doc.forEach((node, offset) => { if (target === null && index >= editor.state.doc.childCount / 2 && node.type.name === 'dialogue') target = offset + node.nodeSize - 1; index++; });
    editor.chain().focus().setTextSelection(target).scrollIntoView().run();
    window.bench.before = editor.state.doc;
    return { target, pages: editor.state.plugins.find(plugin => plugin.key.startsWith('pagination')).getState(editor.state).pageCount, renderedPageGaps: document.querySelectorAll('.page-sep-gap').length, blocks: editor.state.doc.childCount, docSize: editor.state.doc.content.size, sceneCount: document.querySelector('.scene-count')?.textContent, spellMarks: document.querySelectorAll('.spell-error').length, pageClass: document.querySelector('.page')?.className, navigatorVisible: !!document.querySelector('.scene-navigator') && document.querySelector('.scene-navigator').getBoundingClientRect().width > 0, editorClass: document.querySelector('.ProseMirror').className, docJSON: JSON.stringify(editor.getJSON()) };
  });
  if (size === '150' && initial.pages !== 150) { console.error(JSON.stringify({ ...initial, docJSON: undefined })); throw new Error(`Expected measured ${size} pages, got ${initial.pages}`); }
  if (initial.pageClass?.includes('speed-view') !== (layout === 'speed')) throw new Error('Wrong layout active');
  if (initial.navigatorVisible !== (nav === 'on')) throw new Error('Wrong Navigator state');
  if (spell === 'off' && initial.spellMarks) throw new Error('Spellcheck stayed enabled');
  if (spell === 'on' && !initial.spellMarks) throw new Error('Spellcheck did not activate');
  if (await page.locator('.spell-error').filter({ hasText: /^the$/ }).count()) throw new Error('English dictionary is not working');
  await page.waitForTimeout(700);
  await page.locator('.ProseMirror').focus();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  if (profile === 'profile') {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.start');
  }
  const phases = [];
  const measure = async (name, operation) => {
    await page.evaluate(name => { window.bench.phase = name; }, name);
    const docBefore = await page.evaluate(() => document.querySelector('.ProseMirror').editor.state.doc.content.size);
    const before = await metrics(), start = performance.now();
    await operation();
    await page.waitForTimeout(1500);
    const after = await metrics();
    const docAfter = await page.evaluate(() => document.querySelector('.ProseMirror').editor.state.doc.content.size);
    if (docAfter - docBefore !== (name === 'typing' ? 120 : -120)) {
      await page.screenshot({ path: output + '-failed.png' });
      console.error(await page.evaluate(() => ({ visibleText: document.body.innerText.slice(-1200), inert: document.querySelector('.ProseMirror')?.closest('[inert]')?.className, active: document.activeElement?.outerHTML.slice(0, 180), editable: document.querySelector('.ProseMirror').editor.isEditable })));
      throw new Error(`${name}: wrong document change ${docAfter - docBefore}`);
    }
    const keys = await page.evaluate(name => window.bench.keys.filter(x => x.phase === name), name);
    if (keys.length !== 120) throw new Error(`${name}: expected 120 key events, got ${keys.length}`);
    const times = keys.map(x => x.ms).sort((a, b) => a - b);
    phases.push({ name, docDelta: docAfter - docBefore, keys: keys.length, repeated: keys.filter(x => x.repeat).length, wallMs: performance.now() - start, latencyMs: { median: times[60], p95: times[114], max: times.at(-1) }, mainThreadMs: Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(k => [k, (after[k] - before[k]) * 1000])), counts: { layout: after.LayoutCount - before.LayoutCount, style: after.RecalcStyleCount - before.RecalcStyleCount } });
  };
  const text = 'the room stays quiet while she waits and '.repeat(3).slice(0, 120);
  await measure('typing', () => page.keyboard.type(text, { delay: 50 }));
  await measure('backspace', async () => {
    for (let i = 0; i < 120; i++) { await page.keyboard.down('Backspace'); await page.waitForTimeout(33); }
    await page.keyboard.up('Backspace');
  });
  await page.evaluate(() => { window.bench.phase = 'settle'; });
  await page.waitForTimeout(6000);
  if (profile === 'profile') {
    const result = await cdp.send('Profiler.stop');
    fs.writeFileSync(output + '.cpuprofile', JSON.stringify(result.profile));
  }
  const final = await page.evaluate(() => ({ ...window.bench, before: undefined, sameDoc: document.querySelector('.ProseMirror').editor.state.doc.eq(window.bench.before), docJSON: JSON.stringify(document.querySelector('.ProseMirror').editor.getJSON()), selection: document.querySelector('.ProseMirror').editor.state.selection.from }));
  if (!final.sameDoc || final.selection !== initial.target) throw new Error('Typing/Backspace did not restore document and caret');
  const saves = final.saves.filter(x => x.phase !== 'setup');
  const recovery = final.recovery.filter(x => x.phase !== 'setup' && x.bytes > 200);
  if (!saves.length || saves.some(x => x.status !== 200) || !recovery.length) throw new Error(`Persistence not exercised: ${saves.length} saves, ${recovery.length} recovery writes`);
  const stored = await apiRequest(`/projects/${project.id}/scripts/${sid}`);
  const storedBody = Object.fromEntries(Object.entries(stored.content).filter(([key]) => !key.startsWith('_')));
  if (JSON.stringify(storedBody) !== final.docJSON) throw new Error('Backend does not contain the restored document');
  if (errors.length) throw new Error(errors.join('\n'));
  const { docJSON, ...info } = initial;
  const result = { revision, url, bundlePath, bundleHash, browser: browser.version(), profile: profile === 'profile', fixture: size, requestedPages: size === '150' ? 150 : null, layout, navigator: nav, spellcheck: spell, autoSaveSeconds: 5, fixtureHash, ...info, phases, saves, recovery, longTasks: final.longTasks.filter(x => x.phase !== 'setup'), sameDoc: final.sameDoc, persistedBodyVerified: true, errors };
  fs.writeFileSync(output + '.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: output + '.png' });
  console.log(JSON.stringify({ output, pages: result.pages, phases, saves: saves.length, recovery: recovery.length }));
} finally {
  await browser.close();
}

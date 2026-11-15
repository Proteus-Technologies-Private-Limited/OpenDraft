import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { availableParallelism, cpus, release } from 'node:os';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { screenplay } from '../../frontend/src/test/fixtures/longScreenplay.mjs';
import { Inspector, waitFor } from './inspector.mjs';
import { startMeasurement, stopMeasurement } from './measurement.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
assert(
  options['allow-synthetic-document'],
  'Refusing to replace a document without --allow-synthetic-document. Use disposable XDG data.',
);
const base = String(options.inspector ?? 'http://127.0.0.1:9229');
assert(
  ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
  'Use a loopback native inspector',
);
const output = resolve(String(options.output ?? 'test-script/output/native-scroll'));
mkdirSync(output, { recursive: true });
const xdo = String(options.xdotool ?? 'xdotool');
const appPid = Number(options.pid);
assert(Number.isInteger(appPid) && appPid > 1, '--pid must identify the disposable native app');
const profileRoot = resolve(String(options['profile-root'] ?? ''));
assert(options['profile-root'], '--profile-root must identify disposable XDG storage');
const xrun = promisify(execFile);
const x = (...args) =>
  execFileSync(xdo, args.map(String), { encoding: 'utf8', timeout: 10000 }).trim();
const windows = x('search', '--onlyvisible', '--pid', appPid).split('\n');
assert.equal(windows.length, 1, 'Expected exactly one visible native app window');
const windowId = windows[0];
x('windowsize', windowId, '1440', '900');
x('windowraise', windowId);
x('windowfocus', '--sync', windowId);
const page = await waitFor('native inspector page', async () => {
  const html = await (await fetch(base)).text();
  return html.match(/\/socket\/\d+\/\d+\/WebPage/)?.[0];
});
const client = await Inspector.connect(base.replace(/^http/, 'ws') + page);
try {
  // Ask the actual native process for its storage roots before replacing data.
  // /proc/environ can be inaccessible across a WebKit mount/user namespace.
  const appPaths = await client.evaluate(
    async () => ({
      data: await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', {
        directory: 14,
      }),
      config: await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', {
        directory: 13,
      }),
      cache: await window.__TAURI_INTERNALS__.invoke('plugin:path|resolve_directory', {
        directory: 16,
      }),
    }),
    undefined,
    { promise: true },
  );
  for (const key of ['data', 'config', 'cache'])
    assert.equal(
      appPaths[key],
      join(profileRoot, key, 'com.proteus.opendraft'),
      `Native ${key} directory does not match the disposable profile`,
    );
  const application = readFileSync(`/proc/${appPid}/cmdline`, 'utf8').split('\0')[0];
  const HZ = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  function processes() {
    const records = new Map();
    for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        records.set(Number(pid), {
          pid: Number(pid),
          parent: Number(fields[1]),
          name: stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')')),
          ticks: Number(fields[11]) + Number(fields[12]),
          start: fields[19],
        });
      } catch {
        /* A process may exit while enumerating. */
      }
    }
    const selected = new Set([appPid, Number(options['display-pid'])].filter(Number.isFinite));
    for (let change = true; change; ) {
      change = false;
      for (const p of records.values())
        if (selected.has(p.parent) && !selected.has(p.pid)) {
          selected.add(p.pid);
          change = true;
        }
    }
    return [...selected].map((pid) => records.get(pid)).filter(Boolean);
  }
  function cpuDelta(before, after) {
    return after.map((p) => {
      const previous = before.find((b) => b.pid === p.pid && b.start === p.start);
      return {
        pid: p.pid,
        name: p.name,
        cpuMs: Math.round(((p.ticks - (previous?.ticks ?? 0)) * 1000) / HZ),
      };
    });
  }
  async function menuCheck(section, label, checked) {
    await client.evaluate((section) => {
      const top = document.querySelector(`[data-menu-top="${section}"]`);
      if (top.getAttribute('aria-expanded') !== 'true') top.click();
    }, section);
    await waitFor(`menu checkbox ${label}`, () =>
      client.evaluate(
        (label) =>
          [...document.querySelectorAll('[role="menuitemcheckbox"]')].some(
            (e) => e.getAttribute('aria-label') === label,
          ),
        label,
      ),
    );
    await client.evaluate(
      ({ section, label, checked }) => {
        const top = document.querySelector(`[data-menu-top="${section}"]`);
        const row = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(
          (e) => e.getAttribute('aria-label') === label,
        );
        if ((row.getAttribute('aria-checked') === 'true') !== checked) row.click();
        else top.click();
      },
      { section, label, checked },
    );
    await waitFor('menu closed', () =>
      client.evaluate(
        (section) =>
          document.querySelector(`[data-menu-top="${section}"]`).getAttribute('aria-expanded') ===
          'false',
        section,
      ),
    );
  }
  const capturedShadows = new Set();
  async function configure(config) {
    await client.evaluate((shadow) => {
      document.querySelector('#native-scroll-paint-ablation')?.remove();
      if (shadow === 'off' || shadow === 'outline') {
        const before = document.querySelector('.page').getBoundingClientRect();
        const style = document.createElement('style');
        style.id = 'native-scroll-paint-ablation';
        style.textContent =
          '.page { box-shadow: none !important;' +
          (shadow === 'outline' ? ' outline: 1px solid rgba(0,0,0,.12);' : '') +
          ' }';
        document.head.append(style);
        const after = document.querySelector('.page').getBoundingClientRect();
        if (before.width !== after.width || before.height !== after.height)
          throw new Error('Paint ablation changed page layout');
      }
    }, config.shadow);
    await menuCheck('View', 'Navigator', config.navigator);
    await menuCheck('Edit', 'Auto Spell Check', config.spellcheck);
    await waitFor('settings and dictionary decorations', () =>
      client.evaluate((c) => {
        const navigator = !!document.querySelector('.scene-navigator');
        const errors = document.querySelectorAll('.spell-error').length;
        const scenes = Number(document.querySelector('.scene-count')?.textContent);
        return (
          navigator === c.navigator &&
          (!c.navigator || scenes === 115) &&
          (c.spellcheck ? errors > 0 : errors === 0)
        );
      }, config),
    );
    const info = await client.evaluate(() => {
      window.__nativeBench.editor.view.focus();
      const scroller = document.querySelector('.editor-main');
      scroller.scrollTop = scroller.scrollHeight * 0.4;
      const r = scroller.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        pages: document.querySelectorAll('.page-sep-gap').length + 1,
        marks: document.querySelectorAll('.spell-error').length,
        navigatorScenes: document.querySelector('.scene-count')?.textContent ?? null,
      };
    });
    assert.equal(info.pages, 150, 'The native app must render exactly 150 screenplay pages');
    if (options['shadow-comparison'] && !capturedShadows.has(config.shadow)) {
      await xrun('import', [
        '-display',
        process.env.DISPLAY,
        '-window',
        windowId,
        join(output, `native-${config.shadow}.png`),
      ]);
      capturedShadows.add(config.shadow);
    }
    x('mousemove', Math.round(info.x), Math.round(info.y));
    // Warm the same native wheel path in both directions; never include setup in
    // the timing sample. These are real XTest button events, not DOM wheel mocks.
    await xrun(xdo, ['click', '--repeat', '12', '--delay', '33', '5']);
    await xrun(xdo, ['click', '--repeat', '12', '--delay', '33', '4']);
    await delay(500);
    return info;
  }
  let timelineEnabled = false;
  async function phase(config, direction, profiling, index) {
    await client.evaluate(startMeasurement);
    client.events = [];
    if (profiling) {
      if (!timelineEnabled) {
        await client.request('Timeline.enable');
        timelineEnabled = true;
      }
      await client.request('Timeline.start', { maxCallStackDepth: 20 });
      await client.request('ScriptProfiler.startTracking', { includeSamples: true });
    }
    const before = processes();
    const wallStart = performance.now();
    await xrun(xdo, [
      'click',
      '--repeat',
      '120',
      '--delay',
      '33',
      direction === 'down' ? '5' : '4',
    ]);
    await delay(600);
    const wallMs = performance.now() - wallStart;
    const after = processes();
    if (profiling) {
      await client.request('ScriptProfiler.stopTracking');
      await client.request('Timeline.stop');
    }
    const data = await client.evaluate(stopMeasurement);
    assert(data.frameCount > 0, 'No animation frames were observed');
    assert.equal(data.wheelEvents, 120, 'Native wheel input was lost');
    assert.equal(data.trustedWheels, data.wheelEvents, 'Untrusted wheel input');
    assert(
      direction === 'down' ? data.distance > 500 : data.distance < -500,
      'Native scroll did not reach the editor',
    );
    assert(data.documentIntact && data.selectionIntact, 'Scrolling changed the script or caret');
    assert.equal(data.visibility, 'visible');
    assert(data.focused, 'Native window lost focus during measurement');
    const result = { config, direction, profiling, wallMs, ...data, cpu: cpuDelta(before, after) };
    if (profiling) {
      const complete = client.events.find((e) => e.method === 'ScriptProfiler.trackingComplete');
      assert(complete?.params.timestamp > 0, 'Native profiler clock is not running');
    }
    if (profiling)
      writeFileSync(
        join(output, `trace-${index}-${direction}.json`),
        JSON.stringify(client.events),
      );
    console.log(JSON.stringify(result));
    return result;
  }
  await client.request('Inspector.enable');
  await client.request('Page.enable');
  await client.request('Runtime.enable');
  await client.request('Inspector.initialized');
  let quietSince = null;
  await waitFor('startup dialogs cleared', async () => {
    const ready = await client.evaluate(() => {
      const dialogs = [
        ...document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ].filter((e) => e.getBoundingClientRect().width > 0);
      // Native storage roots were verified before any destructive fixture step.
      const recovery = dialogs.find((e) => e.textContent.includes('Recover unsaved changes'));
      const discard = [...(recovery?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent.trim() === 'Discard',
      );
      if (discard) {
        discard.click();
        return false;
      }
      const blank = [...document.querySelectorAll('button')].find((b) =>
        b.textContent.includes('Blank Document'),
      );
      if (blank) {
        blank.click();
        return false;
      }
      return !dialogs.length && !!document.querySelector('.ProseMirror');
    });
    if (!ready) {
      quietSince = null;
      return false;
    }
    quietSince ??= Date.now();
    return Date.now() - quietSince >= 750;
  });
  await client.evaluate(() => {
    if (!window.__TAURI_INTERNALS__ || location.protocol !== 'tauri:')
      throw new Error('Expected the actual Tauri app origin');
    let el = document.querySelector('.ProseMirror'),
      editor;
    while (el && !editor) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      let f = k && el[k];
      while (f) {
        if (f.memoizedProps?.editor?.commands) {
          editor = f.memoizedProps.editor;
          break;
        }
        f = f.return;
      }
      el = el.parentElement;
    }
    if (!editor) throw new Error('Native editor not ready');
    if (window.__nativeBench?.measure) {
      window.__nativeBench.measure.active = false;
      cancelAnimationFrame(window.__nativeBench.measure.rafId);
    }
    window.__nativeBench = { editor, payload: '' };
  });
  const doc = screenplay(184);
  doc.content.splice(-14);
  const serialized = JSON.stringify(doc);
  // libsoup's inspector WebSocket has a bounded incoming frame size. Chunk
  // fixture data; do not replace one transaction with many editor insertions.
  for (let i = 0; i < serialized.length; i += 24000)
    await client.evaluate(
      (chunk) => {
        window.__nativeBench.payload += chunk;
      },
      serialized.slice(i, i + 24000),
    );
  await client.evaluate(() => {
    // Tiptap 2 defaults emitUpdate to false: request a real content update so
    // Navigator and app subscribers receive the fixture, just as when typing.
    const b = window.__nativeBench;
    b.editor.commands.setContent(JSON.parse(b.payload), true);
    b.payload = '';
    b.editor.commands.setTextSelection(1);
    b.editor.view.focus();
    b.documentBefore = b.editor.state.doc;
    b.selection = { from: b.editor.state.selection.from, to: b.editor.state.selection.to };
  });
  await waitFor('150 screenplay pages and fonts', () =>
    client.evaluate(
      () =>
        document.fonts.status === 'loaded' &&
        document.querySelectorAll('.page-sep-gap').length + 1 === 150,
    ),
  );
  await delay(1500);
  const environment = await client.evaluate(() => ({
    native: !!window.__TAURI_INTERNALS__,
    origin: location.origin,
    userAgent: navigator.userAgent,
    width: innerWidth,
    height: innerHeight,
    blocks: window.__nativeBench.editor.state.doc.childCount,
    documentSize: window.__nativeBench.editor.state.doc.content.size,
    pages: document.querySelectorAll('.page-sep-gap').length + 1,
    status: document.querySelector('.status-page')?.textContent,
    font: getComputedStyle(document.querySelector('.page')).fontFamily,
    deviceScale: devicePixelRatio,
  }));
  const results = [];
  const settingsCases = [
    { navigator: false, spellcheck: false },
    { navigator: true, spellcheck: false },
    { navigator: false, spellcheck: true },
    { navigator: true, spellcheck: true },
  ];
  const cases = options['shadow-comparison']
    ? [
        { navigator: true, spellcheck: true, shadow: 'default' },
        { navigator: true, spellcheck: true, shadow: 'outline' },
        { navigator: true, spellcheck: true, shadow: 'off' },
      ]
    : settingsCases;
  const rounds = Number(options.repetitions ?? 3);
  for (let round = 0; round < rounds; round++) {
    for (const config of round % 2 ? [...cases].reverse() : cases) {
      await configure(config);
      for (const direction of ['down', 'up'])
        results.push(await phase({ ...config, round }, direction, false, results.length));
    }
  }
  if (options.profile) {
    for (const config of options['shadow-comparison'] ? cases : [cases.at(-1)]) {
      await configure(config);
      for (const direction of ['down', 'up'])
        results.push(await phase(config, direction, true, results.length));
    }
  }
  const nativeVersion = await client.evaluate(
    () => window.__TAURI_INTERNALS__.invoke('plugin:app|version'),
    undefined,
    { promise: true },
  );
  const report = {
    kernel: release(),
    cpuModel: cpus()[0].model,
    availableCPUs: availableParallelism(),
    nativeVersion,
    executableSha256: createHash('sha256').update(readFileSync(application)).digest('hex'),
    disposableStorageVerified: true,
    renderingRequest: String(options.mode ?? 'default'),
    mode: options.mode ?? 'default',
    executable: '/proc/' + appPid + '/exe',
    appPid,
    environment,
    documentSha256: createHash('sha256').update(serialized).digest('hex'),
    results,
  };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await xrun('import', [
    '-display',
    process.env.DISPLAY,
    '-window',
    windowId,
    join(output, 'native-window.png'),
  ]);
} finally {
  await client.evaluate(stopMeasurement).catch(() => {});
  client.close();
}

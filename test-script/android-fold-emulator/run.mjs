import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Cdp, imeShown, physicalDisplays, pngImage, rotationLock, supportedStates, waitFor } from './protocol.mjs';
import * as probes from './probes.mjs';

const [variant, serial] = process.argv.slice(2);
assert(['debug', 'minified'].includes(variant), 'Choose debug or minified');
assert(/^emulator-\d+$/.test(serial ?? ''), 'Only an explicit emulator serial is accepted; physical devices are refused');
const pkg = 'com.proteus.opendraft';
const sdk = process.env.ANDROID_HOME;
assert(sdk, 'ANDROID_HOME is required');
const adbPath = join(sdk, 'platform-tools/adb');
const output = resolve('test-script/output/android-fold-evidence', variant);
const artifact = resolve('test-script/output/android-fold-apk', variant);
mkdirSync(output, { recursive: true });
const adb = (args, binary = false) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: binary ? undefined : 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
const shell = (...args) => adb(['shell', ...args]).trim();
assert.equal(shell('getprop', 'ro.kernel.qemu'), '1', 'Refusing to clear app data outside an emulator');
const build = JSON.parse(readFileSync(join(artifact, 'build.json'), 'utf8'));
assert.equal(build.variant, variant);
assert.equal(build.sha256, createHash('sha256').update(readFileSync(join(artifact, 'test-only.apk'))).digest('hex'), 'APK does not match staged evidence');
const evidence = { build, serial, phases: [], status: 'running' };
const clients = [];
const forwards = [];
let lastPid;
let previousRotation;
const previous = {};
const settings = [ ['system', 'accelerometer_rotation'], ['system', 'user_rotation'], ['secure', 'show_ime_with_hard_keyboard'] ];
const capture = label => {
  const captures = [];
  for (const display of physicalDisplays(shell('dumpsys', 'SurfaceFlinger', '--display-id'))) {
    try {
      const image = pngImage(adb(['exec-out', 'screencap', '-p', '-d', display], true));
      const file = `${label}-display-${display}.png`;
      writeFileSync(join(output, file), image.data);
      captures.push({ display, file, width: image.width, height: image.height });
    } catch { /* An inactive physical display may not support capture. */ }
  }
  assert(captures.length, `No valid display screenshot for ${label}`);
  return captures;
};
const startMain = () => shell('am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
const overrideState = id => {
  const result = shell('cmd', 'device_state', 'state', String(id));
  assert(!/Exception|Error:|not supported/i.test(result), result);
};
async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) });
  assert(response.ok, `CDP target discovery returned ${response.status}`);
  return response.json();
}
async function connect(exclude = new Set()) {
  const sockets = shell('cat', '/proc/net/unix').match(/webview_devtools_remote_\d+/g) ?? [];
  assert(sockets.length, 'No inspectable app WebView: CI hook or startup failed');
  const pids = shell('pidof', pkg).split(/\s+/);
  const socket = [...new Set(sockets)].find(s => pids.includes(s.split('_').at(-1)));
  assert(socket, 'No WebView socket belongs to the OpenDraft process');
  const port = Number(adb(['forward', 'tcp:0', `localabstract:${socket}`]).trim());
  assert(port > 0, 'ADB did not allocate a forwarding port');
  forwards.push(port);
  const page = await waitFor('OpenDraft WebView target', async () => (await targets(port)).find(p => p.type === 'page'
    && !exclude.has(p.id) && /^(https?:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(p.url) && !p.url.includes('splash')));
  const client = await Cdp.connect(page.webSocketDebuggerUrl);
  clients.push(client);
  return { client, page, port };
}
async function phase(label, client, predicate = () => true) {
  const data = await waitFor(label, async () => {
    const s = await client.evaluate(probes.snapshot);
    evidence.lastObserved = { label, ...s };
    return s.native?.status === 'available' && s.native.active && predicate(s) ? s : false;
  });
  for (const [name, okay] of Object.entries(data.invariants)) assert(okay, `${label}: ${name} was lost`);
  evidence.phases.push({ label, ...data, captures: capture(label) });
  writeFileSync(join(output, 'report.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`${label}: native=${data.native.feature?.orientation ?? 'none'}, confirmed=${data.native.confirmed}`);
  return data;
}
try {
  const statesText = shell('cmd', 'device_state', 'print-states');
  writeFileSync(join(output, 'supported-states.txt'), statesText + '\n');
  const states = supportedStates(statesText);
  evidence.states = states;
  evidence.androidRelease = shell('getprop', 'ro.build.version.release');
  evidence.api = shell('getprop', 'ro.build.version.sdk');
  writeFileSync(join(output, 'webview-provider.txt'), shell('dumpsys', 'webviewupdate'));
  for (const [space, key] of settings) previous[`${space}/${key}`] = shell('settings', 'get', space, key);
  previousRotation = rotationLock(shell('wm', 'user-rotation'));
  shell('settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1');
  overrideState(states.closed.id);
  shell('wm', 'user-rotation', 'lock', '0');
  const install = adb(['install', '-r', '-t', join(artifact, 'test-only.apk')]);
  assert(install.includes('Success'), install);
  assert.equal(shell('pm', 'clear', pkg), 'Success');
  shell('am', 'force-stop', pkg);
  startMain();
  await waitFor('native process', async () => { try { lastPid = shell('pidof', pkg).split(/\s+/)[0]; return lastPid; } catch { return false; } });
  const main = await waitFor('app WebView socket', async () => connect());
  await waitFor('real editor and native bridge', () => main.client.evaluate(probes.initialize, 'main'));
  await waitFor('writing-pad draft', () => main.client.evaluate(probes.seedPad));
  const cold = await phase('cold-cover', main.client);
  // Capability can be true on a cold cover only if this OEM already supplied
  // FoldingFeature evidence. Never force it from a model or a small window.
  evidence.coldCoverConfirmed = cold.native.confirmed;
  if (!cold.native.confirmed && Math.max(cold.browserSignals.segments ?? 0, cold.browserSignals.legacySegments ?? 0) < 2) {
    assert(!cold.classes.includes('foldable'), 'Cold cover size alone invented foldable capability');
  }

  overrideState(evidence.states.open.id);
  await phase('open', main.client, s => !s.native.feature?.folded
    && (s.viewport.width > cold.viewport.width + 100 || s.viewport.height > cold.viewport.height + 100));
  overrideState(evidence.states.half.id);
  const half = await phase('half-open', main.client, s => s.native.feature?.folded && s.classes.includes(s.native.feature.orientation === 'vertical' ? 'fold-book' : 'fold-laptop'));

  shell('wm', 'user-rotation', 'lock', '1');
  await waitFor('WindowManager rotation lock', async () => rotationLock(shell('wm', 'user-rotation')).join(' ') === 'lock 1');
  await phase('rotated', main.client, s => s.native.feature?.folded && s.native.feature.orientation !== half.native.feature.orientation
    && s.classes.includes(s.native.feature.orientation === 'vertical' ? 'fold-book' : 'fold-laptop'));

  const point = await waitFor('keyboard-enabled writing field', () => main.client.evaluate(probes.keyboardPoint));
  shell('input', 'tap', String(point.x), String(point.y));
  await waitFor('actual Android soft keyboard', async () => imeShown(shell('dumpsys', 'input_method')));
  shell('input', 'text', 'NativeKeys');
  await waitFor('IME text committed into the pad', () => main.client.evaluate(probes.acceptTypedPad));
  await phase('keyboard-visible', main.client);
  writeFileSync(join(output, 'input-method-visible.txt'), shell('dumpsys', 'input_method'));
  shell('input', 'keyevent', 'KEYCODE_BACK');
  await waitFor('soft keyboard dismissed', async () => !imeShown(shell('dumpsys', 'input_method')));
  await phase('keyboard-dismissed', main.client);

  shell('input', 'keyevent', 'KEYCODE_HOME');
  overrideState(evidence.states.open.id);
  startMain();
  await phase('resumed-after-posture-change', main.client, s => s.native.confirmed && !s.native.feature?.folded
    && !s.classes.includes('fold-book') && !s.classes.includes('fold-laptop'));

  const before = new Set((await targets(main.port)).map(p => p.id));
  await main.client.evaluate(probes.openExtraWindow);
  const extra = await waitFor('extra Activity WebView', () => connect(before));
  await waitFor('extra window editor and bridge', () => extra.client.evaluate(probes.initialize, 'extra'));
  await waitFor('extra window writing pad', () => extra.client.evaluate(probes.seedPad));
  const second = await phase('extra-window', extra.client);
  assert.notEqual(second.token, cold.token, 'Extra window reused the main document context');
  writeFileSync(join(output, 'activities.txt'), shell('dumpsys', 'activity', 'activities'));
  assert(shell('dumpsys', 'activity', 'activities').includes('WindowActivity1'), 'No real extra Android Activity was opened');
  startMain();
  const returned = await phase('main-after-extra-window', main.client);
  assert.equal(returned.token, cold.token, 'Main document was recreated');

  overrideState(evidence.states.closed.id);
  await phase('folded-back', main.client, s => s.native.confirmed && s.classes.includes('phone')
    && !s.classes.includes('fold-book') && !s.classes.includes('fold-laptop'));
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.error = error.stack ?? String(error);
  try { capture('failure'); } catch { /* Process/emulator may have exited. */ }
  for (const [name, command] of [['window-manager', ['dumpsys', 'window']], ['display', ['dumpsys', 'display']], ['rotation-lock', ['wm', 'user-rotation']]]) {
    try { writeFileSync(join(output, `${name}.txt`), shell(...command)); } catch { /* retain other evidence */ }
  }
  throw error;
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify(evidence, null, 2) + '\n');
  try { writeFileSync(join(output, 'crashes.txt'), adb(['logcat', '-b', 'crash', '-d'])); } catch { /* retain other evidence */ }
  if (lastPid) try { writeFileSync(join(output, 'app-logcat.txt'), adb(['logcat', '-d', '--pid', lastPid])); } catch { /* retain report */ }
  for (const client of clients) client.close();
  for (const port of forwards) try { adb(['forward', '--remove', `tcp:${port}`]); } catch { /* already closed */ }
  for (const [space, key] of settings) {
    const value = previous[`${space}/${key}`];
    if (value === undefined) continue;
    try { shell('settings', value === 'null' ? 'delete' : 'put', space, key, ...(value === 'null' ? [] : [value])); } catch { /* emulator teardown */ }
  }
  if (previousRotation) try { shell('wm', 'user-rotation', ...previousRotation); } catch { /* emulator teardown */ }
  try { shell('cmd', 'device_state', 'state', 'reset'); } catch { /* emulator teardown */ }
}

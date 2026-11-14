import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bridgeKept, Cdp, imeShown, physicalDisplays, pngImage, rotationLock, supportedStates, waitFor } from './protocol.mjs';

test('discovers state IDs by names and excludes rear-display states', () => {
  const data = "Supported states: [DeviceState{identifier=4, name='CLOSED'}, DeviceState{identifier=8, name='HALF_OPENED'}, DeviceState{identifier=12, name='OPENED'}, DeviceState{identifier=15, name='REAR_DISPLAY'}]";
  assert.deepEqual(Object.fromEntries(Object.entries(supportedStates(data)).map(([k,v]) => [k,v.id])), { closed: 4, half: 8, open: 12 });
  assert.equal(supportedStates('2: FOLDED\n3: HALF_OPEN\n7: UNFOLDED\n').open.id, 7);
  assert.throws(() => supportedStates('0: DEFAULT\n'), /distinct/);
  assert.throws(() => supportedStates('0: CLOSED\n1: HALF_OPENED\n2: OPENED\n4: OPEN\n'), /Ambiguous/);
});
test('requires the actual native snapshot class and method to survive R8', () => {
  const map = 'com.proteus.opendraft.FoldPostureBridge -> com.proteus.opendraft.FoldPostureBridge:\n    1:2:java.lang.String snapshot():34:35 -> snapshot\nother.Class -> a:\n    void x() -> x\n';
  assert(bridgeKept(map));
  assert(!bridgeKept(map.replace('-> snapshot', '-> a')));
  assert(!bridgeKept(map.replace('-> com.proteus.opendraft.FoldPostureBridge:', '-> a:')));
  assert(!bridgeKept('unrelated.Class -> unrelated.Class:\n    java.lang.String snapshot() -> snapshot\n'));
});
test('keyboard visibility needs explicit InputMethodManager evidence', () => {
  assert(imeShown('mShowRequested=true mInputShown=true'));
  assert(!imeShown('mShowRequested=true mInputShown=false'));
  assert(imeShown('isInputViewShown: true'));
  assert.throws(() => imeShown('visualViewport.height=300'), /cannot establish/);
});
class Socket extends EventTarget {
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  reply(id, value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, ...value }) })); }
  close() { this.dispatchEvent(new Event('close')); }
}
test('rotation uses the WindowManager lock command and preserves its original mode', () => {
  assert.deepEqual(rotationLock('lock 1\n'), ['lock', '1']);
  assert.deepEqual(rotationLock('free\n'), ['free']);
  assert.throws(() => rotationLock('lock 9'), /Unrecognized/);
});
test('multi-display screenshots keep exact IDs and remove only stdout before PNG bytes', () => {
  assert.deepEqual(physicalDisplays('Display 4619827259835644672 (HWC display 0)\nDisplay 4619827551948147201 (HWC display 1)'), ['4619827259835644672', '4619827551948147201']);
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKJ0AAAAASUVORK5CYII=', 'base64');
  const parsed = pngImage(Buffer.concat([Buffer.from('[Warning] Multiple displays were found\n'), original]));
  assert.deepEqual(parsed.data, original);
  assert.equal(parsed.width, 1); assert.equal(parsed.height, 1);
  assert.throws(() => pngImage(original.subarray(0, 32)), /incomplete/);
  assert.throws(() => pngImage(Buffer.from('screencap failed')), /not PNG/);
});
test('CDP correlates out-of-order replies and rejects protocol/page errors', async () => {
  const socket = new Socket(); const client = new Cdp(socket);
  const a = client.call('A'); const b = client.call('B');
  socket.reply(2, { result: { value: 'b' } }); socket.reply(1, { result: { value: 'a' } });
  assert.deepEqual(await a, { value: 'a' }); assert.deepEqual(await b, { value: 'b' });
  const error = assert.rejects(client.call('C'), /unsupported/); socket.reply(3, { error: { message: 'unsupported' } }); await error;
  const pageError = assert.rejects(client.evaluate(() => {}), /script failed/);
  socket.reply(4, { result: { exceptionDetails: { text: 'script failed' } } }); await pageError;
  client.close();
});
test('CDP bounds waits and rejects pending work on disconnect', async () => {
  const socket = new Socket(); const client = new Cdp(socket, 5);
  await assert.rejects(client.call('neverReplies'), /timeout/);
  const closed = assert.rejects(client.call('pending'), /socket close/); socket.close(); await closed;
  assert.equal(client.pending.size, 0);
});
test('readiness failure is a test failure, never a silent skip', async () => {
  await assert.rejects(waitFor('native feature', async () => false, { timeout: 5, interval: 1 }), /native feature/);
});

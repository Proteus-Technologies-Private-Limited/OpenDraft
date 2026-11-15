import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Inspector } from './inspector.mjs';

class Socket extends EventTarget {
  sent = [];
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  receive(message) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  reply(message) {
    this.receive({
      method: 'Target.dispatchMessageFromTarget',
      params: {
        targetId: 'page',
        message: JSON.stringify(message),
      },
    });
  }
  close() {
    this.dispatchEvent(new Event('close'));
  }
}

function connection() {
  const socket = new Socket();
  const client = new Inspector(socket);
  socket.receive({
    method: 'Target.targetCreated',
    params: {
      targetInfo: { type: 'page', targetId: 'page' },
    },
  });
  return { socket, client };
}

test('transport acknowledgements cannot resolve a native page request', async () => {
  const { socket, client } = connection();
  const first = client.request('Page.enable');
  const second = client.request('Runtime.enable');
  const [a, b] = socket.sent;
  assert.equal(a.params.targetId, 'page');
  const innerA = JSON.parse(a.params.message);
  const innerB = JSON.parse(b.params.message);
  assert.equal(innerA.method, 'Page.enable');
  assert.notEqual(a.id, innerA.id);
  socket.receive({ id: a.id, result: {} });
  assert.equal(client.pending.size, 2);
  // Responses can arrive in the opposite order.
  socket.reply({ id: innerB.id, result: { enabled: 'runtime' } });
  socket.reply({ id: innerA.id, result: { enabled: 'page' } });
  assert.deepEqual(await first, { enabled: 'page' });
  assert.deepEqual(await second, { enabled: 'runtime' });
  assert.equal(client.pending.size, 0);
  assert.equal(client.transport.size, 0);
  client.close();
});

test('native transport and page errors reject immediately', async () => {
  const { socket, client } = connection();
  const transport = client.request('Page.enable');
  const rejected = assert.rejects(transport, /Target missing/);
  socket.receive({ id: socket.sent.at(-1).id, error: { message: 'Target missing' } });
  await rejected;
  const inner = client.request('Timeline.enable');
  const rejectedInner = assert.rejects(inner, /already enabled/);
  socket.reply({
    id: JSON.parse(socket.sent.at(-1).params.message).id,
    error: { message: 'already enabled' },
  });
  await rejectedInner;
  assert.equal(client.pending.size, 0);
  assert.equal(client.transport.size, 0);
  client.close();
});

test('promise evaluation waits for native IPC instead of serializing an empty object', async () => {
  const { socket, client } = connection();
  const result = client.evaluate('nativeIPC()', undefined, { promise: true });
  const evaluation = JSON.parse(socket.sent.at(-1).params.message);
  assert.equal(evaluation.params.returnByValue, false);
  socket.reply({
    id: evaluation.id,
    result: {
      result: { className: 'Promise', objectId: 'native-promise' },
    },
  });
  await Promise.resolve();
  const awaiting = JSON.parse(socket.sent.at(-1).params.message);
  assert.equal(awaiting.method, 'Runtime.awaitPromise');
  assert.equal(awaiting.params.promiseObjectId, 'native-promise');
  socket.reply({ id: awaiting.id, result: { result: { value: '/disposable/data' } } });
  assert.equal(await result, '/disposable/data');
  client.close();
});

test('disconnection rejects outstanding work and clears timers', async () => {
  const { socket, client } = connection();
  const request = client.request('Timeline.stop');
  const rejected = assert.rejects(request, /Inspector disconnected/);
  socket.close();
  await rejected;
  assert.equal(client.pending.size, 0);
  assert.equal(client.transport.size, 0);
});

test('synchronous socket failure does not leave a pending timeout', async () => {
  const { socket, client } = connection();
  socket.send = () => {
    throw new Error('closed');
  };
  await assert.rejects(client.request('Page.enable'), /closed/);
  assert.equal(client.pending.size, 0);
  assert.equal(client.transport.size, 0);
  client.close();
});

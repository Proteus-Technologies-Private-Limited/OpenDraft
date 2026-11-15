import { setTimeout as delay } from 'node:timers/promises';

/** WebKitGTK's remote inspector, including the current multiplexed Target
 * transport. This connects to a real native app, never Playwright WebKit. */
export class Inspector {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    this.transport = new Map();
    this.events = [];
    socket.addEventListener('message', (event) => {
      let message = JSON.parse(event.data);
      if (message.method === 'Target.targetCreated' && message.params.targetInfo.type === 'page')
        this.target = message.params.targetInfo.targetId;
      if (message.method === 'Target.dispatchMessageFromTarget')
        message = JSON.parse(message.params.message);
      if (message.id) {
        const innerId = this.transport.get(message.id);
        if (innerId !== undefined && !message.error) {
          this.transport.delete(message.id);
          return;
        }
        const requestId = innerId ?? message.id;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        this.transport.delete(pending.transportId);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
    socket.addEventListener('close', (event) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Inspector disconnected (${event.code}: ${event.reason})`));
      }
      this.pending.clear();
      this.transport.clear();
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    const client = new Inspector(socket);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    await waitFor('native page target', () => client.target);
    return client;
  }
  request(method, params = {}) {
    const id = ++this.id;
    const transportId = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.transport.delete(transportId);
        reject(new Error(`${method} timed out`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer, transportId });
      this.transport.set(transportId, id);
      try {
        this.socket.send(
          JSON.stringify({
            id: transportId,
            method: 'Target.sendMessageToTarget',
            params: {
              targetId: this.target,
              message: JSON.stringify({ id, method, params }),
            },
          }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.transport.delete(transportId);
        reject(error);
      }
    });
  }
  async evaluate(fn, arg, { promise = false } = {}) {
    const expression = typeof fn === 'function' ? `(${fn.toString()})(${JSON.stringify(arg)})` : fn;
    let value = await this.request('Runtime.evaluate', { expression, returnByValue: !promise });
    if (value.wasThrown) throw new Error(JSON.stringify(value.result));
    if (promise && value.result.className === 'Promise')
      value = await this.request('Runtime.awaitPromise', {
        promiseObjectId: value.result.objectId,
        returnByValue: true,
      });
    if (value.wasThrown) throw new Error(JSON.stringify(value.result));
    return value.result.value;
  }
  close() {
    this.socket.close();
  }
}
export async function waitFor(label, read, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    last = value;
    await delay(100);
  }
  throw new Error(`${label} not ready: ${JSON.stringify(last)}`);
}

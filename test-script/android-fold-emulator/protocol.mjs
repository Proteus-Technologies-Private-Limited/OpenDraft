import { setTimeout as delay } from 'node:timers/promises';

export function supportedStates(text) {
  const found = [...text.matchAll(/identifier\s*=\s*(\d+)[^}]*?name\s*=\s*['"]([^'"]+)['"]/gi)]
    .map(m => ({ id: Number(m[1]), name: m[2] }));
  if (!found.length) {
    found.push(...[...text.matchAll(/^\s*(\d+)\s*:\s*([A-Z_]+)\s*$/gm)].map(m => ({ id: Number(m[1]), name: m[2] })));
  }
  const roles = {};
  for (const state of found) {
    const role = /(?:^|_)HALF_OPEN(?:ED)?$/.test(state.name) ? 'half'
      : /(?:^|_)(?:CLOSED|FOLDED)$/.test(state.name) ? 'closed'
        : /(?:^|_)(?:OPENED|OPEN|UNFOLDED)$/.test(state.name) ? 'open' : null;
    if (!role) continue;
    if (roles[role] && roles[role].id !== state.id) throw new Error(`Ambiguous ${role} device states`);
    roles[role] = state;
  }
  if (Object.keys(roles).length !== 3 || new Set(Object.values(roles).map(s => s.id)).size !== 3) {
    throw new Error('Emulator must report distinct CLOSED, HALF_OPENED and OPENED states');
  }
  return roles;
}

export function bridgeKept(mapping) {
  const section = mapping.match(/^com\.proteus\.opendraft\.FoldPostureBridge -> com\.proteus\.opendraft\.FoldPostureBridge:\r?\n((?:[ \t].*\r?\n|#.*\r?\n)*)/m)?.[1] ?? '';
  return /^\s*(?:\d+:\d+:)?java\.lang\.String snapshot\(\)(?::\d+(?::\d+)?)? -> snapshot\s*$/m.test(section);
}

export function imeShown(text) {
  const match = text.match(/\bmInputShown\s*[=:]\s*(true|false)\b/)
    ?? text.match(/\bisInputViewShown\s*[=:]\s*(true|false)\b/);
  if (!match) throw new Error('Unrecognized input_method dump: cannot establish keyboard visibility');
  return match[1] === 'true';
}

export function rotationLock(text) {
  const value = text.trim();
  if (value === 'free') return ['free'];
  const match = value.match(/^lock ([0-3])$/);
  if (!match) throw new Error(`Unrecognized WindowManager rotation lock: ${value}`);
  return ['lock', match[1]];
}

export function physicalDisplays(text) {
  const ids = [...new Set([...text.matchAll(/\bDisplay\s+(\d+)\s+\(/g)].map(m => m[1]))];
  if (!ids.length) throw new Error('No physical SurfaceFlinger display IDs');
  return ids; // Keep 64-bit IDs as strings, not imprecise JavaScript numbers.
}

export function pngImage(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const offset = bytes.indexOf(signature);
  if (offset < 0) throw new Error('Screenshot is not PNG data');
  const data = bytes.subarray(offset);
  if (data.length < 33 || data.toString('ascii', 12, 16) !== 'IHDR' || data.toString('ascii', data.length - 8, data.length - 4) !== 'IEND') {
    throw new Error('Screenshot PNG is incomplete');
  }
  const width = data.readUInt32BE(16); const height = data.readUInt32BE(20);
  if (!width || !height) throw new Error('Screenshot PNG has no dimensions');
  return { data, width, height };
}

export async function waitFor(label, read, { timeout = 60_000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value; } catch (error) { last = error; }
    await delay(interval);
  }
  throw new Error(`${label} did not become ready${last ? `: ${last.message}` : ''}`);
}

/** One bounded CDP page connection. No application-side test endpoint. */
export class Cdp {
  constructor(socket, timeout = 15_000) {
    this.socket = socket;
    this.timeout = timeout;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      let reply;
      try { reply = JSON.parse(String(event.data)); } catch { return; }
      const task = this.pending.get(reply.id);
      if (!task) return;
      this.pending.delete(reply.id); clearTimeout(task.timer);
      if (reply.error) task.reject(new Error(reply.error.message));
      else task.resolve(reply.result);
    });
    for (const event of ['close', 'error']) socket.addEventListener(event, () => this.abort(new Error(`CDP socket ${event}`)));
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    const client = new Cdp(socket);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connection timeout')); }, 15_000);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
      });
      return client;
    } catch (error) { client.close(); throw error; }
  }
  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async evaluate(fn, ...args) {
    const result = await this.call('Runtime.evaluate', {
      expression: `(${fn.toString()})(...${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    if (result.result?.subtype === 'error') throw new Error(result.result.description);
    return result.result?.value;
  }
  abort(error) {
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(error); }
    this.pending.clear();
  }
  close() { this.abort(new Error('CDP connection closed')); this.socket.close(); }
}

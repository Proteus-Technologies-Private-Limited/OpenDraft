/** Real sockets using the production review gate. Build collab-server first. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const front = createRequire(path.join(root, 'frontend/package.json'));
const back = createRequire(path.join(root, 'collab-server/package.json'));
const { Server } = back('@hocuspocus/server');
const { WebSocket } = back('ws');
const Y = front('yjs');
const ServerY = back('yjs');
const { HocuspocusProvider } = front('@hocuspocus/provider');
const { updateInMessage } = back('./dist/services/suggestionGuard.js');
const { ReviewGate, supportsReview } = back('./dist/services/reviewProtocol.js');
const live = [];
const servers = [];
const wire = (role) => `invite:${role}|review:1`;
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Socket condition timed out');
    await pause();
  }
}
async function serve(legacy = false) {
  const gate = new ReviewGate();
  const server = new Server({
    port: 0, address: '127.0.0.1', stopOnSignals: false, quiet: true,
    async onAuthenticate({ token, documentName, socketId, instance, request }) {
      const role = token.includes('|') ? token.split('|').find((p) => p.startsWith('invite:'))?.slice(7) : token;
      assert.ok(['host', 'editor', 'viewer', 'suggester'].includes(role));
      const capable = supportsReview(token);
      if (!legacy) {
        gate.join(documentName, socketId, capable);
        request.socket.once('close', () => gate.leave(documentName, socketId));
        try {
          const doc = instance.documents.get(documentName);
          if (doc) gate.checkClient(ServerY, doc, capable);
        } catch (error) { gate.leave(documentName, socketId); throw error; }
      }
      return { capable, role };
    },
    async onLoadDocument({ document, documentName }) {
      const action = new ServerY.XmlElement('action');
      const text = new ServerY.XmlText();
      text.insert(0, 'Keep every word.');
      if (documentName === 'persisted') text.format(0, 4, { suggestionFormat: { id: 'saved', by: 'Ann', at: 1, format: 'bold', before: false, after: true } });
      action.insert(0, [text]);
      document.getXmlFragment('default').insert(0, [action]);
      return document;
    },
    async beforeHandleMessage({ context, document, documentName, update: message, connection }) {
      if (legacy) return;
      gate.checkClient(ServerY, document, context.capable);
      const payload = updateInMessage(message);
      if (!payload) return;
      gate.checkUpdate(ServerY, documentName, document, payload, context.capable);
      ServerY.applyUpdate(document, payload, connection);
    },
    async onDisconnect({ documentName, socketId }) { gate.leave(documentName, socketId); },
  });
  await server.listen();
  servers.push(server);
  return { server, url: server.webSocketURL, gate };
}
function connect(server, token, name = 'plain') {
  const doc = new Y.Doc();
  const status = { synced: false, denied: false, closed: '', connections: 0 };
  let provider;
  provider = new HocuspocusProvider({
    url: server.url, name, document: doc, token, WebSocketPolyfill: WebSocket,
    onConnect: () => { status.connections++; },
    onAuthenticationFailed: () => { status.denied = true; provider.configuration.websocketProvider.disconnect(); },
    onSynced: ({ state }) => { status.synced = state; },
    onClose: ({ event }) => {
      if (event.reason) status.closed = event.reason;
      if (event.reason === 'review-incompatible') provider.configuration.websocketProvider.disconnect();
    },
  });
  const client = { provider, doc, status, stop() { provider.configuration.websocketProvider.disconnect(); provider.destroy(); } };
  live.push(client);
  return client;
}
function text(doc) { return doc.getXmlFragment('default').get(0).get(0); }
function propose(doc) {
  text(doc).format(0, 4, { bold: {}, suggestionFormat: { id: 'f', by: 'Ann', at: 1, format: 'bold', before: false, after: true } });
}
(async () => {
  try {
    const modern = await serve();
    const host = connect(modern, wire('host'));
    await until(() => host.status.synced);
    for (const role of ['host', 'editor', 'viewer', 'suggester']) {
      const peer = connect(modern, role);
      await until(() => peer.status.synced);
      assert.equal(text(peer.doc).toDelta().map((op) => op.insert).join(''), 'Keep every word.');
      peer.stop();
      await until(() => !modern.gate.hasLegacy('plain'));
    }
    const persisted = connect(modern, 'viewer', 'persisted');
    await until(() => persisted.status.closed === 'review-incompatible');
    assert.equal(persisted.doc.getXmlFragment('default').length, 0);
    const old = await serve(true);
    const modernOnOld = connect(old, wire('editor'));
    await until(() => modernOnOld.status.synced);
    // A reconnect uses the same token: no HTTP dependency or authentication failure.
    const initialConnections = modernOnOld.status.connections;
    modernOnOld.provider.configuration.websocketProvider.disconnect();
    await until(() => modernOnOld.provider.configuration.websocketProvider.status === 'disconnected');
    await modernOnOld.provider.configuration.websocketProvider.connect();
    await until(() => modernOnOld.status.connections > initialConnections);
    text(modernOnOld.doc).insert(0, 'Reconnected. ');
    await until(() => old.server.hocuspocus.documents.get('plain').getXmlFragment('default').toString().includes('Reconnected.'));
    assert.equal(modernOnOld.status.denied, false);

    // Every modern role is blocked from uploading a format while an old viewer is present.
    for (const role of ['host', 'editor', 'viewer', 'suggester']) {
      const room = `blocked-${role}`;
      const older = connect(modern, 'viewer', room);
      await until(() => older.status.synced);
      const writer = connect(modern, wire(role), room);
      await until(() => writer.status.synced);
      propose(writer.doc);
      await until(() => writer.status.closed === 'review-incompatible');
      assert.equal(text(older.doc).toDelta().some((op) => op.attributes?.suggestionFormat), false);
      assert.equal(text(older.doc).toDelta().map((op) => op.insert).join(''), 'Keep every word.');
    }
    propose(host.doc);
    await until(() => modern.server.hocuspocus.documents.get('plain').getXmlFragment('default').toString().includes('suggestionFormat'));
    for (const role of ['host', 'editor', 'viewer', 'suggester']) {
      const unsupported = connect(modern, role);
      await until(() => unsupported.status.denied);
      assert.equal(unsupported.doc.getXmlFragment('default').length, 0);
    }
    const peer = connect(modern, wire('editor'));
    await until(() => peer.status.synced);
    assert.ok(peer.doc.getXmlFragment('default').toString().includes('suggestionFormat'));
    console.log('PASS: four legacy roles sync ordinary scripts; new client syncs/reconnects on old server; every role is gated with legacy peers; unsafe joins receive no script; modern peers retain reviews.');
  } finally {
    for (const client of live) { client.stop(); client.doc.destroy(); }
    for (const server of servers) await server.destroy();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

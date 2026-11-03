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
// Run the actual client undo guard against this fixture's Yjs instance.
const fs = require('node:fs');
const undoExports = {};
const undoCode = front('typescript').transpileModule(fs.readFileSync(path.join(root, 'frontend/src/editor/reviewUndo.ts'), 'utf8'), { compilerOptions: { module: front('typescript').ModuleKind.CommonJS, target: front('typescript').ScriptTarget.ES2022 } }).outputText;
new Function('require', 'exports', undoCode)(front, undoExports);
const { guardReviewUndo } = undoExports;
const { updateInMessage } = back('./dist/services/suggestionGuard.js');
const { ReviewGate, supportsReview, REVIEW_REFUSED_REASON } = back('./dist/services/reviewProtocol.js');
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
          // Match production's persisted-state check before loading/syncing a room.
          else if (documentName === 'persisted') {
            const saved = new ServerY.Doc();
            try {
              const node = new ServerY.XmlElement('action'); const text = new ServerY.XmlText();
              text.insert(0, 'Keep every word.'); text.format(0, 4, { suggestionFormat: { id: 'saved' } });
              node.insert(0, [text]); saved.getXmlFragment('default').insert(0, [node]);
              gate.checkClient(ServerY, saved, capable);
            } finally { saved.destroy(); }
          }
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
    onAuthenticationFailed: ({ reason }) => { status.denied = true; status.reason = reason; provider.configuration.websocketProvider.disconnect(); },
    onSynced: ({ state }) => { status.synced = state; },
    onClose: ({ event }) => {
      if (event.reason) status.closed = event.reason;
      if (event.reason === REVIEW_REFUSED_REASON) provider.configuration.websocketProvider.disconnect();
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
    await until(() => persisted.status.denied);
    assert.equal(persisted.status.reason, REVIEW_REFUSED_REASON);
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
      await until(() => writer.status.closed === REVIEW_REFUSED_REASON);
      assert.equal(text(older.doc).toDelta().some((op) => op.attributes?.suggestionFormat), false);
      assert.equal(text(older.doc).toDelta().map((op) => op.insert).join(''), 'Keep every word.');
    }
    // Resolving a proposal permits a legacy join; undo must not restore it
    // or close the writer's socket while the legacy peer is still there.
    const undoWriter = connect(modern, wire('editor'), 'undo');
    await until(() => undoWriter.status.synced);
    const history = new Y.UndoManager(undoWriter.doc.getXmlFragment('default'), { captureTimeout: 0 });
    let formatAllowed = true; let undoBlocked = 0;
    const restoreUndo = guardReviewUndo(history, () => formatAllowed, () => { undoBlocked++; });
    propose(undoWriter.doc);
    const roomText = () => modern.server.hocuspocus.documents.get('undo').getXmlFragment('default').get(0).get(0);
    await until(() => roomText().toDelta().some(op => op.attributes?.suggestionFormat));
    text(undoWriter.doc).format(0, 4, { suggestionFormat: null });
    await until(() => !roomText().toDelta().some(op => op.attributes?.suggestionFormat));
    const undoLegacy = connect(modern, 'viewer', 'undo');
    await until(() => undoLegacy.status.synced);
    formatAllowed = false;
    assert.equal(history.undo(), null);
    assert.equal(undoBlocked, 1);
    text(undoWriter.doc).insert(text(undoWriter.doc).length, ' Still syncing.');
    await until(() => text(undoLegacy.doc).toDelta().some(op => String(op.insert).includes('Still syncing.')));
    assert.equal(undoWriter.status.closed, '');
    assert.equal(undoLegacy.status.closed, '');
    assert.equal(text(undoLegacy.doc).toDelta().some(op => op.attributes?.suggestionFormat), false);
    undoLegacy.stop();
    await until(() => !modern.gate.hasLegacy('undo'));
    formatAllowed = true;
    history.undo(); history.undo();
    await until(() => roomText().toDelta().some(op => op.attributes?.suggestionFormat));
    restoreUndo(); history.destroy();

    propose(host.doc);
    await until(() => modern.server.hocuspocus.documents.get('plain').getXmlFragment('default').toString().includes('suggestionFormat'));
    for (const role of ['host', 'editor', 'viewer', 'suggester']) {
      const unsupported = connect(modern, role);
      await until(() => unsupported.status.denied);
      assert.equal(unsupported.doc.getXmlFragment('default').length, 0);
      assert.equal(unsupported.status.reason, REVIEW_REFUSED_REASON);
    }
    const peer = connect(modern, wire('editor'));
    await until(() => peer.status.synced);
    assert.ok(peer.doc.getXmlFragment('default').toString().includes('suggestionFormat'));
    console.log('PASS: four legacy roles sync ordinary scripts; new client syncs/reconnects on old server; every role is gated with legacy peers; unsafe joins receive no script; modern peers retain reviews; blocked undo keeps both sockets and subsequent typing synchronized.');
  } finally {
    for (const client of live) { client.stop(); client.doc.destroy(); }
    for (const server of servers) await server.destroy();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

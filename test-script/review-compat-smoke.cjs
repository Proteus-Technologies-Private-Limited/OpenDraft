/** Run after `cd collab-server && npm run build` and installing both components.
 * Real Hocuspocus sockets: no mocked provider/auth/sync implementation.
 */
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
const { requireReviewClient, REVIEW_PROTOCOL } = back(
  './dist/services/reviewProtocol.js',
);
const envelope = (token) =>
  `od-review.${REVIEW_PROTOCOL}.${encodeURIComponent(token)}`;
const live = [];
async function serve(legacy) {
  let loads = 0;
  const server = new Server({
    port: 0,
    address: '127.0.0.1',
    stopOnSignals: false,
    debounce: 10,
    maxDebounce: 20,
    name: 'Review compatibility test',
    quiet: true,
    async onAuthenticate({ token }) {
      const credential = legacy ? token : requireReviewClient(token);
      // Match legacy's real plain/compound invite parsing. A new envelope
      // must not expose a valid invite even if HTTP and WS hit different nodes.
      const invite = credential.includes('|')
        ? credential
            .split('|')
            .find((part) => part.startsWith('invite:'))
            ?.slice(7)
        : credential;
      if (!['host', 'editor', 'viewer', 'suggester'].includes(invite))
        throw { reason: 'Invalid invite' };
      return { role: invite };
    },
    async onLoadDocument({ document }) {
      loads++;
      const action = new ServerY.XmlElement('action');
      const text = new ServerY.XmlText();
      text.insert(0, 'Keep every word.', {
        suggestionFormat: {
          id: 'pending',
          by: 'Ann',
          at: 1,
          format: 'bold',
          before: false,
          after: true,
        },
      });
      action.insert(0, [text]);
      document.getXmlFragment('default').insert(0, [action]);
      return document;
    },
  });
  await server.listen();
  return { server, url: server.webSocketURL, loads: () => loads };
}
function connect(server, token) {
  const doc = new Y.Doc();
  let provider;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Client did not authenticate or sync')),
      5000,
    );
    provider = new HocuspocusProvider({
      url: server.url,
      name: 'screenplay',
      document: doc,
      token,
      WebSocketPolyfill: WebSocket,
      onAuthenticationFailed: ({ reason }) => {
        provider.configuration.websocketProvider.disconnect();
        clearTimeout(timer);
        resolve({ accepted: false, reason });
      },
      onSynced: ({ state }) => {
        if (state) {
          clearTimeout(timer);
          resolve({ accepted: true });
        }
      },
    });
  });
  live.push({ provider, doc });
  return { doc, result };
}
(async () => {
  const modern = await serve(false),
    old = await serve(true);
  try {
    const compatible = connect(modern, envelope('host'));
    assert.equal((await compatible.result).accepted, true);
    assert.match(
      compatible.doc.getXmlFragment('default').toString(),
      /Keep every word\./,
    );
    const before = compatible.doc.getXmlFragment('default').toString();
    for (const role of ['host', 'editor', 'viewer', 'suggester']) {
      const client = connect(modern, role);
      const denied = await client.result;
      assert.equal(denied.accepted, false);
      assert.match(denied.reason, /Update OpenDraft/);
      assert.equal(client.doc.getXmlFragment('default').length, 0);
    }
    assert.equal(modern.loads(), 1);
    assert.equal(compatible.doc.getXmlFragment('default').toString(), before);
    const newOnOld = connect(old, envelope('editor'));
    assert.equal((await newOnOld.result).accepted, false);
    assert.equal(newOnOld.doc.getXmlFragment('default').length, 0);
    assert.equal(old.loads(), 0);
    const peer = connect(modern, envelope('editor'));
    assert.equal((await peer.result).accepted, true);
    assert.match(
      peer.doc.getXmlFragment('default').toString(),
      /Keep every word\./,
    );
    console.log(
      JSON.stringify({
        protocol: REVIEW_PROTOCOL,
        legacyRolesDenied: 4,
        compatiblePeersSynced: 2,
        newClientOldServerDenied: true,
        sourceTextPreserved: true,
      }),
    );
  } finally {
    for (const { provider, doc } of live) {
      provider.configuration.websocketProvider.disconnect();
      provider.destroy();
      doc.destroy();
    }
    await modern.server.destroy();
    await old.server.destroy();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

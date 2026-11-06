// Holds live collaboration connections open against a collab server so the
// admin console's Collaboration page has something to show.
//   BASE=http://localhost:4100 EMAIL=... PASSWORD=... HOLD=120 node test-script/admin_collab_session.mjs
import { createRequire } from 'module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const WebSocket = require('ws');

const { BASE = 'http://localhost:4100', EMAIL, PASSWORD, HOLD = '120' } = process.env;
if (!EMAIL || !PASSWORD) { console.error('EMAIL and PASSWORD are required'); process.exit(1); }

async function json(path, init) {
  const r = await fetch(BASE + path, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
}

try {
  const { accessToken } = await json('/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const project_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const script_id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const documentName = `test-script--${project_id}--${script_id}`;
  const invite = (name, role) => json('/api/collab/invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ project_id, script_id, collaborator_name: name, role }),
  });
  const invites = [await invite('Alice (test)', 'editor'), await invite('Bob (test)', 'viewer'), await invite('Carol (test, not joined)', 'suggester')];

  const providers = invites.slice(0, 2).map((i) => new HocuspocusProvider({
    url: BASE.replace(/^http/, 'ws'), name: documentName, document: new Y.Doc(),
    token: `jwt:${accessToken}|invite:${i.token}`, WebSocketPolyfill: WebSocket,
    onAuthenticationFailed: ({ reason }) => console.error('auth failed:', reason),
    onConnect: () => console.log('connected:', i.collaborator_name),
  }));
  console.log(`holding ${providers.length} live connections for ${HOLD}s`);
  await new Promise((r) => setTimeout(r, Number(HOLD) * 1000));
  providers.forEach((p) => p.destroy());
  process.exit(0);
} catch (err) {
  console.error('test failed:', err.message);
  process.exit(1);
}

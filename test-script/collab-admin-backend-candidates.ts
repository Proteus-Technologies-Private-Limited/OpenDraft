/**
 * The admin console's calls to the Python backend (collab-server/src/routes/admin.ts).
 *
 * Without BACKEND_URL the first address tried is a guess (this site's address
 * minus "collab."). A 404 from that address used to end the search for a POST,
 * so a restore never reached the real backend when the guess was another
 * site. A 404 now only counts once the address has shown it is the backend.
 *
 *   cd collab-server && NODE_PATH=$PWD/node_modules JWT_SECRET=test ADMIN_EMAILS=a@example.com \
 *     npx ts-node -P tsconfig.json --transpile-only ../test-script/collab-admin-backend-candidates.ts
 */
import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { callBackend, isOpenDraftBackend } from '../collab-server/src/routes/admin';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function json(res: http.ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function serve(handler: Handler): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/api`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Some other site: every path is an HTML 404. */
const otherSite: Handler = (_req, res) => {
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<h1>Not found</h1>');
};

/** The OpenDraft backend, as far as these calls go. */
function backend(restore: (res: http.ServerResponse) => void): Handler {
  return (req, res) => {
    if (req.method === 'GET' && req.url === '/api/admin/plugins' && !req.headers.authorization) {
      json(res, 401, { detail: 'Admin token required' });
    } else if (req.method === 'POST' && req.url?.endsWith('/restore')) {
      restore(res);
    } else {
      json(res, 404, { detail: 'Not Found' });
    }
  };
}

async function main(): Promise<void> {
  const other = await serve(otherSite);
  const ok = await serve(backend((res) => json(res, 200, { restored: { kind: 'project', restoredProjectId: 'night-shift-2' } })));
  const gone = await serve(backend((res) => json(res, 404, { detail: 'That item is no longer in the trash' })));
  const bad = await serve(backend((res) => json(res, 400, { detail: 'Invalid trash entry' })));
  const path = '/admin/accounts/u1/trash/e1/restore';
  try {
    assert.strictEqual(await isOpenDraftBackend(other.base), false, 'another site is not the backend');
    assert.strictEqual(await isOpenDraftBackend(ok.base), true, 'the backend identifies itself');

    let r = await callBackend(path, 't', [other.base, ok.base], 'POST');
    assert.ok(r.ok, `a 404 from another site must not stop the search: ${JSON.stringify(r)}`);
    assert.strictEqual(r.ok && r.source, ok.base);

    r = await callBackend(path, 't', [other.base, gone.base], 'POST');
    assert.ok(!r.ok && r.status === 404, `the backend's own 404 is the answer: ${JSON.stringify(r)}`);
    assert.strictEqual(!r.ok && r.detail, 'That item is no longer in the trash');

    r = await callBackend(path, 't', [gone.base, ok.base], 'POST');
    assert.ok(!r.ok && r.status === 404, 'a 404 from a confirmed backend is not retried elsewhere');

    r = await callBackend(path, 't', [bad.base, ok.base], 'POST');
    assert.ok(!r.ok && r.status === 400 && r.detail === 'Invalid trash entry', `a 400 comes back with its reason: ${JSON.stringify(r)}`);

    r = await callBackend(path, 't', [other.base], 'POST');
    assert.ok(!r.ok && r.status === undefined, 'no backend found leaves no status, so the route answers 502');
    assert.ok(!r.ok && /not the OpenDraft backend/.test(r.error), r.ok ? '' : r.error);

    console.log('collab-admin-backend-candidates: all checks passed');
  } finally {
    await Promise.all([other.close(), ok.close(), gone.close(), bad.close()]);
  }
}

main().catch((err) => {
  console.error('collab-admin-backend-candidates FAILED:', err);
  process.exit(1);
});

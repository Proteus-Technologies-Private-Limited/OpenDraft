/**
 * End-to-end check of the collab server's auth flows over HTTP:
 * register → verify email → refresh (rotation, single use) → logout →
 * forgot password → the emailed link → reset password → sign in.
 *
 * Covers issue #158 (reset links pointed at http://localhost:5173 because
 * APP_URL never reached the server) and discussion #147 (refresh tokens are
 * now looked up by index).
 *
 * Starts its own collab server on a spare port with a throwaway database, and
 * a tiny local SMTP catcher so no real email is sent — every SMTP_* variable
 * is overridden, which also keeps dotenv from loading the real ones in
 * collab-server/.env. Does not touch the dev servers.
 *
 *   cd collab-server && NODE_PATH=$PWD/node_modules \
 *     npx ts-node -P tsconfig.json --transpile-only ../test-script/collab-auth-e2e.ts
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

const APP_URL = 'https://app.example.test';
const COLLAB_DIR = path.resolve(__dirname, '../collab-server');

// ── Local SMTP catcher ──

interface CaughtMail { to: string; body: string }

function startSmtpCatcher(inbox: CaughtMail[]): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let rcpt = '';
    let data = '';
    socket.write('220 catcher ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            inbox.push({ to: rcpt, body: data });
            data = '';
            socket.write('250 OK queued\r\n');
          } else {
            data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-catcher\r\n250 SIZE 10485760\r\n');
        else if (cmd === 'HELO') socket.write('250 catcher\r\n');
        else if (cmd === 'RCPT') { rcpt = line.replace(/^RCPT TO:\s*/i, '').replace(/[<>]/g, ''); socket.write('250 OK\r\n'); }
        else if (cmd === 'DATA') { inData = true; socket.write('354 go ahead\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => { /* client hung up */ });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Undo quoted-printable soft breaks and =XX escapes so links read whole. */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** A MIME entity's body, decoded per its own Content-Transfer-Encoding, with
 *  multipart children decoded recursively and joined. */
function decodeMime(entity: string): string {
  const split = entity.search(/\n\r?\n/);
  const head = split >= 0 ? entity.slice(0, split) : entity;
  const body = split >= 0 ? entity.slice(split).replace(/^\n\r?\n/, '') : '';
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  const boundary = unfolded.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  if (/content-type:\s*multipart\//i.test(unfolded) && boundary) {
    return body
      .split(`--${boundary}`)
      .slice(1)
      .filter((part) => !part.startsWith('--'))
      .map((part) => decodeMime(part.replace(/^\r?\n/, '')))
      .join('\n');
  }
  const encoding = unfolded.match(/content-transfer-encoding:\s*([\w-]+)/i)?.[1]?.toLowerCase();
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  return body;
}

/** First link in the decoded email matching `pattern`. */
function findLink(raw: string, pattern: RegExp): string | undefined {
  return decodeMime(raw).match(pattern)?.[0]?.replace(/&amp;/g, '&');
}

async function waitForMail(inbox: CaughtMail[], to: string, count: number): Promise<CaughtMail> {
  for (let i = 0; i < 100; i++) {
    const mine = inbox.filter((m) => m.to === to);
    if (mine.length >= count) return mine[count - 1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No email #${count} for ${to} within 10 s`);
}

// ── Collab server under test ──

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function startCollab(port: number, smtpPort: number, dataDir: string, log: string[]): Promise<ChildProcess> {
  const child = spawn('npx', ['ts-node', '--transpile-only', 'src/server.ts'], {
    cwd: COLLAB_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      DB_TYPE: 'sqlite',
      JWT_SECRET: 'e2e-test-secret',
      APP_URL,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: 'noreply@example.test',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (d) => log.push(d.toString()));
  child.stderr!.on('data', (d) => log.push(d.toString()));

  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`collab server exited early:\n${log.join('')}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`collab server did not come up within 30 s:\n${log.join('')}`);
}

// ── Test ──

async function main(): Promise<void> {
  const inbox: CaughtMail[] = [];
  const smtp = await startSmtpCatcher(inbox);
  const smtpPort = (smtp.address() as net.AddressInfo).port;
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendraft-e2e-'));
  const log: string[] = [];
  let collab: ChildProcess | null = null;

  const base = `http://127.0.0.1:${port}`;
  const post = async (url: string, body: unknown, token?: string) => {
    const res = await fetch(`${base}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json };
  };

  try {
    collab = await startCollab(port, smtpPort, dataDir, log);
    console.log(`collab server up on :${port} (db ${dataDir})`);

    const email = 'e2e-writer@example.test';
    const password = 'FirstPass123';
    const device = { deviceId: 'e2e-device-0001', deviceName: 'E2E laptop', platform: 'test' };

    // Register; the verification email carries a magic link built from APP_URL.
    const reg = await post('/auth/register', { email, password, displayName: 'E2E Writer', device });
    assert.strictEqual(reg.status, 201, `register: ${JSON.stringify(reg.json)}`);
    const verifyMail = (await waitForMail(inbox, email, 1)).body;
    const verifyLink = findLink(verifyMail, /https?:\/\/[^\s"<>]+\/verify\?[^\s"<>]+/);
    assert.ok(verifyLink, 'verification email should contain a link');
    assert.ok(verifyLink.startsWith(`${APP_URL}/verify?`), `verification link should use APP_URL, got ${verifyLink}`);
    assert.ok(!verifyMail.includes('localhost'), 'verification email must not mention localhost');
    const code = new URL(verifyLink).searchParams.get('code')!;
    assert.match(code, /^\d{6}$/, `verification code should be 6 digits, got ${code}`);
    const verified = await post('/auth/verify-email', { code }, reg.json.accessToken);
    assert.strictEqual(verified.status, 200, `verify-email: ${JSON.stringify(verified.json)}`);
    console.log('✓ register + verification email link uses APP_URL');

    // Refresh rotates, and a spent token is refused.
    const r1 = await post('/auth/refresh', { refreshToken: reg.json.refreshToken });
    assert.strictEqual(r1.status, 200, `refresh: ${JSON.stringify(r1.json)}`);
    assert.ok(r1.json.accessToken && r1.json.refreshToken);
    const reused = await post('/auth/refresh', { refreshToken: reg.json.refreshToken });
    assert.strictEqual(reused.status, 401, 'a spent refresh token must be refused');
    const garbage = await post('/auth/refresh', { refreshToken: 'not-a-token' });
    assert.strictEqual(garbage.status, 401);
    console.log('✓ refresh rotates; spent and malformed tokens get 401');

    // Concurrent refreshes of one token: exactly one wins.
    const race = await Promise.all([
      post('/auth/refresh', { refreshToken: r1.json.refreshToken }),
      post('/auth/refresh', { refreshToken: r1.json.refreshToken }),
    ]);
    const winners = race.filter((r) => r.status === 200);
    assert.strictEqual(winners.length, 1, `exactly one concurrent refresh should win, got ${race.map((r) => r.status)}`);
    const live = winners[0].json;
    console.log('✓ concurrent refresh of one token: one 200, one 401');

    // The new access token works.
    const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${live.accessToken}` } });
    assert.strictEqual(me.status, 200);

    // Collab invite with a long expiry is honoured (host token lifetime).
    const invite = await post('/api/collab/invite', {
      project_id: 'p1', script_id: 's1', collaborator_name: 'Host', role: 'editor', expires_in_hours: 720,
    }, live.accessToken);
    assert.strictEqual(invite.status, 201, `invite: ${JSON.stringify(invite.json)}`);
    const hours = (Date.parse(invite.json.expires_at) - Date.now()) / 3_600_000;
    assert.ok(hours > 719 && hours <= 720, `invite should last ~720 h, got ${hours.toFixed(2)}`);
    console.log('✓ 30-day collab invite expires in 30 days');

    // Logout revokes the refresh token.
    const out = await post('/auth/logout', { refreshToken: live.refreshToken });
    assert.strictEqual(out.status, 200, `logout: ${JSON.stringify(out.json)}`);
    const afterLogout = await post('/auth/refresh', { refreshToken: live.refreshToken });
    assert.strictEqual(afterLogout.status, 401, 'refresh after logout must be refused');
    console.log('✓ logout revokes the refresh token');

    // Forgot password: the emailed link must point at APP_URL (issue #158).
    const forgot = await post('/auth/forgot-password', { email });
    assert.strictEqual(forgot.status, 200, `forgot-password: ${JSON.stringify(forgot.json)}`);
    const resetMail = (await waitForMail(inbox, email, 2)).body;
    const resetLink = findLink(resetMail, /https?:\/\/[^\s"<>]+\/reset-password\?token=[^\s"<>]+/);
    assert.ok(resetLink, 'reset email should contain a link');
    assert.ok(resetLink.startsWith(`${APP_URL}/reset-password?token=`), `reset link should use APP_URL, got ${resetLink}`);
    assert.ok(!resetMail.includes('localhost'), 'reset email must not mention localhost');
    console.log(`✓ reset email links to ${APP_URL}/reset-password`);

    // The link's token resets the password, once.
    const token = new URL(resetLink).searchParams.get('token')!;
    const newPassword = 'SecondPass456';
    const reset = await post('/auth/reset-password', { token, newPassword });
    assert.strictEqual(reset.status, 200, `reset-password: ${JSON.stringify(reset.json)}`);
    const resetAgain = await post('/auth/reset-password', { token, newPassword: 'ThirdPass789' });
    assert.strictEqual(resetAgain.status, 400, 'a used reset link must be refused');

    const oldLogin = await post('/auth/login', { email, password, device });
    assert.strictEqual(oldLogin.status, 401, 'old password must stop working');
    const newLogin = await post('/auth/login', { email, password: newPassword, device });
    assert.strictEqual(newLogin.status, 200, `login with new password: ${JSON.stringify(newLogin.json)}`);
    assert.ok(newLogin.json.refreshToken);
    const postResetRefresh = await post('/auth/refresh', { refreshToken: newLogin.json.refreshToken });
    assert.strictEqual(postResetRefresh.status, 200);
    console.log('✓ reset link works once; new password signs in; refresh works after');

    console.log('\nAll collab auth end-to-end checks passed');
  } finally {
    if (collab && collab.exitCode === null) collab.kill('SIGTERM');
    smtp.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAILED:', err);
    process.exit(1);
  },
);

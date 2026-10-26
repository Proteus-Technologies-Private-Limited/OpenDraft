/**
 * Refresh-token lookup in the collab server (discussion #147).
 *
 * Rotating a refresh token used to bcrypt-compare it against every live row,
 * synchronously; with a few hundred live sessions one refresh blocked the
 * server for longer than the backend's 15 s proxy timeout. Tokens are now
 * stored as SHA-256 and found by index, with an async bcrypt fallback for rows
 * issued before the change.
 *
 * Runs against a throwaway SQLite database:
 *   cd collab-server && NODE_PATH=$PWD/node_modules DATA_DIR=$(mktemp -d) JWT_SECRET=test \
 *     npx ts-node -P tsconfig.json --transpile-only ../test-script/collab-refresh-token-lookup.ts
 */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { initDB, getDB } from '../collab-server/src/db';
import * as tokenService from '../collab-server/src/services/tokenService';

const LEGACY_ROWS = 40;

async function insertLegacyToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('base64url');
  const now = new Date();
  await getDB().run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at, device_id)
     VALUES (?, ?, ?, ?, 0, ?, NULL)`,
    [uuidv4(), userId, bcrypt.hashSync(token, 4), new Date(now.getTime() + 86_400_000).toISOString(), now.toISOString()],
  );
  return token;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const out = await fn();
  console.log(`  ${label}: ${Date.now() - start} ms`);
  return out;
}

async function main(): Promise<void> {
  if (!process.env.DATA_DIR) throw new Error('Set DATA_DIR to an empty temp directory');
  await initDB();
  const db = getDB();

  const userId = uuidv4();
  await db.run(
    `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, 'lookup-test@example.com', 'x', 'Lookup Test', new Date().toISOString(), new Date().toISOString()],
  );

  // Oldest legacy token first, so the "newest first" scan reaches it last.
  const oldestLegacy = await insertLegacyToken(userId);
  for (let i = 1; i < LEGACY_ROWS; i++) await insertLegacyToken(userId);
  console.log(`Seeded ${LEGACY_ROWS} legacy bcrypt rows`);

  // 1. A newly issued token is stored as SHA-256 and rotates by index.
  const { token: fresh } = await tokenService.generateRefreshToken(userId, 'device-a');
  const stored = await db.get<{ token_hash: string }>(
    'SELECT token_hash FROM refresh_tokens WHERE token_hash = ?',
    [crypto.createHash('sha256').update(fresh).digest('hex')],
  );
  assert.ok(stored, 'new token should be stored as its SHA-256');
  const rotated = await timed('rotate new token', () => tokenService.rotateRefreshToken(fresh));
  assert.ok(rotated, 'new token should rotate');
  assert.strictEqual(rotated.userId, userId);
  assert.notStrictEqual(rotated.refreshToken, fresh);

  // 2. Single use: the spent token is refused.
  assert.strictEqual(await tokenService.rotateRefreshToken(fresh), null, 'spent token must be refused');

  // 3. Two concurrent rotations of one token: exactly one wins.
  const racing = rotated.refreshToken;
  const results = await Promise.all([
    tokenService.rotateRefreshToken(racing),
    tokenService.rotateRefreshToken(racing),
  ]);
  assert.strictEqual(results.filter(Boolean).length, 1, 'only one concurrent rotation may succeed');

  // 4. The device binding survives rotation.
  const winner = results.find(Boolean)!;
  const row = await db.get<{ device_id: string }>(
    'SELECT device_id FROM refresh_tokens WHERE token_hash = ?',
    [crypto.createHash('sha256').update(winner.refreshToken).digest('hex')],
  );
  assert.strictEqual(row?.device_id, 'device-a');

  // 5. A pre-upgrade bcrypt token still rotates, into a SHA-256 one.
  const fromLegacy = await timed('rotate oldest legacy token', () => tokenService.rotateRefreshToken(oldestLegacy));
  assert.ok(fromLegacy, 'legacy token should still rotate');
  assert.strictEqual(await tokenService.rotateRefreshToken(oldestLegacy), null, 'spent legacy token must be refused');
  assert.ok(await tokenService.rotateRefreshToken(fromLegacy.refreshToken), 'token issued from a legacy one should rotate');

  // 6. Something that is not a token shape is refused without touching bcrypt.
  assert.strictEqual(await timed('reject malformed token', () => tokenService.rotateRefreshToken('x')), null);

  // 7. The event loop keeps turning during a legacy scan.
  let ticks = 0;
  const ticker = setInterval(() => { ticks++; }, 5);
  const unknown = crypto.randomBytes(48).toString('base64url');
  assert.strictEqual(await timed('full legacy scan, unknown token', () => tokenService.rotateRefreshToken(unknown)), null);
  clearInterval(ticker);
  console.log(`  event-loop ticks during scan: ${ticks}`);
  assert.ok(ticks > 0, 'legacy scan must not block the event loop');

  // 8. Logout revokes by lookup.
  const { token: toRevoke } = await tokenService.generateRefreshToken(userId);
  assert.strictEqual(await tokenService.revokeRefreshToken(toRevoke), true);
  assert.strictEqual(await tokenService.revokeRefreshToken(toRevoke), false);
  assert.strictEqual(await tokenService.rotateRefreshToken(toRevoke), null);

  console.log('All refresh-token lookup checks passed');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('FAILED:', err);
    process.exit(1);
  },
);

import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db';
import { config } from '../config';

interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
}

export function generateAccessToken(userId: string, email: string): string {
  const payload: AccessTokenPayload = { sub: userId, email, type: 'access' };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtAccessExpiry as any });
}

interface RefreshTokenMatch {
  id: string;
  user_id: string;
  device_id: string | null;
}

/** 48 random bytes, base64url-encoded — the only shape we ever issue. */
const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{64}$/;
/** bcrypt hashes start with `$2`. Only rows issued before tokens were stored
 *  as SHA-256 carry one. */
const LEGACY_HASH_PATTERN = '$2%';

/**
 * How a refresh token is stored. The token is 384 random bits, so a fast
 * hash is as resistant to a database leak as bcrypt — there is nothing to
 * brute-force — and, unlike bcrypt, it is deterministic, so the token can be
 * found by index. Comparing against every live row with bcrypt cost ~60 ms a
 * row on the event loop and stalled the whole server once a few hundred
 * sessions were live.
 */
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** The live (unrevoked, unexpired) row a refresh token belongs to, if any. */
async function findLiveRefreshToken(token: string): Promise<RefreshTokenMatch | null> {
  if (!REFRESH_TOKEN_PATTERN.test(token)) return null;
  const db = getDB();
  const now = new Date().toISOString();

  const row = await db.get<RefreshTokenMatch>(
    `SELECT id, user_id, device_id FROM refresh_tokens
     WHERE token_hash = ? AND revoked = 0 AND expires_at > ?`,
    [hashRefreshToken(token), now],
  );
  if (row) return row;

  // Tokens issued before the switch are bcrypt-hashed and can only be found
  // by comparing. They stop being issued with this change and expire within
  // the refresh lifetime, after which this query returns nothing. Newest
  // first: an active session's token is among the most recently issued.
  // The async compare yields between rounds so other requests keep moving.
  const legacy = await db.all<RefreshTokenMatch & { token_hash: string }>(
    `SELECT id, user_id, device_id, token_hash FROM refresh_tokens
     WHERE token_hash LIKE ? AND revoked = 0 AND expires_at > ?
     ORDER BY created_at DESC`,
    [LEGACY_HASH_PATTERN, now],
  );
  for (const candidate of legacy) {
    if (await bcrypt.compare(token, candidate.token_hash)) {
      return { id: candidate.id, user_id: candidate.user_id, device_id: candidate.device_id };
    }
  }
  return null;
}

/** Mark a token row revoked. False if something else revoked it first. */
async function claimRefreshToken(id: string): Promise<boolean> {
  const result = await getDB().run(
    'UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND revoked = 0',
    [id],
  );
  return result.changes > 0;
}

export async function generateRefreshToken(
  userId: string,
  deviceId: string | null = null,
): Promise<{ token: string; expiresAt: string }> {
  const db = getDB();
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashRefreshToken(token);
  const id = uuidv4();
  const now = new Date();

  // Parse refresh expiry (e.g. '7d' -> 7 days)
  const match = config.jwtRefreshExpiry.match(/^(\d+)([smhd])$/);
  let expiresMs = 7 * 24 * 60 * 60 * 1000; // default 7 days
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    expiresMs = num * (multipliers[unit] || 86400000);
  }

  const expiresAt = new Date(now.getTime() + expiresMs).toISOString();

  await db.run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at, device_id)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [id, userId, tokenHash, expiresAt, now.toISOString(), deviceId],
  );

  return { token, expiresAt };
}

export function verifyAccessToken(token: string): { sub: string; email: string } | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AccessTokenPayload;
    if (payload.type !== 'access') return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function rotateRefreshToken(oldToken: string): Promise<{ accessToken: string; refreshToken: string; userId: string } | null> {
  const db = getDB();

  const matchedRow = await findLiveRefreshToken(oldToken);
  if (!matchedRow) return null;

  // Single use: if a concurrent refresh already spent this token, refuse.
  if (!(await claimRefreshToken(matchedRow.id))) return null;

  // Look up user for new access token
  const user = await db.get<{ email: string }>('SELECT email FROM users WHERE id = ?', [matchedRow.user_id]);
  if (!user) return null;

  // Issue new pair, preserving the device binding so the new refresh token
  // is still attributable to the same device for the devices list / revoke.
  const accessToken = generateAccessToken(matchedRow.user_id, user.email);
  const { token: refreshToken } = await generateRefreshToken(matchedRow.user_id, matchedRow.device_id);

  return { accessToken, refreshToken, userId: matchedRow.user_id };
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const db = getDB();
  await db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [userId]);
}

export async function revokeRefreshToken(token: string): Promise<boolean> {
  const row = await findLiveRefreshToken(token);
  if (!row) return false;
  return claimRefreshToken(row.id);
}

import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db';
import type { PasswordResetRow } from '../db';

const TOKEN_TTL_MINUTES = 30;

export interface CreatedResetToken {
  token: string;
  expiresAt: string;
}

/**
 * Generate a single-use password-reset token for the given user.
 *
 * The raw token is high-entropy random; only its bcrypt hash is stored, so a
 * database leak doesn't yield working reset links. The caller emails the raw
 * value to the user. Previous outstanding resets for the same user are
 * invalidated so only one live link exists at a time.
 *
 * Per-route rate limiting (`veryStrictLimiter`) is the abuse defence; we don't
 * cap outstanding tokens here because invalidating-on-issue already keeps the
 * count at <= 1.
 */
export async function createResetToken(
  userId: string,
  ipAddress: string | null,
): Promise<CreatedResetToken> {
  const db = getDB();
  const now = new Date();
  const nowIso = now.toISOString();

  // Invalidate any earlier outstanding resets so only one link is live.
  await db.run(
    'UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0',
    [userId],
  );

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = bcrypt.hashSync(token, 10);
  const id = uuidv4();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  await db.run(
    `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used, created_at, ip_address)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [id, userId, tokenHash, expiresAt, nowIso, ipAddress],
  );

  return { token, expiresAt };
}

/**
 * Validate a reset token and atomically mark it used. Returns the owning
 * user_id on success, or null if the token is missing/expired/already used.
 *
 * We can't index on token_hash (bcrypt salts every hash), so we iterate over
 * the live rows and bcrypt-compare — same pattern as refresh_tokens. The set
 * is bounded by the rate limiter + per-user cap, so the cost stays small.
 */
export async function consumeResetToken(rawToken: string): Promise<string | null> {
  const db = getDB();
  const now = new Date().toISOString();

  const rows = await db.all<PasswordResetRow>(
    'SELECT * FROM password_resets WHERE used = 0 AND expires_at > ?',
    [now],
  );

  for (const row of rows) {
    if (bcrypt.compareSync(rawToken, row.token_hash)) {
      // Race-safe: only succeed if the row is still unused.
      const result = await db.run(
        'UPDATE password_resets SET used = 1 WHERE id = ? AND used = 0',
        [row.id],
      );
      if (result.changes === 0) return null;
      return row.user_id;
    }
  }

  return null;
}

/**
 * Garbage-collect expired or used reset rows older than `olderThanHours`.
 * Not wired into a scheduler yet; kept here for an operator-triggered cron.
 */
export async function purgeStaleResets(olderThanHours = 24): Promise<number> {
  const db = getDB();
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();
  const result = await db.run(
    'DELETE FROM password_resets WHERE expires_at < ? OR (used = 1 AND created_at < ?)',
    [cutoff, cutoff],
  );
  return result.changes;
}

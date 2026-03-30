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

export function generateRefreshToken(userId: string): { token: string; expiresAt: string } {
  const db = getDB();
  const token = crypto.randomBytes(48).toString('base64url');
  const tokenHash = bcrypt.hashSync(token, 10);
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

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, userId, tokenHash, expiresAt, now.toISOString());

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

export function rotateRefreshToken(oldToken: string): { accessToken: string; refreshToken: string; userId: string } | null {
  const db = getDB();
  const now = new Date().toISOString();

  // Find all non-revoked, non-expired refresh tokens
  const rows = db.prepare(
    'SELECT * FROM refresh_tokens WHERE revoked = 0 AND expires_at > ?'
  ).all(now) as Array<{ id: string; user_id: string; token_hash: string }>;

  // Find matching token
  let matchedRow: { id: string; user_id: string } | null = null;
  for (const row of rows) {
    if (bcrypt.compareSync(oldToken, row.token_hash)) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) return null;

  // Revoke old token
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(matchedRow.id);

  // Look up user for new access token
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(matchedRow.user_id) as { email: string } | undefined;
  if (!user) return null;

  // Issue new pair
  const accessToken = generateAccessToken(matchedRow.user_id, user.email);
  const { token: refreshToken } = generateRefreshToken(matchedRow.user_id);

  return { accessToken, refreshToken, userId: matchedRow.user_id };
}

export function revokeAllRefreshTokens(userId: string): void {
  const db = getDB();
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
}

export function revokeRefreshToken(token: string): boolean {
  const db = getDB();
  const now = new Date().toISOString();
  const rows = db.prepare(
    'SELECT * FROM refresh_tokens WHERE revoked = 0 AND expires_at > ?'
  ).all(now) as Array<{ id: string; token_hash: string }>;

  for (const row of rows) {
    if (bcrypt.compareSync(token, row.token_hash)) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
      return true;
    }
  }
  return false;
}

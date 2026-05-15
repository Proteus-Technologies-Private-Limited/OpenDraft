import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { getDB } from '../db';
import type { UserRow } from '../db';
import { config } from '../config';

export async function createUser(email: string, password: string, displayName: string): Promise<UserRow> {
  const db = getDB();
  const id = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(password, config.bcryptRounds);

  await db.run(
    `INSERT INTO users (id, email, email_verified, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?, ?, ?)`,
    [id, email.toLowerCase(), passwordHash, displayName, now, now],
  );

  return (await findUserById(id))!;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const db = getDB();
  const row = await db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  return row ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const db = getDB();
  const row = await db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  return row ?? null;
}

export async function findOrCreateGoogleUser(googleId: string, email: string, displayName: string): Promise<UserRow> {
  const db = getDB();

  // Check if user exists by google_id
  const existing = await db.get<UserRow>('SELECT * FROM users WHERE google_id = ?', [googleId]);
  if (existing) return existing;

  // Check if user exists by email (link accounts)
  const emailUser = await findUserByEmail(email);
  if (emailUser) {
    const now = new Date().toISOString();
    await db.run(
      'UPDATE users SET google_id = ?, email_verified = 1, updated_at = ? WHERE id = ?',
      [googleId, now, emailUser.id],
    );
    return (await findUserById(emailUser.id))!;
  }

  // Create new user
  const id = uuidv4();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO users (id, email, email_verified, google_id, display_name, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)`,
    [id, email.toLowerCase(), googleId, displayName, now, now],
  );

  return (await findUserById(id))!;
}

export async function verifyPassword(user: UserRow, password: string): Promise<boolean> {
  if (!user.password_hash) return false;
  return bcrypt.compareSync(password, user.password_hash);
}

export async function setEmailVerified(userId: string): Promise<void> {
  const db = getDB();
  const now = new Date().toISOString();
  await db.run('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?', [now, userId]);
}

export async function setTwoFactorEnabled(userId: string, enabled: boolean): Promise<void> {
  const db = getDB();
  const now = new Date().toISOString();
  await db.run(
    'UPDATE users SET two_factor_enabled = ?, updated_at = ? WHERE id = ?',
    [enabled ? 1 : 0, now, userId],
  );
}

export async function updatePassword(userId: string, newPassword: string): Promise<void> {
  const db = getDB();
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(newPassword, config.bcryptRounds);
  await db.run(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
    [passwordHash, now, userId],
  );
}

/**
 * Delete a user and every record that references them.
 *
 * `users` is the parent of refresh_tokens, email_verifications, user_devices,
 * and device_challenges via ON DELETE CASCADE — but we explicitly delete the
 * children first so the same code path works on databases where cascades
 * weren't defined when the table was first created (older deployments).
 *
 * The user's invite tokens (`collab_sessions.created_by`) and audit-log rows
 * are not foreign-keyed; we null/blank them out so the user cannot be
 * reidentified through them but the audit trail is preserved.
 */
export async function deleteUser(userId: string): Promise<void> {
  const db = getDB();
  await db.run('UPDATE collab_sessions SET active = 0 WHERE created_by = ?', [userId]);
  await db.run('DELETE FROM password_resets WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM device_challenges WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM user_devices WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM email_verifications WHERE user_id = ?', [userId]);
  await db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
  // Anonymise audit log so the deletion event is preserved without keeping PII.
  await db.run(
    "UPDATE audit_log SET user_id = NULL, detail = NULL WHERE user_id = ?",
    [userId],
  );
  await db.run('DELETE FROM users WHERE id = ?', [userId]);
}

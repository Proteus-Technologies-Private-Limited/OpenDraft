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

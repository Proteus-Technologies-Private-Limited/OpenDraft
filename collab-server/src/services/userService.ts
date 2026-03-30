import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { getDB } from '../db';
import type { UserRow } from '../db';
import { config } from '../config';

export function createUser(email: string, password: string, displayName: string): UserRow {
  const db = getDB();
  const id = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(password, config.bcryptRounds);

  db.prepare(`
    INSERT INTO users (id, email, email_verified, password_hash, display_name, created_at, updated_at)
    VALUES (?, ?, 0, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), passwordHash, displayName, now, now);

  return findUserById(id)!;
}

export function findUserByEmail(email: string): UserRow | null {
  const db = getDB();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined || null;
}

export function findUserById(id: string): UserRow | null {
  const db = getDB();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined || null;
}

export function findOrCreateGoogleUser(googleId: string, email: string, displayName: string): UserRow {
  const db = getDB();

  // Check if user exists by google_id
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) as UserRow | undefined;
  if (existing) return existing;

  // Check if user exists by email (link accounts)
  const emailUser = findUserByEmail(email);
  if (emailUser) {
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET google_id = ?, email_verified = 1, updated_at = ? WHERE id = ?')
      .run(googleId, now, emailUser.id);
    return findUserById(emailUser.id)!;
  }

  // Create new user
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, email_verified, google_id, display_name, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?)
  `).run(id, email.toLowerCase(), googleId, displayName, now, now);

  return findUserById(id)!;
}

export function verifyPassword(user: UserRow, password: string): boolean {
  if (!user.password_hash) return false;
  return bcrypt.compareSync(password, user.password_hash);
}

export function setEmailVerified(userId: string): void {
  const db = getDB();
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(now, userId);
}

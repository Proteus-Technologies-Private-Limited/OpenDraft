import { findUserByEmail, createUser, setEmailVerified } from '../services/userService';

/**
 * Seed a single demo user on startup so a fresh container has a working
 * login out of the box. Driven by env vars so production deployments can
 * leave it disabled (the default in non-Docker envs).
 *
 *   SEED_DEMO_USER          truthy to enable (default: off)
 *   SEED_DEMO_USER_EMAIL    email/login (default: demo@opendraft.local)
 *   SEED_DEMO_USER_PASSWORD password (REQUIRED if seeding is enabled)
 *   SEED_DEMO_USER_NAME     display name (default: Demo User)
 *
 * Idempotent: if a user with that email already exists, nothing happens
 * (we don't reset the password — a real user may have changed it).
 */
export async function seedDemoUser(): Promise<void> {
  const enabled = String(process.env.SEED_DEMO_USER || '').toLowerCase();
  if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes') return;

  const email = process.env.SEED_DEMO_USER_EMAIL || 'demo@opendraft.local';
  const password = process.env.SEED_DEMO_USER_PASSWORD;
  const displayName = process.env.SEED_DEMO_USER_NAME || 'Demo User';

  if (!password) {
    console.warn('[seedDemoUser] SEED_DEMO_USER is set but SEED_DEMO_USER_PASSWORD is empty — skipping.');
    return;
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    console.log(`[seedDemoUser] User ${email} already exists — skipping seed.`);
    return;
  }

  const user = await createUser(email, password, displayName);
  // Pre-verify so the demo user can log in even when SMTP-driven verification
  // is required for normal sign-ups.
  await setEmailVerified(user.id);
  console.log(`[seedDemoUser] Created demo user ${email}.`);
}

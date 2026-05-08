/**
 * Device tracking + new-device 2FA challenges.
 *
 * Each client (desktop, mobile, browser) generates a stable random device_id
 * and sends it with login. If the (user_id, device_id) pair has never been
 * seen, login is gated behind an emailed 6-digit code (see emailService).
 *
 * Devices are stored in `user_devices` and shown to the user in Settings so
 * they can review/revoke any session that doesn't look like theirs.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db';
import type { UserDeviceRow, DeviceChallengeRow } from '../db';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  userAgent?: string | null;
  platform?: string | null;
  ipAddress?: string | null;
}

const CHALLENGE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CHALLENGES_PER_USER_PER_HOUR = 10;

export async function findDevice(
  userId: string,
  deviceId: string,
): Promise<UserDeviceRow | null> {
  const db = getDB();
  const row = await db.get<UserDeviceRow>(
    'SELECT * FROM user_devices WHERE user_id = ? AND device_id = ?',
    [userId, deviceId],
  );
  return row ?? null;
}

export async function listDevices(userId: string): Promise<UserDeviceRow[]> {
  const db = getDB();
  return db.all<UserDeviceRow>(
    'SELECT * FROM user_devices WHERE user_id = ? ORDER BY last_seen_at DESC',
    [userId],
  );
}

export async function recordTrustedDevice(
  userId: string,
  info: DeviceInfo,
): Promise<UserDeviceRow> {
  const db = getDB();
  const existing = await findDevice(userId, info.deviceId);
  const now = new Date().toISOString();

  if (existing) {
    await db.run(
      `UPDATE user_devices
       SET device_name = ?, user_agent = ?, platform = ?, ip_address = ?,
           trusted = 1, last_seen_at = ?
       WHERE id = ?`,
      [
        info.deviceName,
        info.userAgent ?? null,
        info.platform ?? null,
        info.ipAddress ?? null,
        now,
        existing.id,
      ],
    );
    return (await findDevice(userId, info.deviceId))!;
  }

  const id = uuidv4();
  await db.run(
    `INSERT INTO user_devices
       (id, user_id, device_id, device_name, user_agent, platform, ip_address, trusted, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      userId,
      info.deviceId,
      info.deviceName,
      info.userAgent ?? null,
      info.platform ?? null,
      info.ipAddress ?? null,
      now,
      now,
    ],
  );
  return (await findDevice(userId, info.deviceId))!;
}

export async function touchDevice(
  userId: string,
  deviceId: string,
  ipAddress: string | null,
): Promise<void> {
  const db = getDB();
  const now = new Date().toISOString();
  await db.run(
    'UPDATE user_devices SET last_seen_at = ?, ip_address = ? WHERE user_id = ? AND device_id = ?',
    [now, ipAddress, userId, deviceId],
  );
}

export async function deleteDevice(userId: string, deviceId: string): Promise<boolean> {
  const db = getDB();
  // Revoke any refresh tokens tied to this device first.
  await db.run(
    'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ? AND device_id = ?',
    [userId, deviceId],
  );
  const result = await db.run(
    'DELETE FROM user_devices WHERE user_id = ? AND device_id = ?',
    [userId, deviceId],
  );
  return result.changes > 0;
}

export async function createDeviceChallenge(
  userId: string,
  info: DeviceInfo,
): Promise<{ challengeId: string; code: string } | null> {
  const db = getDB();
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  // Rate-limit: max challenges per user per hour to stop email-spam abuse.
  const recent = await db.all<{ id: string }>(
    'SELECT id FROM device_challenges WHERE user_id = ? AND created_at > ?',
    [userId, oneHourAgo],
  );
  if (recent.length >= MAX_CHALLENGES_PER_USER_PER_HOUR) {
    return null;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const id = uuidv4();
  const expiresAt = new Date(now.getTime() + CHALLENGE_EXPIRY_MS).toISOString();

  // Invalidate any older outstanding challenges for the same (user, device).
  await db.run(
    'UPDATE device_challenges SET used = 1 WHERE user_id = ? AND device_id = ? AND used = 0',
    [userId, info.deviceId],
  );

  await db.run(
    `INSERT INTO device_challenges
       (id, user_id, device_id, device_name, user_agent, platform, ip_address, code, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      userId,
      info.deviceId,
      info.deviceName,
      info.userAgent ?? null,
      info.platform ?? null,
      info.ipAddress ?? null,
      code,
      expiresAt,
      now.toISOString(),
    ],
  );

  return { challengeId: id, code };
}

export async function consumeDeviceChallenge(
  challengeId: string,
  code: string,
): Promise<DeviceChallengeRow | null> {
  const db = getDB();
  const now = new Date().toISOString();
  const row = await db.get<DeviceChallengeRow>(
    `SELECT * FROM device_challenges
     WHERE id = ? AND code = ? AND used = 0 AND expires_at > ?`,
    [challengeId, code, now],
  );
  if (!row) return null;

  await db.run('UPDATE device_challenges SET used = 1 WHERE id = ?', [row.id]);
  return row;
}

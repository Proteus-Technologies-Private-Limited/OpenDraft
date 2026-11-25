/**
 * Server-to-server routes. Not for browsers or apps.
 *
 * POST /internal/audit — the Python backend reports what a writer did with
 * their server-stored projects (created, renamed, deleted a project or script,
 * uploaded a file, saved or restored a version) so it lands in the same
 * audit_log, and the same admin-console timeline, as their sign-ins.
 *
 * The backend signs each call with the shared JWT secret: `type:
 * backend_audit`, audience `opendraft-collab-audit`, the account in `sub`,
 * alive at most two minutes. A user's own access token is refused, so a client
 * cannot write audit rows. Only the backend's own actions are accepted.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import { getDB } from '../db';
import * as auditService from '../services/auditService';

const router = Router();

export const BACKEND_AUDIT_TOKEN_TYPE = 'backend_audit';
export const BACKEND_AUDIT_AUDIENCE = 'opendraft-collab-audit';
const MAX_TOKEN_LIFETIME_SEC = 120;
const MAX_DETAIL_KEYS = 20;
const MAX_TEXT = 200;

// Generous: one busy backend sends every writer's events from one address.
const internalLimiter = rateLimit({
  windowMs: 60_000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many audit events' },
});

function clip(v: unknown): unknown {
  if (typeof v === 'string') return v.length > MAX_TEXT ? v.slice(0, MAX_TEXT - 1) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
  // Nested values are not expected; keep a short string of them.
  try { return clip(JSON.stringify(v)); } catch { return null; }
}

/** "Wendy MacBook (web)", without repeating a platform the name already contains. */
export function deviceLabel(name: string, platform: string | null | undefined): string {
  if (!platform || name.toLowerCase().includes(platform.toLowerCase())) return name;
  return `${name} (${platform})`;
}

/** Turn a user agent into "Chrome on macOS"-style text for support. */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  if (/OpenDraft|Tauri/i.test(ua)) return 'OpenDraft app';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || ua.slice(0, 60);
}

router.post('/audit', internalLimiter, async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token required' });
      return;
    }
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), config.jwtSecret, {
        algorithms: ['HS256'],
        audience: BACKEND_AUDIT_AUDIENCE,
      }) as jwt.JwtPayload;
    } catch (err) {
      res.status(401).json({ error: `Invalid token: ${(err as Error).message}` });
      return;
    }
    if (payload.type !== BACKEND_AUDIT_TOKEN_TYPE || typeof payload.sub !== 'string' || !payload.sub
      || typeof payload.exp !== 'number' || typeof payload.iat !== 'number'
      || payload.exp - payload.iat > MAX_TOKEN_LIFETIME_SEC) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const body = req.body ?? {};
    if (!auditService.isBackendAuditAction(body.action)) {
      res.status(400).json({ error: `Unknown action: ${String(body.action).slice(0, 40)}` });
      return;
    }

    const userId = payload.sub;
    const user = await getDB().get<{ id: string }>('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) {
      // The account was deleted while the event was on its way; nothing to attach it to.
      res.status(202).json({ status: 'ignored', reason: 'unknown account' });
      return;
    }

    const detail: Record<string, unknown> = {};
    if (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail)) {
      for (const [k, v] of Object.entries(body.detail).slice(0, MAX_DETAIL_KEYS)) detail[k.slice(0, 40)] = clip(v);
    }

    // Which device did it: the device's name as the account registered it,
    // else a short description of the browser.
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 128) : null;
    if (deviceId) {
      const device = await getDB().get<{ device_name: string; platform: string | null }>(
        'SELECT device_name, platform FROM user_devices WHERE user_id = ? AND device_id = ?',
        [userId, deviceId],
      );
      if (device) detail.device = deviceLabel(device.device_name, device.platform);
    }
    if (!detail.device) {
      const described = describeUserAgent(typeof body.userAgent === 'string' ? body.userAgent : null);
      if (described) detail.device = described;
    }

    const ip = typeof body.ip === 'string' && body.ip ? body.ip.slice(0, 64) : null;
    await auditService.logEvent(body.action, userId, null, detail, ip);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[internal] audit event failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

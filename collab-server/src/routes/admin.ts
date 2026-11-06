/**
 * Admin console — server health and who is signed in.
 *
 * Access is limited to the accounts listed in ADMIN_EMAILS. Admins sign in
 * with their ordinary account; there is no separate admin credential to leak.
 * With ADMIN_EMAILS unset the whole console answers 404.
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { getDB } from '../db';
import { verifyAccessToken, revokeAllRefreshTokens } from '../services/tokenService';
import * as liveStats from '../services/liveStats';
import * as auditService from '../services/auditService';
import { collectComponents } from '../services/componentStats';
import { ADMIN_PAGE_HTML } from '../admin/page';

const router = Router();

/** A session that refreshed or signed in this recently counts as active. The
 *  access token lives 15 minutes, so a live client renews at least that often. */
const ACTIVE_WINDOW_MS = 20 * 60_000;

// The console polls every few seconds, which the general limiter would refuse.
const adminLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

router.use((_req, res, next) => {
  if (config.adminEmails.length === 0) {
    res.status(404).send('Not found');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/', (_req, res) => {
  res.type('html').send(ADMIN_PAGE_HTML);
});

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const payload = header?.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
    if (!payload) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }
    // Decide on the account as it is now, not on what the token said at login.
    const user = await getDB().get<{ id: string; email: string; email_verified: number }>(
      'SELECT id, email, email_verified FROM users WHERE id = ?',
      [payload.sub],
    );
    if (!user || !user.email_verified || !config.adminEmails.includes(user.email.toLowerCase())) {
      res.status(403).json({ error: 'This account is not an administrator' });
      return;
    }
    req.user = { id: user.id, email: user.email };
    next();
  } catch (err) {
    console.error('[admin] authorisation failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.use('/api', adminLimiter, requireAdmin);

router.get('/api/me', (req, res) => {
  res.json({ email: req.user!.email });
});

interface SessionRow {
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
  expires_at: string;
  device_id: string | null;
  device_name: string | null;
  platform: string | null;
  ip_address: string | null;
}

interface InviteRow {
  project_id: string;
  script_id: string;
  collaborator_name: string;
  role: string;
  created_at: string;
  expires_at: string;
  host_email: string | null;
}

/** Live collaboration sessions: one per shared script, with who is in it now
 *  and how many invitations are still open for it. */
function buildCollabSessions(live: liveStats.LiveConnection[], invites: InviteRow[]) {
  const byKey = new Map<string, any>();
  const entry = (projectId: string, scriptId: string) => {
    const key = projectId + '|' + scriptId;
    let e = byKey.get(key);
    if (!e) {
      e = { projectId, scriptId, documents: new Set<string>(), participants: [], openInvites: 0, invitedRoles: {}, host: null, startedAt: 0, firstInvite: 0 };
      byKey.set(key, e);
    }
    return e;
  };
  for (const c of live) {
    const e = entry(c.projectId, c.scriptId);
    e.documents.add(c.document);
    e.participants.push({ name: c.name, email: c.email, role: c.role, ip: c.ip, since: c.since });
    e.startedAt = e.startedAt ? Math.min(e.startedAt, c.since) : c.since;
  }
  for (const i of invites) {
    const e = entry(i.project_id, i.script_id);
    e.openInvites++;
    e.invitedRoles[i.role] = (e.invitedRoles[i.role] || 0) + 1;
    if (i.host_email) e.host = i.host_email;
    const at = Date.parse(i.created_at);
    e.firstInvite = e.firstInvite ? Math.min(e.firstInvite, at) : at;
  }
  return Array.from(byKey.values()).map(e => ({
    projectId: e.projectId,
    scriptId: e.scriptId,
    documents: Array.from(e.documents),
    live: e.participants.length > 0,
    participants: e.participants,
    openInvites: e.openInvites,
    invitedRoles: e.invitedRoles,
    host: e.host,
    startedAt: e.startedAt || null,
    firstInvite: e.firstInvite || null,
  })).sort((a, b) => Number(b.live) - Number(a.live) || (b.startedAt || b.firstInvite || 0) - (a.startedAt || a.firstInvite || 0));
}

router.get('/api/dashboard', async (_req, res) => {
  try {
    const db = getDB();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const dayAgo = new Date(now - 24 * 3600_000).toISOString();

    const [sessionRows, userCount, newUsers, actionRows, recentEvents, inviteRows] = await Promise.all([
      db.all<SessionRow>(
        `SELECT rt.user_id, u.email, u.display_name, rt.created_at, rt.expires_at, rt.device_id,
                d.device_name, d.platform, d.ip_address
           FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
           LEFT JOIN user_devices d ON d.user_id = rt.user_id AND d.device_id = rt.device_id
          WHERE rt.revoked = 0 AND rt.expires_at > ?
          ORDER BY rt.created_at DESC
          LIMIT 3000`,
        [nowIso],
      ),
      db.get<{ c: number | string }>('SELECT COUNT(*) AS c FROM users'),
      db.get<{ c: number | string }>('SELECT COUNT(*) AS c FROM users WHERE created_at > ?', [dayAgo]),
      db.all<{ action: string; c: number | string }>(
        `SELECT action, COUNT(*) AS c FROM audit_log
          WHERE created_at > ? AND action IN
            ('login','login_failed','google_login','logout','token_refresh','token_refresh_failed','refresh_rate_limited')
          GROUP BY action`,
        [dayAgo],
      ),
      db.all<{ id: number; user_id: string | null; action: string; detail: string | null; ip_address: string | null; created_at: string }>(
        `SELECT id, user_id, action, detail, ip_address, created_at FROM audit_log
          WHERE action IN ('login_failed','token_refresh_failed','refresh_rate_limited','logout','admin_revoke_sessions')
          ORDER BY id DESC LIMIT 60`,
      ),
      // Invite tokens themselves are never selected.
      db.all<InviteRow>(
        `SELECT cs.project_id, cs.script_id, cs.collaborator_name, cs.role, cs.created_at, cs.expires_at,
                u.email AS host_email
           FROM collab_sessions cs
           LEFT JOIN users u ON u.id = cs.created_by
          WHERE cs.active = 1 AND cs.expires_at > ?
          LIMIT 3000`,
        [nowIso],
      ),
    ]);

    // Group a user's live refresh tokens: one token == one signed-in device.
    const connectedUserIds = new Set(
      liveStats.listConnections().map(c => c.userId).filter((v): v is string => !!v),
    );
    const byUser = new Map<string, any>();
    for (const r of sessionRows) {
      let u = byUser.get(r.user_id);
      if (!u) {
        u = {
          userId: r.user_id,
          email: r.email,
          name: r.display_name,
          lastActive: 0,
          sessions: [],
        };
        byUser.set(r.user_id, u);
      }
      const at = Date.parse(r.created_at);
      u.lastActive = Math.max(u.lastActive, at);
      u.sessions.push({
        device: r.device_name || 'Unknown device',
        platform: r.platform,
        ip: r.ip_address,
        lastRefresh: at,
        expiresAt: Date.parse(r.expires_at),
      });
    }
    const users = Array.from(byUser.values()).map(u => {
      const seen = Math.max(u.lastActive, liveStats.lastSeenAt(u.userId) ?? 0);
      const status = connectedUserIds.has(u.userId)
        ? 'connected'
        : now - seen <= ACTIVE_WINDOW_MS ? 'active' : 'idle';
      return { ...u, lastActive: seen, status };
    }).sort((a, b) => b.lastActive - a.lastActive);

    const actions: Record<string, number> = {};
    for (const a of actionRows) actions[a.action] = Number(a.c);

    const connections = liveStats.listConnections();
    const collabSessions = buildCollabSessions(connections, inviteRows);
    const usage = await collectComponents(liveStats.loadedDocumentCount());
    res.json({
      ...usage,
      generatedAt: now,
      system: liveStats.systemSnapshot(),
      http: liveStats.requestTotals(),
      counts: {
        registeredUsers: Number(userCount?.c ?? 0),
        newUsers24h: Number(newUsers?.c ?? 0),
        signedInUsers: users.length,
        signedInSessions: sessionRows.length,
        activeUsers: users.filter(u => u.status !== 'idle').length,
        wsConnections: connections.length,
        wsUsers: new Set(connections.map(c => c.userId || c.name)).size,
        openDocuments: new Set(connections.map(c => c.document)).size,
        liveCollabSessions: collabSessions.filter(c => c.live).length,
        openInvites: inviteRows.length,
      },
      collabSessions,
      actions24h: actions,
      users,
      connections: connections.sort((a, b) => b.since - a.since),
      refreshFailuresSinceStart: liveStats.recentRefreshFailures().slice(0, 50),
      recentEvents,
      limits: {
        accessTokenExpiry: config.jwtAccessExpiry,
        refreshTokenExpiry: config.jwtRefreshExpiry,
        refreshRateLimitPer15Min: 60,
        wsPerIp: config.wsMaxConnectionsPerIp,
        wsPerUser: config.wsMaxConnectionsPerUser,
      },
    });
  } catch (err) {
    console.error('[admin] dashboard failed:', err);
    res.status(500).json({ error: 'Could not load the dashboard' });
  }
});

const USER_SORTS: Record<string, string> = {
  created: 'u.created_at DESC',
  active: 'last_active DESC',
  name: 'LOWER(u.display_name) ASC',
  email: 'LOWER(u.email) ASC',
};

/** Escape LIKE wildcards so a search for "100%" means what it says. */
function likePattern(q: string): string {
  return '%' + q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m) + '%';
}

router.get('/api/users', async (req, res) => {
  try {
    const db = getDB();
    const q = String(req.query.q ?? '').trim().slice(0, 100);
    const pageSize = 50;
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const order = USER_SORTS[String(req.query.sort ?? 'created')] ?? USER_SORTS.created;
    const nowIso = new Date().toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const where = q ? "WHERE (LOWER(u.email) LIKE ? ESCAPE '\\' OR LOWER(u.display_name) LIKE ? ESCAPE '\\')" : '';
    const whereParams = q ? [likePattern(q), likePattern(q)] : [];

    const [rows, matched, summary] = await Promise.all([
      db.all<any>(
        `SELECT u.id, u.email, u.display_name, u.email_verified, u.two_factor_enabled, u.created_at,
                CASE WHEN u.google_id IS NOT NULL THEN 1 ELSE 0 END AS has_google,
                CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password,
                (SELECT MAX(r.created_at) FROM refresh_tokens r WHERE r.user_id = u.id) AS last_active,
                (SELECT COUNT(*) FROM refresh_tokens r WHERE r.user_id = u.id AND r.revoked = 0 AND r.expires_at > ?) AS sessions,
                (SELECT COUNT(*) FROM user_devices d WHERE d.user_id = u.id) AS devices
           FROM users u ${where}
          ORDER BY ${order}, u.id
          LIMIT ? OFFSET ?`,
        [nowIso, ...whereParams, pageSize, (page - 1) * pageSize],
      ),
      db.get<{ c: number | string }>(`SELECT COUNT(*) AS c FROM users u ${where}`, whereParams),
      db.get<any>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) AS verified,
                SUM(CASE WHEN google_id IS NOT NULL THEN 1 ELSE 0 END) AS google,
                SUM(CASE WHEN two_factor_enabled = 1 THEN 1 ELSE 0 END) AS two_factor,
                SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS new_24h,
                SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS new_7d
           FROM users`,
        [dayAgo, weekAgo],
      ),
    ]);

    const ms = (v: string | null) => (v ? Date.parse(v) : null);
    res.json({
      page,
      pageSize,
      matched: Number(matched?.c ?? 0),
      summary: {
        total: Number(summary?.total ?? 0),
        verified: Number(summary?.verified ?? 0),
        google: Number(summary?.google ?? 0),
        twoFactor: Number(summary?.two_factor ?? 0),
        new24h: Number(summary?.new_24h ?? 0),
        new7d: Number(summary?.new_7d ?? 0),
      },
      users: rows.map((r: any) => ({
        id: r.id,
        email: r.email,
        name: r.display_name,
        verified: !!Number(r.email_verified),
        twoFactor: !!Number(r.two_factor_enabled),
        google: !!Number(r.has_google),
        password: !!Number(r.has_password),
        createdAt: ms(r.created_at),
        lastActive: ms(r.last_active),
        sessions: Number(r.sessions),
        devices: Number(r.devices),
        isAdmin: config.adminEmails.includes(String(r.email).toLowerCase()),
        online: liveStats.lastSeenAt(r.id) !== null && Date.now() - (liveStats.lastSeenAt(r.id) as number) <= ACTIVE_WINDOW_MS,
      })),
    });
  } catch (err) {
    console.error('[admin] users list failed:', err);
    res.status(500).json({ error: 'Could not load users' });
  }
});

router.get('/api/history', (_req, res) => {
  res.json({ intervalSec: 10, samples: liveStats.getHistory() });
});

// Sign a user out everywhere: every refresh token revoked. Their open access
// token still works until it expires (15 minutes), then the next refresh fails.
router.post('/api/users/:id/revoke-sessions', async (req, res) => {
  try {
    const target = await getDB().get<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = ?',
      [req.params.id],
    );
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    await revokeAllRefreshTokens(target.id);
    await auditService.logEvent('admin_revoke_sessions', target.id, null,
      { by: req.user!.email, target: target.email }, clientIp(req));
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[admin] revoke failed:', err);
    res.status(500).json({ error: 'Could not sign the user out' });
  }
});

export default router;

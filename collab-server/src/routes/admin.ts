/**
 * Admin console — server health, who is signed in, and per-account detail.
 *
 * Access is limited to the accounts listed in ADMIN_EMAILS. Admins sign in
 * with their ordinary account; there is no separate admin credential to leak.
 * With ADMIN_EMAILS unset the whole console answers 404.
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import * as jwt from 'jsonwebtoken';
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

/**
 * Where to find the backend's API. BACKEND_URL wins when it is set. Otherwise
 * the backend is assumed to sit at this collab server's own address without
 * its "collab." prefix — https://collab.open-draft.com → https://open-draft.com/api —
 * followed by the local development defaults.
 *
 * The raw Host header is used, not X-Forwarded-Host: a browser cannot forge
 * Host, so the signed admin token only goes where the admin's own console is.
 */
export function backendCandidates(hostHeader: string | undefined, protocol: string): string[] {
  if (config.backendUrlConfigured) return config.backendUrls;
  const out: string[] = [];
  const host = String(hostHeader || '').trim().toLowerCase();
  const m = /^collab\.([a-z0-9.-]+(?::\d+)?)$/.exec(host);
  if (m) out.push(`${protocol === 'https' ? 'https' : 'http'}://${m[1]}/api`);
  for (const u of config.backendUrls) if (!out.includes(u)) out.push(u);
  return out;
}

type BackendResult =
  | { ok: true; data: any; source: string }
  | { ok: false; error: string; tried: string[]; status?: number; detail?: string };

/** Call the backend's admin API, trying each candidate address in turn. */
async function callBackend(
  path: string,
  token: string,
  backends: string[],
  method: 'GET' | 'POST' = 'GET',
  body?: object,
): Promise<BackendResult> {
  const tried: string[] = [];
  let lastError = 'no backend URL configured (set BACKEND_URL)';
  for (const base of backends) {
    tried.push(base);
    try {
      const r = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body && { 'Content-Type': 'application/json' }),
        },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return { ok: true, data: await r.json(), source: base };
      const response: any = await r.json().catch(() => ({}));
      const detail = response?.detail ? (typeof response.detail === 'string' ? response.detail : JSON.stringify(response.detail)) : '';
      lastError = `${base} answered ${r.status}${detail ? ': ' + detail : ''}`;
      // The backend answered about the request itself (not found, conflict):
      // that is the answer, not a reason to try another address.
      if (r.status === 404 && method === 'POST' || r.status === 409 || r.status === 400) {
        return { ok: false, error: lastError, tried, status: r.status, detail };
      }
      // A backend that answered with an auth error is the right one, wrongly
      // configured; trying the next URL would only hide that.
      if (r.status === 401 || r.status === 403 || r.status === 503) break;
    } catch (err) {
      lastError = `${base} unreachable: ${(err as Error).message}`;
    }
  }
  return { ok: false, error: lastError, tried };
}

router.get('/api/plugins', (req, res) => managePlugins(req, res));
router.post('/api/plugins/:id', (req, res) => managePlugins(req, res));

async function managePlugins(req: Request, res: Response): Promise<void> {
  const admin = req.user!;
  const pluginId = req.params.id;
  const updating = req.method === 'POST';
  const defaultEnabled: unknown = req.body?.defaultEnabled;
  if (updating && (typeof pluginId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pluginId) || typeof defaultEnabled !== 'boolean')) {
    res.status(400).json({ error: 'A plugin ID and a boolean defaultEnabled value are required' });
    return;
  }
  const token = jwt.sign(
    { sub: admin.id, type: 'admin_plugins', admin: admin.email },
    config.jwtSecret,
    { expiresIn: 60, audience: 'opendraft-backend-admin' },
  );
  const result = await callBackend(
    updating ? `/admin/plugins/${encodeURIComponent(String(pluginId))}` : '/admin/plugins',
    token, backendCandidates(req.headers.host, req.protocol),
    updating ? 'POST' : 'GET', updating ? { defaultEnabled } : undefined,
  );
  if (!result.ok) {
    res.status(result.status ?? 502).json({ error: result.detail || result.error });
    return;
  }
  res.json(result.data);
}

/** Ask the Python backend what an account has stored. The backend keeps the
 *  files; we hold the accounts, so we vouch for the request with a one-minute
 *  token naming just this account. Only metadata comes back. */
async function fetchInventory(userId: string, adminEmail: string, backends: string[]): Promise<BackendResult> {
  const token = jwt.sign(
    { sub: userId, type: 'admin_inventory', admin: adminEmail },
    config.jwtSecret,
    { expiresIn: 60, audience: 'opendraft-backend-admin' },
  );
  const result = await callBackend(`/admin/accounts/${encodeURIComponent(userId)}/inventory`, token, backends);
  if (!result.ok) console.warn(`[admin] inventory for ${userId} unavailable: ${result.error}`);
  return result;
}

const DAY_MS = 24 * 3600_000;

/** One account in full: profile, devices, sign-in and collaboration activity,
 *  and the projects and files it has stored on the backend. */
router.get('/api/users/:id/summary', async (req, res) => {
  try {
    const db = getDB();
    const user = await db.get<any>(
      `SELECT id, email, display_name, email_verified, two_factor_enabled, created_at, updated_at,
              CASE WHEN google_id IS NOT NULL THEN 1 ELSE 0 END AS has_google,
              CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password
         FROM users WHERE id = ?`,
      [req.params.id],
    );
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const monthAgo = new Date(now - 30 * DAY_MS).toISOString();
    // Failed sign-ins are logged before we know the account, under its email
    // and with no user id, so they are looked up separately — last 30 days
    // only, which keeps the scan on the created_at index.
    const emailLike = '%' + JSON.stringify({ email: String(user.email).toLowerCase() }).slice(1, -1).replace(/[\\%_]/g, m => '\\' + m) + '%';

    const [devices, sessions, actionsAll, actions30, daily, recent, failedLogins, firstLast, invites, documents, inventory] = await Promise.all([
      db.all<any>(
        `SELECT device_id, device_name, platform, ip_address, trusted, first_seen_at, last_seen_at
           FROM user_devices WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 200`,
        [user.id],
      ),
      db.all<any>(
        `SELECT device_id, created_at, expires_at FROM refresh_tokens
          WHERE user_id = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 200`,
        [user.id, nowIso],
      ),
      db.all<{ action: string; c: number | string }>(
        'SELECT action, COUNT(*) AS c FROM audit_log WHERE user_id = ? GROUP BY action', [user.id],
      ),
      db.all<{ action: string; c: number | string }>(
        'SELECT action, COUNT(*) AS c FROM audit_log WHERE user_id = ? AND created_at > ? GROUP BY action',
        [user.id, monthAgo],
      ),
      db.all<{ day: string; c: number | string }>(
        `SELECT SUBSTR(created_at, 1, 10) AS day, COUNT(*) AS c FROM audit_log
          WHERE user_id = ? AND created_at > ? AND action NOT IN ('token_refresh', 'disconnect')
          GROUP BY SUBSTR(created_at, 1, 10)`,
        [user.id, monthAgo],
      ),
      db.all<any>(
        `SELECT id, action, document_name, detail, ip_address, created_at FROM audit_log
          WHERE user_id = ? AND action NOT IN ('token_refresh', 'disconnect') ORDER BY id DESC LIMIT 500`,
        [user.id],
      ),
      db.all<any>(
        `SELECT id, action, document_name, detail, ip_address, created_at FROM audit_log
          WHERE created_at > ? AND user_id IS NULL AND action = 'login_failed' AND LOWER(detail) LIKE ? ESCAPE '\\'
          ORDER BY id DESC LIMIT 100`,
        [monthAgo, emailLike],
      ),
      db.get<any>(
        `SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at,
                MAX(CASE WHEN action IN ('login','google_login') THEN created_at END) AS last_login,
                MAX(CASE WHEN action = 'token_refresh' THEN created_at END) AS last_refresh,
                MAX(CASE WHEN action = 'connect' THEN created_at END) AS last_collab
           FROM audit_log WHERE user_id = ?`,
        [user.id],
      ),
      // Invite tokens themselves are never selected.
      db.all<any>(
        `SELECT project_id, script_id, collaborator_name, role, active, created_at, expires_at
           FROM collab_sessions WHERE created_by = ? ORDER BY created_at DESC LIMIT 500`,
        [user.id],
      ),
      db.all<any>(
        `SELECT document_name, COUNT(*) AS c, MAX(created_at) AS last_at FROM audit_log
          WHERE user_id = ? AND action = 'connect' AND document_name IS NOT NULL
          GROUP BY document_name ORDER BY last_at DESC LIMIT 100`,
        [user.id],
      ),
      fetchInventory(user.id, req.user!.email, backendCandidates(req.headers.host, req.protocol)),
    ]);

    // Logged against the admin, not the account, so looking does not show up
    // as the account's own activity.
    await auditService.logEvent('admin_view_account', req.user!.id, null,
      { by: req.user!.email, target: user.email, targetId: user.id }, clientIp(req));

    const ms = (v: string | null | undefined) => (v ? Date.parse(v) : null);
    const toCounts = (rows: { action: string; c: number | string }[]) => {
      const out: Record<string, number> = {};
      for (const r of rows) out[r.action] = Number(r.c);
      return out;
    };
    const liveDevices = new Set(sessions.map(s => s.device_id).filter(Boolean));
    const connections = liveStats.listConnections().filter(c => c.userId === user.id);
    const seen = liveStats.lastSeenAt(user.id);

    const last30 = toCounts(actions30);
    if (failedLogins.length) last30.login_failed = (last30.login_failed || 0) + failedLogins.length;
    const days: { day: string; count: number }[] = [];
    const byDay = new Map(daily.map(d => [d.day, Number(d.c)]));
    for (const f of failedLogins) {
      const day = String(f.created_at).slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const recentEvents = recent.concat(failedLogins).sort((a: any, b: any) => b.id - a.id).slice(0, 500);
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
      days.push({ day, count: byDay.get(day) ?? 0 });
    }

    // Group invites per shared script.
    const shared = new Map<string, any>();
    for (const i of invites) {
      const key = i.project_id + '|' + i.script_id;
      let s = shared.get(key);
      if (!s) {
        s = { projectId: i.project_id, scriptId: i.script_id, invites: 0, openInvites: 0, roles: {} as Record<string, number>, people: [] as string[], firstAt: null as number | null, lastAt: null as number | null };
        shared.set(key, s);
      }
      s.invites++;
      const open = Number(i.active) === 1 && Date.parse(i.expires_at) > now;
      if (open) s.openInvites++;
      s.roles[i.role] = (s.roles[i.role] || 0) + 1;
      if (s.people.length < 20 && !s.people.includes(i.collaborator_name)) s.people.push(i.collaborator_name);
      const at = Date.parse(i.created_at);
      s.firstAt = s.firstAt ? Math.min(s.firstAt, at) : at;
      s.lastAt = s.lastAt ? Math.max(s.lastAt, at) : at;
    }

    res.json({
      generatedAt: now,
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        verified: !!Number(user.email_verified),
        twoFactor: !!Number(user.two_factor_enabled),
        google: !!Number(user.has_google),
        password: !!Number(user.has_password),
        createdAt: ms(user.created_at),
        updatedAt: ms(user.updated_at),
        isAdmin: config.adminEmails.includes(String(user.email).toLowerCase()),
        status: connections.length ? 'connected' : seen !== null && now - seen <= ACTIVE_WINDOW_MS ? 'active' : 'idle',
      },
      activity: {
        firstEventAt: ms(firstLast?.first_at),
        lastEventAt: Math.max(ms(firstLast?.last_at) ?? 0, seen ?? 0) || null,
        lastLoginAt: ms(firstLast?.last_login),
        lastRefreshAt: ms(firstLast?.last_refresh),
        lastCollabAt: ms(firstLast?.last_collab),
        allTime: toCounts(actionsAll),
        last30Days: last30,
        daily: days,
        recent: recentEvents.map((e: any) => ({
          id: e.id, action: e.action, document: e.document_name, detail: e.detail, ip: e.ip_address, at: ms(e.created_at),
        })),
      },
      devices: devices.map((d: any) => ({
        name: d.device_name,
        platform: d.platform,
        ip: d.ip_address,
        trusted: !!Number(d.trusted),
        firstSeen: ms(d.first_seen_at),
        lastSeen: ms(d.last_seen_at),
        signedIn: liveDevices.has(d.device_id),
      })),
      sessions: { live: sessions.length, newest: ms(sessions[0]?.created_at) },
      collaboration: {
        liveConnections: connections.map(c => ({ document: c.document, role: c.role, ip: c.ip, since: c.since, projectId: c.projectId, scriptId: c.scriptId })),
        invitesCreated: invites.length,
        openInvites: invites.filter(i => Number(i.active) === 1 && Date.parse(i.expires_at) > now).length,
        sharedScripts: Array.from(shared.values()),
        documentsJoined: documents.map((d: any) => ({ document: d.document_name, connections: Number(d.c), lastAt: ms(d.last_at) })),
      },
      storage: inventory.ok
        ? { available: true, source: inventory.source, ...inventory.data }
        : { available: false, error: inventory.error, tried: inventory.tried },
    });
  } catch (err) {
    console.error('[admin] account summary failed:', err);
    res.status(500).json({ error: 'Could not load the account' });
  }
});

/**
 * Everything logged against an email address in the last 90 days, whether or
 * not an account has it now — for "I can't sign in", "the reset email never
 * came" or "did I delete my account?" from someone the users list can't find.
 */
router.get('/api/lookup', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!email || email.length > 320 || !email.includes('@')) {
      res.status(400).json({ error: 'Enter a full email address' });
      return;
    }
    const since = new Date(Date.now() - 90 * DAY_MS).toISOString();
    const like = '%' + JSON.stringify({ email }).slice(1, -1).replace(/[\\%_]/g, m => '\\' + m) + '%';
    const db = getDB();
    const [account, events] = await Promise.all([
      db.get<any>('SELECT id, email, display_name, created_at FROM users WHERE LOWER(email) = ?', [email]),
      db.all<any>(
        `SELECT id, user_id, action, detail, ip_address, created_at FROM audit_log
          WHERE created_at > ? AND LOWER(detail) LIKE ? ESCAPE '\\'
          ORDER BY id DESC LIMIT 300`,
        [since, like],
      ),
    ]);
    await auditService.logEvent('admin_view_account', req.user!.id, null,
      { by: req.user!.email, lookup: email }, clientIp(req));
    res.json({
      email,
      account: account ? { id: account.id, email: account.email, name: account.display_name, createdAt: Date.parse(account.created_at) } : null,
      events: events.map((e: any) => ({
        id: e.id, userId: e.user_id, action: e.action, detail: e.detail, ip: e.ip_address, at: Date.parse(e.created_at),
      })),
    });
  } catch (err) {
    console.error('[admin] email lookup failed:', err);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/** Put a deleted project or script back into the account it was deleted from. */
router.post('/api/users/:id/trash/:entry/restore', async (req, res) => {
  try {
    const target = await getDB().get<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = ?',
      [req.params.id],
    );
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const entry = String(req.params.entry);
    const token = jwt.sign(
      { sub: target.id, type: 'admin_restore', admin: req.user!.email, entry },
      config.jwtSecret,
      { expiresIn: 60, audience: 'opendraft-backend-admin' },
    );
    const result = await callBackend(
      `/admin/accounts/${encodeURIComponent(target.id)}/trash/${encodeURIComponent(entry)}/restore`,
      token, backendCandidates(req.headers.host, req.protocol), 'POST',
    );
    if (!result.ok) {
      console.warn(`[admin] restore of ${entry} for ${target.id} failed: ${result.error}`);
      res.status(result.status === 409 ? 409 : result.status === 404 ? 404 : 502)
        .json({ error: result.detail || result.error });
      return;
    }
    const restored = result.data?.restored || {};
    await auditService.logEvent('admin_restore', target.id, null, {
      by: req.user!.email,
      kind: restored.kind,
      project: restored.projectName,
      script: restored.scriptTitle,
      deletedAt: restored.deletedAt,
    }, clientIp(req));
    res.json({ status: 'ok', restored });
  } catch (err) {
    console.error('[admin] restore failed:', err);
    res.status(500).json({ error: 'Could not restore' });
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

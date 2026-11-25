import { getDB } from '../db';

export type AuditAction =
  | 'register'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'connect'
  | 'disconnect'
  | 'document_load'
  | 'document_store'
  | 'token_refresh'
  | 'token_refresh_failed'
  | 'refresh_rate_limited'
  | 'admin_revoke_sessions'
  | 'admin_view_account'
  | 'email_verified'
  | 'google_login'
  | 'new_device_challenge'
  | 'new_device_challenge_resend'
  | 'new_device_verified'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_failed'
  | 'password_reset'
  | 'account_deleted'
  | 'device_revoked'
  | 'suggestion_refused'
  | 'admin_restore'
  | BackendAuditAction;

/**
 * Events the Python backend reports through POST /internal/audit — what a
 * writer did with the projects and scripts stored on the server. Only these
 * may arrive that way.
 */
export const BACKEND_AUDIT_ACTIONS = [
  'project_created',
  'project_renamed',
  'project_deleted',
  'script_created',
  'script_renamed',
  'script_deleted',
  'asset_uploaded',
  'asset_deleted',
  'version_saved',
  'version_restored',
  'version_deleted',
] as const;
export type BackendAuditAction = typeof BACKEND_AUDIT_ACTIONS[number];

export function isBackendAuditAction(value: unknown): value is BackendAuditAction {
  return typeof value === 'string' && (BACKEND_AUDIT_ACTIONS as readonly string[]).includes(value);
}

export async function logEvent(
  action: AuditAction,
  userId?: string | null,
  documentName?: string | null,
  detail?: Record<string, unknown> | null,
  ipAddress?: string | null,
): Promise<void> {
  try {
    const db = getDB();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO audit_log (user_id, action, document_name, detail, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        action,
        documentName || null,
        detail ? JSON.stringify(detail) : null,
        ipAddress || null,
        now,
      ],
    );
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

/**
 * Delete audit rows older than `days`. 0 keeps everything. Returns how many
 * rows went. created_at is an ISO string, so the comparison is lexical and
 * uses the created_at index on both SQLite and PostgreSQL.
 */
export async function pruneAuditLog(days: number, now: Date = new Date()): Promise<number> {
  if (!days || days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 24 * 3600_000).toISOString();
  const { changes } = await getDB().run('DELETE FROM audit_log WHERE created_at < ?', [cutoff]);
  return changes;
}

let pruneTimer: NodeJS.Timeout | null = null;

/** Prune now and then once a day. Failures are logged and retried next time. */
export function startAuditRetention(days: number): void {
  if (!days || days <= 0) {
    console.log('[audit] retention disabled (AUDIT_RETENTION_DAYS=0): audit_log is never pruned');
    return;
  }
  const run = async () => {
    try {
      const removed = await pruneAuditLog(days);
      if (removed) console.log(`[audit] pruned ${removed} audit_log row(s) older than ${days} days`);
    } catch (err) {
      console.error('[audit] pruning audit_log failed:', err);
    }
  };
  void run();
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = setInterval(run, 24 * 3600_000);
  pruneTimer.unref();
}

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
  | 'email_verified'
  | 'google_login';

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

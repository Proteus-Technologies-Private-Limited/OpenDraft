import { config } from './config';
import type { DBAdapter } from './database/adapter';
import { SQLiteAdapter } from './database/sqlite';
import { PostgresAdapter } from './database/postgres';

export { DBAdapter };

export interface UserRow {
  id: string;
  email: string;
  email_verified: number;
  password_hash: string | null;
  google_id: string | null;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface EmailVerificationRow {
  id: string;
  user_id: string;
  code: string;
  expires_at: string;
  used: number;
  created_at: string;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked: number;
  created_at: string;
}

export interface CollabSessionRow {
  token: string;
  project_id: string;
  script_id: string;
  collaborator_name: string;
  role: string;
  active: number;
  session_nonce: string;
  created_at: string;
  expires_at: string;
}

export interface AuditLogRow {
  id: number;
  user_id: string | null;
  action: string;
  document_name: string | null;
  detail: string | null;
  ip_address: string | null;
  created_at: string;
}

let adapter: DBAdapter | null = null;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    email_verified INTEGER DEFAULT 0,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    document_name TEXT,
    detail TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collab_sessions (
    token TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    script_id TEXT NOT NULL,
    collaborator_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    active INTEGER NOT NULL DEFAULT 1,
    session_nonce TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_collab_sessions_project_script
    ON collab_sessions(project_id, script_id);
`;

export async function initDB(): Promise<DBAdapter> {
  if (adapter) return adapter;

  if (config.dbType === 'postgresql') {
    console.log(`Connecting to PostgreSQL at ${config.dbHost}:${config.dbPort}/${config.dbName}`);
    adapter = new PostgresAdapter({
      host: config.dbHost,
      port: config.dbPort,
      database: config.dbName,
      user: config.dbUser,
      password: config.dbPassword,
    });
  } else {
    console.log(`Using SQLite database in ${config.dataDir}`);
    adapter = new SQLiteAdapter(config.dataDir);
  }

  await adapter.exec(SCHEMA_SQL);
  return adapter;
}

export function getDB(): DBAdapter {
  if (!adapter) {
    throw new Error('Database not initialized — call initDB() first');
  }
  return adapter;
}

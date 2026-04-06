/**
 * Local SQLite database for Tauri (desktop + mobile).
 *
 * Provides the same data model as the Python backend but backed by a
 * single SQLite file stored in the app's data directory.
 *
 * This module is only imported dynamically on Tauri platforms — the web
 * build never loads it.
 */

import Database from '@tauri-apps/plugin-sql';

let _db: Database | null = null;

/** Open (or create) the local SQLite database and run migrations. */
export async function getDb(): Promise<Database> {
  if (_db) return _db;
  _db = await Database.load('sqlite:opendraft.db');
  await migrate(_db);
  return _db;
}

async function migrate(db: Database): Promise<void> {
  // ── Core tables ───────────────────────────────────────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      properties    TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      color         TEXT NOT NULL DEFAULT '',
      pinned        INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scripts (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      page_count    INTEGER NOT NULL DEFAULT 0,
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      color         TEXT NOT NULL DEFAULT '',
      pinned        INTEGER NOT NULL DEFAULT 0,
      sort_order    INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
  `);

  // Script content stored separately so list queries stay fast.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS script_content (
      script_id     TEXT PRIMARY KEY REFERENCES scripts(id) ON DELETE CASCADE,
      content       TEXT
    );
  `);

  // ── Delta versioning ──────────────────────────────────────────────────────
  // Each commit only stores scripts that changed. Unchanged scripts are
  // referenced by setting inherited=1 (content is NULL).

  await db.execute(`
    CREATE TABLE IF NOT EXISTS version_commits (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      message       TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_version_commits_project
      ON version_commits(project_id, created_at DESC);
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS version_scripts (
      id            TEXT PRIMARY KEY,
      commit_id     TEXT NOT NULL REFERENCES version_commits(id) ON DELETE CASCADE,
      script_id     TEXT NOT NULL,
      title         TEXT NOT NULL,
      content       TEXT,
      content_hash  TEXT NOT NULL DEFAULT '',
      inherited     INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_version_scripts_commit
      ON version_scripts(commit_id);
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_version_scripts_script
      ON version_scripts(script_id, commit_id);
  `);

  // ── Assets ────────────────────────────────────────────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS assets (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename      TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      tags          TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
  `);

  // ── Formatting templates ───────────────────────────────────────────────────

  await db.execute(`
    CREATE TABLE IF NOT EXISTS formatting_templates (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      mode          TEXT NOT NULL DEFAULT 'enforce',
      rules         TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  // ── Migration from old schema ─────────────────────────────────────────────
  // If the old `versions` table (full-snapshot) exists, migrate data.
  // If the old `scripts` table has a `content` column, migrate it.

  await migrateFromOldSchema(db);
}

/**
 * Handle migration from the previous schema (v1) to the new one.
 * - Old `scripts` table had an inline `content` column
 * - Old `versions` table stored full JSON snapshots
 */
async function migrateFromOldSchema(db: Database): Promise<void> {
  // Check if old `scripts.content` column exists
  const scriptCols = await db.select<any[]>(`PRAGMA table_info(scripts)`);
  const hasContentCol = scriptCols.some((c: any) => c.name === 'content');

  if (hasContentCol) {
    // Migrate content from scripts to script_content
    await db.execute(`
      INSERT OR IGNORE INTO script_content (script_id, content)
      SELECT id, content FROM scripts WHERE content IS NOT NULL
    `);

    // SQLite doesn't support DROP COLUMN before 3.35.0, so we recreate the table.
    // But to be safe and avoid data loss, we leave the old column in place.
    // New code will only read from script_content.
  }

  // Check if old `versions` table exists (full-snapshot format)
  const tables = await db.select<any[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='versions'`
  );

  if (tables.length > 0) {
    // Migrate old snapshots to delta versioning
    const oldVersions = await db.select<any[]>(
      `SELECT id, project_id, message, snapshot, created_at FROM versions ORDER BY created_at ASC`
    );

    // Track previous content hashes per script for delta detection
    const prevHashes = new Map<string, string>();

    for (const v of oldVersions) {
      // Skip if already migrated
      const existing = await db.select<any[]>(
        `SELECT id FROM version_commits WHERE id = $1`, [v.id]
      );
      if (existing.length > 0) continue;

      await db.execute(
        `INSERT INTO version_commits (id, project_id, message, created_at) VALUES ($1, $2, $3, $4)`,
        [v.id, v.project_id, v.message, v.created_at]
      );

      let scripts: any[] = [];
      try { scripts = JSON.parse(v.snapshot || '[]'); } catch { /* skip bad data */ }

      for (const s of scripts) {
        const contentStr = s.content ? JSON.stringify(s.content) : '';
        const hash = await simpleHash(contentStr);
        const prevHash = prevHashes.get(s.id) || '';
        const inherited = prevHash === hash ? 1 : 0;

        const vsId = crypto.randomUUID ? crypto.randomUUID() : `${v.id}-${s.id}`;
        await db.execute(
          `INSERT INTO version_scripts (id, commit_id, script_id, title, content, content_hash, inherited)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [vsId, v.id, s.id, s.title, inherited ? null : contentStr, hash, inherited]
        );

        prevHashes.set(s.id, hash);
      }
    }

    // Drop the old versions table after successful migration
    if (oldVersions.length > 0) {
      await db.execute(`DROP TABLE IF EXISTS versions`);
    } else {
      // Empty table — just drop it
      await db.execute(`DROP TABLE IF EXISTS versions`);
    }
  }

  // Add missing columns to projects if upgrading from old schema
  const projCols = await db.select<any[]>(`PRAGMA table_info(projects)`);
  const projColNames = new Set(projCols.map((c: any) => c.name));

  if (!projColNames.has('color')) {
    await db.execute(`ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT ''`);
  }
  if (!projColNames.has('pinned')) {
    await db.execute(`ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
  }
  if (!projColNames.has('sort_order')) {
    await db.execute(`ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  }

  // Add missing columns to scripts if upgrading from old schema
  const scriptColNames = new Set(scriptCols.map((c: any) => c.name));
  if (!scriptColNames.has('color')) {
    await db.execute(`ALTER TABLE scripts ADD COLUMN color TEXT NOT NULL DEFAULT ''`);
  }
  if (!scriptColNames.has('pinned')) {
    await db.execute(`ALTER TABLE scripts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
  }
  if (!scriptColNames.has('sort_order')) {
    await db.execute(`ALTER TABLE scripts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  }
  if (!scriptColNames.has('template_id')) {
    await db.execute(`ALTER TABLE scripts ADD COLUMN template_id TEXT DEFAULT NULL`);
  }
}

/** Simple string hash for content comparison. */
async function simpleHash(str: string): Promise<string> {
  if (!str) return '';
  // Use SubtleCrypto if available, else a simple DJB2 hash
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const data = new TextEncoder().encode(str);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { /* fall through */ }
  }
  // DJB2 fallback
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(16);
}

export { simpleHash };

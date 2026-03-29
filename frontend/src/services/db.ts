/**
 * Local SQLite database for Tauri mobile (iOS / Android).
 *
 * Provides the same data model as the Python backend but backed by a
 * single SQLite file stored in the app's data directory.
 *
 * This module is only imported dynamically on mobile Tauri — the web and
 * desktop builds never load it.
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
  // Create tables if they don't exist — idempotent.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      properties    TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS scripts (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      content       TEXT,
      page_count    INTEGER NOT NULL DEFAULT 0,
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_scripts_project ON scripts(project_id);
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS versions (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      message       TEXT NOT NULL,
      snapshot      TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);
  `);

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
}

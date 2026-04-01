/**
 * Local storage implementation for Tauri mobile (iOS / Android).
 *
 * Mirrors every method exported by `api` in api.ts but reads/writes from
 * a local SQLite database + filesystem instead of the Python backend.
 *
 * This file is **only** imported dynamically when `isMobileTauri()` is true,
 * so it is tree-shaken out of web and desktop builds.
 */

import { getDb } from './db';
import {
  mkdir,
  writeFile,
  readFile,
  remove,
  exists,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import type {
  ProjectInfo,
  ProjectProperties,
  ScriptMeta,
  ScriptResponse,
  VersionInfo,
  DiffResponse,
} from './api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* secure context required */ }
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function now(): string {
  return new Date().toISOString();
}

function shortHash(id: string): string {
  return id.slice(0, 7);
}

const EMPTY_PROPS: ProjectProperties = {
  genre: '', logline: '', synopsis: '', author: '', contact: '',
  copyright: '', draft: '', language: 'en', format: 'screenplay',
  production_company: '', director: '', producer: '', status: '',
  target_length: '', notes: '',
};

/** Ensure the assets directory exists for a project. */
async function ensureAssetDir(projectId: string): Promise<string> {
  const dir = `assets/${projectId}`;
  if (!(await exists(dir, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
  }
  return dir;
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Create the mobile storage object.  Its shape exactly matches the `api`
 * export in api.ts so it can be used as a drop-in replacement.
 */
export async function createMobileStorage() {
  // Initialise the database (runs migrations on first call)
  const db = await getDb();

  // Ensure the root assets directory exists
  if (!(await exists('assets', { baseDir: BaseDirectory.AppData }))) {
    await mkdir('assets', { baseDir: BaseDirectory.AppData, recursive: true });
  }

  // Resolve the app data dir once for asset URLs
  const baseDir = await appDataDir();

  const storage = {
    // ── Projects ───────────────────────────────────────────────────────────

    async listProjects(): Promise<ProjectInfo[]> {
      const rows = await db.select<any[]>(
        'SELECT * FROM projects ORDER BY updated_at DESC',
      );
      return rows.map(rowToProject);
    },

    async createProject(name: string): Promise<ProjectInfo> {
      const id = uuid();
      const ts = now();
      const props = JSON.stringify(EMPTY_PROPS);
      await db.execute(
        'INSERT INTO projects (id, name, properties, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)',
        [id, name, props, ts, ts],
      );
      return { id, name, created_at: ts, updated_at: ts, properties: { ...EMPTY_PROPS }, color: '', pinned: false, sort_order: 0 };
    },

    async getProject(id: string): Promise<ProjectInfo> {
      const rows = await db.select<any[]>(
        'SELECT * FROM projects WHERE id = $1',
        [id],
      );
      if (!rows.length) throw new Error(`Project not found: ${id}`);
      return rowToProject(rows[0]);
    },

    async updateProject(
      id: string,
      data: { name?: string; properties?: Partial<ProjectProperties> },
    ): Promise<ProjectInfo> {
      const existing = await this.getProject(id);
      const name = data.name ?? existing.name;
      const props = data.properties
        ? { ...existing.properties, ...data.properties }
        : existing.properties;
      const ts = now();
      await db.execute(
        'UPDATE projects SET name = $1, properties = $2, updated_at = $3 WHERE id = $4',
        [name, JSON.stringify(props), ts, id],
      );
      return { ...existing, name, properties: props, updated_at: ts };
    },

    // ── Scripts ────────────────────────────────────────────────────────────

    async listScripts(projectId: string): Promise<ScriptMeta[]> {
      const rows = await db.select<any[]>(
        'SELECT id, project_id, title, page_count, size_bytes, created_at, updated_at FROM scripts WHERE project_id = $1 ORDER BY created_at',
        [projectId],
      );
      return rows.map(rowToScriptMeta);
    },

    async createScript(
      projectId: string,
      data: { title: string; content?: any },
    ): Promise<ScriptResponse> {
      const id = uuid();
      const ts = now();
      const contentStr = data.content ? JSON.stringify(data.content) : null;
      const sizeBytes = contentStr ? new Blob([contentStr]).size : 0;
      await db.execute(
        'INSERT INTO scripts (id, project_id, title, content, size_bytes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, projectId, data.title, contentStr, sizeBytes, ts, ts],
      );
      // Touch the parent project
      await db.execute(
        'UPDATE projects SET updated_at = $1 WHERE id = $2',
        [ts, projectId],
      );
      return {
        meta: {
          id, title: data.title, author: '', format: 'screenplay',
          created_at: ts, updated_at: ts, page_count: 0, size_bytes: sizeBytes,
          color: '', pinned: false, sort_order: 0, preview: '',
        },
        content: data.content ?? null,
      };
    },

    async getScript(projectId: string, scriptId: string): Promise<ScriptResponse> {
      const rows = await db.select<any[]>(
        'SELECT * FROM scripts WHERE id = $1 AND project_id = $2',
        [scriptId, projectId],
      );
      if (!rows.length) throw new Error(`Script not found: ${scriptId}`);
      const r = rows[0];
      return {
        meta: rowToScriptMeta(r),
        content: r.content ? JSON.parse(r.content) : null,
      };
    },

    async saveScript(
      projectId: string,
      scriptId: string,
      data: { title?: string; content?: Record<string, unknown> },
    ): Promise<ScriptResponse> {
      const existing = await this.getScript(projectId, scriptId);
      const title = data.title ?? existing.meta.title;
      const content = data.content ?? existing.content;
      const contentStr = content ? JSON.stringify(content) : null;
      const sizeBytes = contentStr ? new Blob([contentStr]).size : 0;
      const ts = now();
      await db.execute(
        'UPDATE scripts SET title = $1, content = $2, size_bytes = $3, updated_at = $4 WHERE id = $5',
        [title, contentStr, sizeBytes, ts, scriptId],
      );
      await db.execute(
        'UPDATE projects SET updated_at = $1 WHERE id = $2',
        [ts, projectId],
      );
      return {
        meta: { ...existing.meta, title, size_bytes: sizeBytes, updated_at: ts },
        content,
      };
    },

    async deleteScript(
      projectId: string,
      scriptId: string,
    ): Promise<{ message: string }> {
      await db.execute('DELETE FROM scripts WHERE id = $1 AND project_id = $2', [
        scriptId,
        projectId,
      ]);
      await db.execute(
        'UPDATE projects SET updated_at = $1 WHERE id = $2',
        [now(), projectId],
      );
      return { message: 'deleted' };
    },

    async deleteProject(id: string): Promise<{ message: string }> {
      await db.execute('DELETE FROM scripts WHERE project_id = $1', [id]);
      await db.execute('DELETE FROM versions WHERE project_id = $1', [id]);
      await db.execute('DELETE FROM assets WHERE project_id = $1', [id]);
      await db.execute('DELETE FROM projects WHERE id = $1', [id]);
      return { message: 'deleted' };
    },

    async reorderProjects(
      items: Array<{ id: string; sort_order: number }>,
    ): Promise<{ message: string }> {
      for (const item of items) {
        await db.execute(
          'UPDATE projects SET sort_order = $1 WHERE id = $2',
          [item.sort_order, item.id],
        );
      }
      return { message: 'ok' };
    },

    async reorderScripts(
      projectId: string,
      items: Array<{ id: string; sort_order: number }>,
    ): Promise<{ message: string }> {
      for (const item of items) {
        await db.execute(
          'UPDATE scripts SET sort_order = $1 WHERE id = $2 AND project_id = $3',
          [item.sort_order, item.id, projectId],
        );
      }
      return { message: 'ok' };
    },

    async duplicateScript(
      projectId: string,
      scriptId: string,
    ): Promise<ScriptResponse> {
      const original = await this.getScript(projectId, scriptId);
      const id = uuid();
      const ts = now();
      const contentStr = original.content ? JSON.stringify(original.content) : null;
      const sizeBytes = contentStr ? new Blob([contentStr]).size : 0;
      const title = `${original.meta.title} (Copy)`;
      await db.execute(
        'INSERT INTO scripts (id, project_id, title, content, size_bytes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, projectId, title, contentStr, sizeBytes, ts, ts],
      );
      await db.execute(
        'UPDATE projects SET updated_at = $1 WHERE id = $2',
        [ts, projectId],
      );
      return {
        meta: {
          id, title, author: '', format: 'screenplay',
          created_at: ts, updated_at: ts, page_count: 0, size_bytes: sizeBytes,
          color: '', pinned: false, sort_order: 0, preview: '',
        },
        content: original.content,
      };
    },

    async getScriptAtVersion(
      projectId: string,
      hash: string,
      scriptId: string,
    ): Promise<ScriptResponse> {
      const rows = await db.select<any[]>(
        'SELECT snapshot FROM versions WHERE id = $1 AND project_id = $2',
        [hash, projectId],
      );
      if (!rows.length) throw new Error(`Version not found: ${hash}`);
      const scripts: any[] = JSON.parse(rows[0].snapshot);
      const found = scripts.find((s: any) => s.id === scriptId);
      if (!found) throw new Error(`Script ${scriptId} not found in version ${hash}`);
      return {
        meta: {
          id: found.id, title: found.title, author: '', format: 'screenplay',
          created_at: '', updated_at: '', page_count: 0, size_bytes: 0,
          color: '', pinned: false, sort_order: 0, preview: '',
        },
        content: found.content,
      };
    },

    // Collab methods — not available on mobile (offline only)
    async createCollabInvite(): Promise<never> {
      throw new Error('Collaboration is not available on mobile');
    },
    async validateCollabSession(): Promise<never> {
      throw new Error('Collaboration is not available on mobile');
    },
    async listCollabSessions(): Promise<never> {
      throw new Error('Collaboration is not available on mobile');
    },
    async revokeCollabSession(): Promise<never> {
      throw new Error('Collaboration is not available on mobile');
    },
    async revokeAllCollabSessions(): Promise<never> {
      throw new Error('Collaboration is not available on mobile');
    },

    // ── Versions ───────────────────────────────────────────────────────────
    // Replaces Git-based versioning with SQLite snapshots.

    async checkin(projectId: string, message: string): Promise<VersionInfo> {
      // Snapshot all scripts as JSON
      const scripts = await db.select<any[]>(
        'SELECT id, title, content FROM scripts WHERE project_id = $1',
        [projectId],
      );
      const snapshot = JSON.stringify(
        scripts.map((s: any) => ({
          id: s.id,
          title: s.title,
          content: s.content ? JSON.parse(s.content) : null,
        })),
      );

      const id = uuid();
      const ts = now();
      await db.execute(
        'INSERT INTO versions (id, project_id, message, snapshot, created_at) VALUES ($1, $2, $3, $4, $5)',
        [id, projectId, message, snapshot, ts],
      );

      return { hash: id, short_hash: shortHash(id), message, date: ts };
    },

    async getVersions(projectId: string): Promise<VersionInfo[]> {
      const rows = await db.select<any[]>(
        'SELECT id, message, created_at FROM versions WHERE project_id = $1 ORDER BY created_at DESC',
        [projectId],
      );
      return rows.map((r: any) => ({
        hash: r.id,
        short_hash: shortHash(r.id),
        message: r.message,
        date: r.created_at,
      }));
    },

    async getVersionDiff(
      _projectId: string,
      fromHash: string,
      toHash: string,
    ): Promise<DiffResponse> {
      const [fromRows, toRows] = await Promise.all([
        db.select<any[]>('SELECT snapshot FROM versions WHERE id = $1', [fromHash]),
        db.select<any[]>('SELECT snapshot FROM versions WHERE id = $1', [toHash]),
      ]);
      if (!fromRows.length || !toRows.length) {
        throw new Error('Version not found');
      }

      const fromScripts: any[] = JSON.parse(fromRows[0].snapshot);
      const toScripts: any[] = JSON.parse(toRows[0].snapshot);

      // Build a simple unified diff
      const lines: string[] = [];
      const allIds = new Set([
        ...fromScripts.map((s: any) => s.id),
        ...toScripts.map((s: any) => s.id),
      ]);

      for (const sid of allIds) {
        const from = fromScripts.find((s: any) => s.id === sid);
        const to = toScripts.find((s: any) => s.id === sid);
        const title = to?.title || from?.title || sid;

        if (!from && to) {
          lines.push(`+++ New script: ${title}`);
        } else if (from && !to) {
          lines.push(`--- Deleted script: ${title}`);
        } else {
          const fromStr = JSON.stringify(from?.content, null, 2);
          const toStr = JSON.stringify(to?.content, null, 2);
          if (fromStr !== toStr) {
            lines.push(`--- ${title}`);
            lines.push(`+++ ${title}`);
            lines.push('@@ modified @@');
            // Simple line diff
            const fLines = fromStr.split('\n');
            const tLines = toStr.split('\n');
            const maxLen = Math.max(fLines.length, tLines.length);
            for (let i = 0; i < maxLen; i++) {
              if (fLines[i] !== tLines[i]) {
                if (fLines[i]) lines.push(`-${fLines[i]}`);
                if (tLines[i]) lines.push(`+${tLines[i]}`);
              }
            }
          }
        }
      }

      return {
        diff: lines.join('\n') || 'No differences found.',
        from_hash: fromHash,
        to_hash: toHash,
      };
    },

    async restoreVersion(
      projectId: string,
      hash: string,
    ): Promise<VersionInfo> {
      const rows = await db.select<any[]>(
        'SELECT * FROM versions WHERE id = $1 AND project_id = $2',
        [hash, projectId],
      );
      if (!rows.length) throw new Error(`Version not found: ${hash}`);

      const snapshot: any[] = JSON.parse(rows[0].snapshot);
      const ts = now();

      // Delete current scripts and re-insert from snapshot
      await db.execute('DELETE FROM scripts WHERE project_id = $1', [projectId]);

      for (const s of snapshot) {
        const contentStr = s.content ? JSON.stringify(s.content) : null;
        const sizeBytes = contentStr ? new Blob([contentStr]).size : 0;
        await db.execute(
          'INSERT INTO scripts (id, project_id, title, content, size_bytes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [s.id, projectId, s.title, contentStr, sizeBytes, ts, ts],
        );
      }

      await db.execute(
        'UPDATE projects SET updated_at = $1 WHERE id = $2',
        [ts, projectId],
      );

      return {
        hash,
        short_hash: shortHash(hash),
        message: rows[0].message,
        date: rows[0].created_at,
      };
    },

    // ── Assets ─────────────────────────────────────────────────────────────

    async listAssets(projectId: string): Promise<any[]> {
      const rows = await db.select<any[]>(
        'SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at DESC',
        [projectId],
      );
      return rows.map((r: any) => ({
        id: r.id,
        filename: r.filename,
        original_name: r.original_name,
        mime_type: r.mime_type,
        size_bytes: r.size_bytes,
        tags: JSON.parse(r.tags || '[]'),
        created_at: r.created_at,
      }));
    },

    async uploadAsset(
      projectId: string,
      file: File,
      tags: string[] = [],
    ): Promise<any> {
      const id = uuid();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const filename = ext ? `${id}.${ext}` : id;
      const ts = now();

      // Write file to app data directory
      const dir = await ensureAssetDir(projectId);
      const buffer = new Uint8Array(await file.arrayBuffer());
      await writeFile(`${dir}/${filename}`, buffer, {
        baseDir: BaseDirectory.AppData,
      });

      // Store metadata in SQLite
      await db.execute(
        'INSERT INTO assets (id, project_id, filename, original_name, mime_type, size_bytes, tags, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id, projectId, filename, file.name, file.type || 'application/octet-stream', file.size, JSON.stringify(tags), ts],
      );

      return {
        id,
        filename,
        original_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        tags,
        created_at: ts,
      };
    },

    async getAssetBytes(projectId: string, assetId: string): Promise<Uint8Array> {
      const rows = await db.select<any[]>(
        'SELECT filename FROM assets WHERE id = $1 AND project_id = $2',
        [assetId, projectId],
      );
      if (!rows.length) throw new Error(`Asset not found: ${assetId}`);
      return readFile(`assets/${projectId}/${rows[0].filename}`, {
        baseDir: BaseDirectory.AppData,
      });
    },

    async updateAssetTags(
      projectId: string,
      assetId: string,
      tags: string[],
    ): Promise<void> {
      await db.execute(
        'UPDATE assets SET tags = $1 WHERE id = $2 AND project_id = $3',
        [JSON.stringify(tags), assetId, projectId],
      );
    },

    getAssetUrl: (projectId: string, assetId: string, filename?: string): string => {
      const filePath = `${baseDir}/assets/${projectId}/${filename || assetId}`;
      return convertFileSrc(filePath);
    },

    async deleteAsset(projectId: string, assetId: string): Promise<void> {
      const rows = await db.select<any[]>(
        'SELECT filename FROM assets WHERE id = $1 AND project_id = $2',
        [assetId, projectId],
      );
      if (rows.length) {
        const path = `assets/${projectId}/${rows[0].filename}`;
        if (await exists(path, { baseDir: BaseDirectory.AppData })) {
          await remove(path, { baseDir: BaseDirectory.AppData });
        }
      }
      await db.execute(
        'DELETE FROM assets WHERE id = $1 AND project_id = $2',
        [assetId, projectId],
      );
    },
  };

  return storage;
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToProject(r: any): ProjectInfo {
  return {
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    updated_at: r.updated_at,
    properties: JSON.parse(r.properties || '{}'),
    color: r.color || '',
    pinned: !!r.pinned,
    sort_order: r.sort_order ?? 0,
  };
}

function rowToScriptMeta(r: any): ScriptMeta {
  return {
    id: r.id,
    title: r.title,
    author: '',
    format: 'screenplay',
    created_at: r.created_at,
    updated_at: r.updated_at,
    page_count: r.page_count ?? 0,
    size_bytes: r.size_bytes ?? 0,
    color: r.color || '',
    pinned: !!r.pinned,
    sort_order: r.sort_order ?? 0,
    preview: '',
  };
}

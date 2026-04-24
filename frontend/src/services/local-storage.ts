/**
 * Local storage implementation for Tauri (desktop + mobile).
 *
 * Mirrors every method exported by `api` in api.ts but reads/writes from
 * a local SQLite database + filesystem instead of the Python backend.
 *
 * This file is **only** imported dynamically when `isTauri()` is true,
 * so it is tree-shaken out of web builds.
 *
 * Key differences from the old mobile-storage.ts:
 * - Script content is stored in a separate `script_content` table
 * - Versioning uses delta commits (only changed scripts stored per version)
 * - Collaboration calls the remote collab server instead of throwing
 * - Link preview uses a Tauri command (Rust-side HTTP fetch)
 */

import { getDb, simpleHash } from './db';
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
import { getCollabWsUrl } from '../config';
import type {
  ProjectInfo,
  ProjectProperties,
  ScriptMeta,
  ScriptResponse,
  VersionInfo,
  DiffResponse,
  CollabSession,
  LinkPreview,
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
  wga_registration: '', wga_registration_date: '',
  copyright_registration: '', copyright_year: '',
  agent_name: '', agent_contact: '',
  manager_name: '', manager_contact: '',
  submissions: [],
};

/** Ensure the assets directory exists for a project. */
async function ensureAssetDir(projectId: string): Promise<string> {
  const dir = `assets/${projectId}`;
  if (!(await exists(dir, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
  }
  return dir;
}

/**
 * Get the HTTP base URL for the collab server API.
 * Converts ws:// → http://, wss:// → https://
 */
function getCollabApiBase(): string {
  const wsUrl = getCollabWsUrl();
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://');
}

/**
 * Make an authenticated request to the collab server.
 * Uses platformFetch to bypass WebView mixed-content restrictions on Tauri.
 */
async function collabRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const { platformFetch } = await import('./platform');
  const { useSettingsStore } = await import('../stores/settingsStore');
  const base = getCollabApiBase();
  const url = `${base}${path}`;

  // Include auth token if available (collab server requires it for write operations)
  const { collabAuth } = useSettingsStore.getState();
  const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (collabAuth.accessToken) {
    authHeaders['Authorization'] = `Bearer ${collabAuth.accessToken}`;
  }

  console.log(`[collabRequest] ${options?.method || 'GET'} ${url}`);
  const res = await platformFetch(url, {
    ...options,
    headers: { ...authHeaders, ...options?.headers },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[collabRequest] ${url} → ${res.status}: ${detail}`);
    // Clear stale auth on 401 so the UI prompts for re-login
    if (res.status === 401) {
      useSettingsStore.getState().clearCollabAuth();
    }
    throw new Error(`Collab API error ${res.status}: ${detail}`);
  }
  return res.json();
}

// ── Public factory ───────────────────────────────────────────────────────────

/**
 * Create the local storage object. Its shape exactly matches the `api`
 * export in api.ts so it can be used as a drop-in replacement.
 */
export async function createLocalStorage() {
  const db = await getDb();

  // Ensure the root assets directory exists
  if (!(await exists('assets', { baseDir: BaseDirectory.AppData }))) {
    await mkdir('assets', { baseDir: BaseDirectory.AppData, recursive: true });
  }

  // Resolve the app data dir once for asset URLs
  const baseDir = await appDataDir();

  // In-memory cache of asset ID → filename so getAssetUrl (sync) can resolve
  // the correct filename (with extension) even when only an asset ID is passed.
  const assetFilenameCache: Record<string, string> = {};
  const rows = await db.select<{ id: string; filename: string }[]>('SELECT id, filename FROM assets');
  for (const r of rows) assetFilenameCache[r.id] = r.filename;

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
      data: { name?: string; properties?: Partial<ProjectProperties>; color?: string; pinned?: boolean; sort_order?: number },
    ): Promise<ProjectInfo> {
      const existing = await storage.getProject(id);
      const name = data.name ?? existing.name;
      const props = data.properties
        ? { ...existing.properties, ...data.properties }
        : existing.properties;
      const color = data.color ?? existing.color;
      const pinned = data.pinned ?? existing.pinned;
      const sort_order = data.sort_order ?? existing.sort_order;
      const ts = now();
      await db.execute(
        'UPDATE projects SET name = $1, properties = $2, updated_at = $3, color = $4, pinned = $5, sort_order = $6 WHERE id = $7',
        [name, JSON.stringify(props), ts, color, pinned ? 1 : 0, sort_order, id],
      );
      return { ...existing, name, properties: props, color, pinned, sort_order, updated_at: ts };
    },

    async deleteProject(id: string): Promise<{ message: string }> {
      await db.execute('DELETE FROM script_content WHERE script_id IN (SELECT id FROM scripts WHERE project_id = $1)', [id]);
      await db.execute('DELETE FROM scripts WHERE project_id = $1', [id]);
      await db.execute('DELETE FROM version_scripts WHERE commit_id IN (SELECT id FROM version_commits WHERE project_id = $1)', [id]);
      await db.execute('DELETE FROM version_commits WHERE project_id = $1', [id]);
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

    // ── Scripts ────────────────────────────────────────────────────────────

    async listScripts(projectId: string): Promise<ScriptMeta[]> {
      const rows = await db.select<any[]>(
        `SELECT id, project_id, title, page_count, size_bytes, created_at, updated_at,
                color, pinned, sort_order
         FROM scripts WHERE project_id = $1 ORDER BY created_at`,
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
        'INSERT INTO scripts (id, project_id, title, size_bytes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, projectId, data.title, sizeBytes, ts, ts],
      );
      if (contentStr) {
        await db.execute(
          'INSERT INTO script_content (script_id, content) VALUES ($1, $2)',
          [id, contentStr],
        );
      }
      await db.execute('UPDATE projects SET updated_at = $1 WHERE id = $2', [ts, projectId]);
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
        `SELECT s.*, sc.content
         FROM scripts s
         LEFT JOIN script_content sc ON sc.script_id = s.id
         WHERE s.id = $1 AND s.project_id = $2`,
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
      data: { title?: string; content?: Record<string, unknown>; color?: string; pinned?: boolean; sort_order?: number },
    ): Promise<ScriptResponse> {
      const existing = await storage.getScript(projectId, scriptId);
      const title = data.title ?? existing.meta.title;
      const content = data.content ?? existing.content;
      const contentStr = content ? JSON.stringify(content) : null;
      const sizeBytes = contentStr ? new Blob([contentStr]).size : 0;
      const color = data.color ?? existing.meta.color;
      const pinned = data.pinned ?? existing.meta.pinned;
      const sort_order = data.sort_order ?? existing.meta.sort_order;
      const ts = now();

      await db.execute(
        'UPDATE scripts SET title = $1, size_bytes = $2, updated_at = $3, color = $4, pinned = $5, sort_order = $6 WHERE id = $7',
        [title, sizeBytes, ts, color, pinned ? 1 : 0, sort_order, scriptId],
      );

      // Upsert content
      const existingContent = await db.select<any[]>(
        'SELECT script_id FROM script_content WHERE script_id = $1', [scriptId]
      );
      if (existingContent.length > 0) {
        await db.execute(
          'UPDATE script_content SET content = $1 WHERE script_id = $2',
          [contentStr, scriptId],
        );
      } else if (contentStr) {
        await db.execute(
          'INSERT INTO script_content (script_id, content) VALUES ($1, $2)',
          [scriptId, contentStr],
        );
      }

      await db.execute('UPDATE projects SET updated_at = $1 WHERE id = $2', [ts, projectId]);

      return {
        meta: { ...existing.meta, title, size_bytes: sizeBytes, updated_at: ts, color, pinned, sort_order },
        content,
      };
    },

    async deleteScript(
      projectId: string,
      scriptId: string,
    ): Promise<{ message: string }> {
      await db.execute('DELETE FROM script_content WHERE script_id = $1', [scriptId]);
      await db.execute('DELETE FROM scripts WHERE id = $1 AND project_id = $2', [scriptId, projectId]);
      await db.execute('UPDATE projects SET updated_at = $1 WHERE id = $2', [now(), projectId]);
      return { message: 'deleted' };
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
      const original = await storage.getScript(projectId, scriptId);
      const id = uuid();
      const ts = now();
      const contentStr = original.content ? JSON.stringify(original.content) : null;
      const sizeBytes = contentStr ? new Blob([contentStr]).size : 0;
      const title = `${original.meta.title} (Copy)`;

      await db.execute(
        'INSERT INTO scripts (id, project_id, title, size_bytes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, projectId, title, sizeBytes, ts, ts],
      );
      if (contentStr) {
        await db.execute(
          'INSERT INTO script_content (script_id, content) VALUES ($1, $2)',
          [id, contentStr],
        );
      }
      await db.execute('UPDATE projects SET updated_at = $1 WHERE id = $2', [ts, projectId]);

      return {
        meta: {
          id, title, author: '', format: 'screenplay',
          created_at: ts, updated_at: ts, page_count: 0, size_bytes: sizeBytes,
          color: '', pinned: false, sort_order: 0, preview: '',
        },
        content: original.content,
      };
    },

    // ── Versions (delta-based) ────────────────────────────────────────────

    async checkin(projectId: string, message: string): Promise<VersionInfo> {
      // Get all current scripts with content
      const scripts = await db.select<any[]>(
        `SELECT s.id, s.title, sc.content
         FROM scripts s
         LEFT JOIN script_content sc ON sc.script_id = s.id
         WHERE s.project_id = $1`,
        [projectId],
      );

      // Get the latest commit to compare against
      const lastCommits = await db.select<any[]>(
        `SELECT id FROM version_commits WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      );
      const lastCommitId = lastCommits.length > 0 ? lastCommits[0].id : null;

      // Get previous script hashes if there's a previous commit
      const prevHashes = new Map<string, string>();
      if (lastCommitId) {
        const prevScripts = await db.select<any[]>(
          `SELECT script_id, content_hash FROM version_scripts WHERE commit_id = $1`,
          [lastCommitId],
        );
        for (const ps of prevScripts) {
          prevHashes.set(ps.script_id, ps.content_hash);
        }
      }

      const commitId = uuid();
      const ts = now();

      await db.execute(
        'INSERT INTO version_commits (id, project_id, message, created_at) VALUES ($1, $2, $3, $4)',
        [commitId, projectId, message, ts],
      );

      for (const s of scripts) {
        const contentStr = s.content || '';
        const hash = await simpleHash(contentStr);
        const prevHash = prevHashes.get(s.id) || '';
        const inherited = (prevHash === hash && lastCommitId) ? 1 : 0;

        const vsId = uuid();
        await db.execute(
          `INSERT INTO version_scripts (id, commit_id, script_id, title, content, content_hash, inherited)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [vsId, commitId, s.id, s.title, inherited ? null : contentStr, hash, inherited],
        );
      }

      return { hash: commitId, short_hash: shortHash(commitId), message, date: ts };
    },

    async getVersions(projectId: string, scriptId?: string): Promise<VersionInfo[]> {
      const rows = await db.select<any[]>(
        'SELECT id, message, created_at FROM version_commits WHERE project_id = $1 ORDER BY created_at DESC',
        [projectId],
      );
      const all: VersionInfo[] = rows.map((r: any) => ({
        hash: r.id,
        short_hash: shortHash(r.id),
        message: r.message,
        date: r.created_at,
      }));
      if (!scriptId) return all;
      const filtered: VersionInfo[] = [];
      for (const v of all) {
        const scripts = await storage._resolveVersionScripts(v.hash);
        if (scripts.some((s) => s.script_id === scriptId)) filtered.push(v);
      }
      return filtered;
    },

    async getVersionDiff(
      _projectId: string,
      fromHash: string,
      toHash: string,
    ): Promise<DiffResponse> {
      // Get scripts for both versions
      const [fromScripts, toScripts] = await Promise.all([
        storage._resolveVersionScripts(fromHash),
        storage._resolveVersionScripts(toHash),
      ]);

      const fromMap = new Map(fromScripts.map(s => [s.script_id, s]));
      const toMap = new Map(toScripts.map(s => [s.script_id, s]));
      const allIds = new Set([...fromMap.keys(), ...toMap.keys()]);

      const lines: string[] = [];

      for (const sid of allIds) {
        const from = fromMap.get(sid);
        const to = toMap.get(sid);
        const title = to?.title || from?.title || sid;

        if (!from && to) {
          lines.push(`+++ New script: ${title}`);
        } else if (from && !to) {
          lines.push(`--- Deleted script: ${title}`);
        } else if (from && to && from.content_hash !== to.content_hash) {
          lines.push(`--- ${title}`);
          lines.push(`+++ ${title}`);
          lines.push('@@ modified @@');

          // Only do line diff if we have content
          const fromContent = from.content || '';
          const toContent = to.content || '';
          const fLines = fromContent.split('\n');
          const tLines = toContent.split('\n');
          const maxLen = Math.max(fLines.length, tLines.length);
          for (let i = 0; i < maxLen; i++) {
            if (fLines[i] !== tLines[i]) {
              if (fLines[i]) lines.push(`-${fLines[i]}`);
              if (tLines[i]) lines.push(`+${tLines[i]}`);
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

    async getScriptAtVersion(
      _projectId: string,
      hash: string,
      scriptId: string,
    ): Promise<ScriptResponse> {
      const scripts = await storage._resolveVersionScripts(hash);
      const found = scripts.find(s => s.script_id === scriptId);
      if (!found) throw new Error(`Script ${scriptId} not found in version ${hash}`);

      let content = null;
      if (found.content) {
        try { content = JSON.parse(found.content); } catch { /* invalid JSON */ }
      }

      return {
        meta: {
          id: found.script_id, title: found.title, author: '', format: 'screenplay',
          created_at: '', updated_at: '', page_count: 0, size_bytes: 0,
          color: '', pinned: false, sort_order: 0, preview: '',
        },
        content,
      };
    },

    async restoreVersion(
      projectId: string,
      hash: string,
    ): Promise<VersionInfo> {
      // Verify the commit exists
      const commits = await db.select<any[]>(
        'SELECT * FROM version_commits WHERE id = $1 AND project_id = $2',
        [hash, projectId],
      );
      if (!commits.length) throw new Error(`Version not found: ${hash}`);

      // Resolve all scripts at this version (handles inherited content)
      const versionScripts = await storage._resolveVersionScripts(hash);
      const ts = now();

      // Delete current scripts and content
      await db.execute(
        'DELETE FROM script_content WHERE script_id IN (SELECT id FROM scripts WHERE project_id = $1)',
        [projectId],
      );
      await db.execute('DELETE FROM scripts WHERE project_id = $1', [projectId]);

      // Re-insert from version
      for (const s of versionScripts) {
        const sizeBytes = s.content ? new Blob([s.content]).size : 0;
        await db.execute(
          'INSERT INTO scripts (id, project_id, title, size_bytes, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [s.script_id, projectId, s.title, sizeBytes, ts, ts],
        );
        if (s.content) {
          await db.execute(
            'INSERT INTO script_content (script_id, content) VALUES ($1, $2)',
            [s.script_id, s.content],
          );
        }
      }

      await db.execute('UPDATE projects SET updated_at = $1 WHERE id = $2', [ts, projectId]);

      return {
        hash,
        short_hash: shortHash(hash),
        message: commits[0].message,
        date: commits[0].created_at,
      };
    },

    /**
     * Internal: resolve all scripts at a given commit, walking back through
     * inherited references to find the actual content.
     */
    async _resolveVersionScripts(commitId: string): Promise<Array<{
      script_id: string;
      title: string;
      content: string;
      content_hash: string;
    }>> {
      const vsRows = await db.select<any[]>(
        'SELECT * FROM version_scripts WHERE commit_id = $1',
        [commitId],
      );

      const result: Array<{ script_id: string; title: string; content: string; content_hash: string }> = [];

      for (const vs of vsRows) {
        if (!vs.inherited) {
          // Content stored directly
          result.push({
            script_id: vs.script_id,
            title: vs.title,
            content: vs.content || '',
            content_hash: vs.content_hash,
          });
        } else {
          // Walk backwards through commits to find the actual content
          const content = await storage._resolveInheritedContent(vs.script_id, commitId);
          result.push({
            script_id: vs.script_id,
            title: vs.title,
            content,
            content_hash: vs.content_hash,
          });
        }
      }

      return result;
    },

    /**
     * Walk backwards through version commits to find the most recent
     * non-inherited content for a script.
     */
    async _resolveInheritedContent(scriptId: string, beforeCommitId: string): Promise<string> {
      // Get the commit's created_at for ordering
      const commitRows = await db.select<any[]>(
        'SELECT project_id, created_at FROM version_commits WHERE id = $1',
        [beforeCommitId],
      );
      if (!commitRows.length) return '';

      const { project_id, created_at } = commitRows[0];

      // Find earlier commits with actual content for this script
      const rows = await db.select<any[]>(
        `SELECT vs.content FROM version_scripts vs
         JOIN version_commits vc ON vc.id = vs.commit_id
         WHERE vs.script_id = $1
           AND vc.project_id = $2
           AND vc.created_at < $3
           AND vs.inherited = 0
         ORDER BY vc.created_at DESC
         LIMIT 1`,
        [scriptId, project_id, created_at],
      );

      return rows.length > 0 ? (rows[0].content || '') : '';
    },

    // ── Collaboration (via remote collab server) ──────────────────────────

    async createCollabInvite(
      projectId: string,
      scriptId: string,
      collaboratorName: string,
      role: string = 'editor',
      expiresInHours: number = 1,
      sessionNonce: string = '',
    ): Promise<CollabSession> {
      return collabRequest<CollabSession>('/api/collab/invite', {
        method: 'POST',
        body: JSON.stringify({
          project_id: projectId,
          script_id: scriptId,
          collaborator_name: collaboratorName,
          role,
          expires_in_hours: expiresInHours,
          session_nonce: sessionNonce,
        }),
      });
    },

    async validateCollabSession(token: string): Promise<CollabSession> {
      return collabRequest<CollabSession>(`/api/collab/session/${token}`);
    },

    async listCollabSessions(projectId: string, scriptId: string): Promise<CollabSession[]> {
      return collabRequest<CollabSession[]>(`/api/collab/sessions/${projectId}/${scriptId}`);
    },

    async revokeCollabSession(token: string): Promise<{ message: string }> {
      return collabRequest<{ message: string }>(`/api/collab/session/${token}`, { method: 'DELETE' });
    },

    async revokeAllCollabSessions(projectId: string, scriptId: string): Promise<{ message: string }> {
      return collabRequest<{ message: string }>(`/api/collab/sessions/${projectId}/${scriptId}`, { method: 'DELETE' });
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

      const dir = await ensureAssetDir(projectId);
      const buffer = new Uint8Array(await file.arrayBuffer());
      await writeFile(`${dir}/${filename}`, buffer, {
        baseDir: BaseDirectory.AppData,
      });

      await db.execute(
        'INSERT INTO assets (id, project_id, filename, original_name, mime_type, size_bytes, tags, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id, projectId, filename, file.name, file.type || 'application/octet-stream', file.size, JSON.stringify(tags), ts],
      );

      assetFilenameCache[id] = filename;

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
      const fn = filename || assetFilenameCache[assetId] || assetId;
      const filePath = `${baseDir}/assets/${projectId}/${fn}`;
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
      delete assetFilenameCache[assetId];
    },

    // ── Link preview (via Tauri command) ──────────────────────────────────

    async fetchLinkPreview(url: string): Promise<LinkPreview> {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<LinkPreview>('fetch_link_preview', { url });
      } catch {
        // Fallback: return minimal preview with just the URL
        return { url, title: '', description: '', image: '', site_name: '' };
      }
    },

    // ── Formatting templates ──────────────────────────────────────────────

    async listFormattingTemplates(): Promise<any[]> {
      const rows = await db.select<any[]>(
        `SELECT * FROM formatting_templates ORDER BY name`,
      );
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        mode: r.mode,
        rules: JSON.parse(r.rules),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },

    async createFormattingTemplate(template: any): Promise<void> {
      await db.execute(
        `INSERT INTO formatting_templates (id, name, description, mode, rules, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          template.id,
          template.name,
          template.description,
          template.mode,
          JSON.stringify(template.rules),
          template.createdAt,
          template.updatedAt,
        ],
      );
    },

    async updateFormattingTemplate(id: string, template: any): Promise<void> {
      await db.execute(
        `UPDATE formatting_templates SET name = $1, description = $2, mode = $3, rules = $4, updated_at = $5 WHERE id = $6`,
        [template.name, template.description, template.mode, JSON.stringify(template.rules), template.updatedAt, id],
      );
    },

    async deleteFormattingTemplate(id: string): Promise<void> {
      await db.execute(`DELETE FROM formatting_templates WHERE id = $1`, [id]);
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

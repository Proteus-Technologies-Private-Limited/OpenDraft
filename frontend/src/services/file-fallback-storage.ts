/**
 * File-backed fallback storage for Tauri when the SQLite plugin is unavailable.
 *
 * Layout:
 *   localStorage  → opendraft:file-fallback:index
 *                   { projects, scripts (metadata only), assets (metadata only),
 *                     templates }
 *   $APPDATA/file-fallback/
 *     scripts/<scriptId>.json     ← script content blob
 *     assets/<projectId>/<id>.<ext>  ← raw asset bytes
 *
 * This avoids the 5–10 MB localStorage cap that the original fallback ran into
 * on Windows: the index is tiny (a few KB even with hundreds of scripts) and
 * all bulk content lives on disk.
 *
 * The interface mirrors `local-storage.ts` and `fallback-storage.ts` so it can
 * be swapped in via `Object.assign(api, ...)` without touching call sites.
 */

import {
  mkdir,
  writeFile,
  writeTextFile,
  readFile,
  readTextFile,
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
  CollabSession,
  LinkPreview,
  DemoInfo,
} from './api';

const INDEX_KEY = 'opendraft:file-fallback:index';
const LEGACY_FALLBACK_KEY = 'opendraft:fallback';
const ROOT_DIR = 'file-fallback';
const SCRIPTS_DIR = `${ROOT_DIR}/scripts`;
const ASSETS_DIR = `${ROOT_DIR}/assets`;

// ── Types ────────────────────────────────────────────────────────────────────

interface AssetMeta {
  id: string;
  project_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  tags: string[];
  created_at: string;
}

interface IndexShape {
  projects: Record<string, ProjectInfo>;
  scripts: Record<string, { meta: ScriptMeta; project_id: string }>;
  assets: Record<string, AssetMeta>;
  templates: Record<string, any>;
}

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

function emptyIndex(): IndexShape {
  return { projects: {}, scripts: {}, assets: {}, templates: {} };
}

function loadIndex(): IndexShape {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Defensive: tolerate older index versions that lacked some fields.
      return {
        projects: parsed.projects || {},
        scripts: parsed.scripts || {},
        assets: parsed.assets || {},
        templates: parsed.templates || {},
      };
    }
  } catch (e) {
    console.error('File fallback: corrupt index, starting fresh', e);
  }
  return emptyIndex();
}

function saveIndex(index: IndexShape): void {
  // The index is tiny (metadata only, no content), so localStorage quota
  // shouldn't fire here in practice.  Still propagate failures so the editor
  // sees them and can show "Save failed" instead of silently losing data.
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (e) {
    console.error('File fallback: failed to write index', e);
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Index write failed: ${msg}`);
  }
}

function scriptPath(scriptId: string): string {
  return `${SCRIPTS_DIR}/${scriptId}.json`;
}

function assetPath(projectId: string, filename: string): string {
  return `${ASSETS_DIR}/${projectId}/${filename}`;
}

async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(path, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

async function readScriptContent(scriptId: string): Promise<any | null> {
  const path = scriptPath(scriptId);
  if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) return null;
  try {
    const text = await readTextFile(path, { baseDir: BaseDirectory.AppData });
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    console.error(`File fallback: failed to read ${path}`, e);
    throw new Error(
      `Could not read script file (${scriptId}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function writeScriptContent(scriptId: string, content: any): Promise<number> {
  const path = scriptPath(scriptId);
  const text = content == null ? '' : JSON.stringify(content);
  try {
    await ensureDir(SCRIPTS_DIR);
    await writeTextFile(path, text, { baseDir: BaseDirectory.AppData });
    return new Blob([text]).size;
  } catch (e) {
    console.error(`File fallback: failed to write ${path}`, e);
    throw new Error(
      `Could not write script file (${scriptId}): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function deleteScriptFile(scriptId: string): Promise<void> {
  const path = scriptPath(scriptId);
  try {
    if (await exists(path, { baseDir: BaseDirectory.AppData })) {
      await remove(path, { baseDir: BaseDirectory.AppData });
    }
  } catch (e) {
    // Best-effort: a stranded file is preferable to a failed delete leaking
    // through to the UI.  Log so it's visible in DevTools.
    console.warn(`File fallback: could not remove ${path}`, e);
  }
}

// ── Migration from the old localStorage-only fallback ───────────────────────

/**
 * If a previous version stored everything (including content) in
 * `opendraft:fallback`, copy projects/scripts/templates over to the new
 * file-backed layout and remove the legacy entry.  Idempotent.
 */
async function migrateFromLegacyLocalStorage(): Promise<void> {
  const legacyRaw = localStorage.getItem(LEGACY_FALLBACK_KEY);
  if (!legacyRaw) return;
  let legacy: any;
  try {
    legacy = JSON.parse(legacyRaw);
  } catch (e) {
    console.error('File fallback: legacy data corrupt, leaving in place', e);
    return;
  }
  const index = loadIndex();
  const isFresh =
    Object.keys(index.projects).length === 0 &&
    Object.keys(index.scripts).length === 0;

  if (legacy?.projects && typeof legacy.projects === 'object') {
    for (const [pid, p] of Object.entries(legacy.projects)) {
      if (!index.projects[pid]) index.projects[pid] = p as ProjectInfo;
    }
  }

  if (legacy?.scripts && typeof legacy.scripts === 'object') {
    for (const [sid, entry] of Object.entries<any>(legacy.scripts)) {
      if (!entry || !entry.meta) continue;
      // Write content to file (only if not already migrated)
      if (entry.content !== undefined && entry.content !== null) {
        const path = scriptPath(sid);
        const alreadyOnDisk = await exists(path, { baseDir: BaseDirectory.AppData });
        if (!alreadyOnDisk) {
          try {
            await writeScriptContent(sid, entry.content);
          } catch (err) {
            console.error(`Migration: could not persist script ${sid}`, err);
            continue;
          }
        }
      }
      if (!index.scripts[sid]) {
        index.scripts[sid] = {
          meta: entry.meta,
          project_id: entry.project_id,
        };
      }
    }
  }

  if (legacy?.templates && typeof legacy.templates === 'object') {
    for (const [tid, t] of Object.entries(legacy.templates)) {
      if (!index.templates[tid]) index.templates[tid] = t;
    }
  }

  saveIndex(index);

  // Only remove the legacy blob once the migration has actually written
  // something (or there was nothing to migrate against an empty index).
  if (isFresh || Object.keys(legacy?.scripts || {}).length === 0) {
    localStorage.removeItem(LEGACY_FALLBACK_KEY);
  } else {
    // Mark migrated so we don't repeat the work next launch but keep the
    // raw blob around for forensics.
    localStorage.setItem(`${LEGACY_FALLBACK_KEY}:migrated`, now());
    localStorage.removeItem(LEGACY_FALLBACK_KEY);
  }
}

// ── Public factory ───────────────────────────────────────────────────────────

export async function createFileFallbackStorage() {
  console.warn(
    '%c[OpenDraft] Using file-based fallback storage — Tauri SQLite unavailable',
    'color: #ff9f43; font-weight: bold',
  );

  await ensureDir(ROOT_DIR);
  await ensureDir(SCRIPTS_DIR);
  await ensureDir(ASSETS_DIR);

  await migrateFromLegacyLocalStorage();

  // Cache app-data dir for sync getAssetUrl().
  const baseDir = await appDataDir();

  return {
    getDemoInfo: async (): Promise<DemoInfo> => ({ demo: false, message: null }),

    // ── Projects ──────────────────────────────────────────────────────

    listProjects: async (): Promise<ProjectInfo[]> => {
      const idx = loadIndex();
      return Object.values(idx.projects).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    },

    createProject: async (name: string): Promise<ProjectInfo> => {
      const idx = loadIndex();
      const id = uuid();
      const ts = now();
      const project: ProjectInfo = {
        id, name, created_at: ts, updated_at: ts,
        properties: { ...EMPTY_PROPS }, color: '', pinned: false, sort_order: 0,
      };
      idx.projects[id] = project;
      saveIndex(idx);
      return project;
    },

    getProject: async (id: string): Promise<ProjectInfo> => {
      const idx = loadIndex();
      const p = idx.projects[id];
      if (!p) throw new Error(`Project not found: ${id}`);
      return p;
    },

    updateProject: async (
      id: string,
      updates: { name?: string; properties?: Partial<ProjectProperties>; color?: string; pinned?: boolean; sort_order?: number },
    ): Promise<ProjectInfo> => {
      const idx = loadIndex();
      const p = idx.projects[id];
      if (!p) throw new Error(`Project not found: ${id}`);
      if (updates.name !== undefined) p.name = updates.name;
      if (updates.properties) p.properties = { ...p.properties, ...updates.properties };
      if (updates.color !== undefined) p.color = updates.color;
      if (updates.pinned !== undefined) p.pinned = updates.pinned;
      if (updates.sort_order !== undefined) p.sort_order = updates.sort_order;
      p.updated_at = now();
      saveIndex(idx);
      return p;
    },

    deleteProject: async (id: string): Promise<{ message: string }> => {
      const idx = loadIndex();
      delete idx.projects[id];
      // Cascade: delete scripts (and their files) + assets belonging to this project
      for (const [sid, s] of Object.entries(idx.scripts)) {
        if (s.project_id === id) {
          await deleteScriptFile(sid);
          delete idx.scripts[sid];
        }
      }
      for (const [aid, a] of Object.entries(idx.assets)) {
        if (a.project_id === id) {
          try {
            const path = assetPath(id, a.filename);
            if (await exists(path, { baseDir: BaseDirectory.AppData })) {
              await remove(path, { baseDir: BaseDirectory.AppData });
            }
          } catch (e) {
            console.warn(`File fallback: could not remove asset ${aid}`, e);
          }
          delete idx.assets[aid];
        }
      }
      saveIndex(idx);
      return { message: 'Deleted' };
    },

    reorderProjects: async (items: Array<{ id: string; sort_order: number }>): Promise<{ message: string }> => {
      const idx = loadIndex();
      for (const item of items) {
        if (idx.projects[item.id]) idx.projects[item.id].sort_order = item.sort_order;
      }
      saveIndex(idx);
      return { message: 'Reordered' };
    },

    // ── Scripts ───────────────────────────────────────────────────────

    listScripts: async (projectId: string): Promise<ScriptMeta[]> => {
      const idx = loadIndex();
      return Object.values(idx.scripts)
        .filter((s) => s.project_id === projectId)
        .map((s) => s.meta)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    },

    createScript: async (
      projectId: string,
      scriptData: { title: string; content?: any },
    ): Promise<ScriptResponse> => {
      const idx = loadIndex();
      const id = uuid();
      const ts = now();
      const content = scriptData.content ?? null;
      const sizeBytes = content == null ? 0 : await writeScriptContent(id, content);
      const meta: ScriptMeta = {
        id, title: scriptData.title, author: '', format: 'screenplay',
        created_at: ts, updated_at: ts, page_count: 0,
        size_bytes: sizeBytes, color: '', pinned: false, sort_order: 0, preview: '',
      };
      idx.scripts[id] = { meta, project_id: projectId };
      if (idx.projects[projectId]) idx.projects[projectId].updated_at = ts;
      saveIndex(idx);
      return { meta, content };
    },

    getScript: async (projectId: string, scriptId: string): Promise<ScriptResponse> => {
      const idx = loadIndex();
      const s = idx.scripts[scriptId];
      if (!s || s.project_id !== projectId) throw new Error(`Script not found: ${scriptId}`);
      const content = await readScriptContent(scriptId);
      return { meta: s.meta, content };
    },

    saveScript: async (
      projectId: string,
      scriptId: string,
      updates: { title?: string; content?: any; color?: string; pinned?: boolean; sort_order?: number },
    ): Promise<ScriptResponse> => {
      const idx = loadIndex();
      const s = idx.scripts[scriptId];
      if (!s) throw new Error(`Script not found: ${scriptId}`);
      let content: any = undefined;
      if (updates.content !== undefined) {
        // Persist content first so a failed write does NOT also corrupt the
        // in-memory metadata (size_bytes, updated_at) before the file is good.
        const sizeBytes = await writeScriptContent(scriptId, updates.content);
        s.meta.size_bytes = sizeBytes;
        content = updates.content;
      }
      if (updates.title !== undefined) s.meta.title = updates.title;
      if (updates.color !== undefined) s.meta.color = updates.color;
      if (updates.pinned !== undefined) s.meta.pinned = updates.pinned;
      if (updates.sort_order !== undefined) s.meta.sort_order = updates.sort_order;
      s.meta.updated_at = now();
      if (idx.projects[projectId]) idx.projects[projectId].updated_at = s.meta.updated_at;
      saveIndex(idx);
      // If caller didn't supply content, fall through to disk for the response.
      if (content === undefined) content = await readScriptContent(scriptId);
      return { meta: s.meta, content };
    },

    reorderScripts: async (
      _projectId: string,
      items: Array<{ id: string; sort_order: number }>,
    ): Promise<{ message: string }> => {
      const idx = loadIndex();
      for (const item of items) {
        if (idx.scripts[item.id]) idx.scripts[item.id].meta.sort_order = item.sort_order;
      }
      saveIndex(idx);
      return { message: 'Reordered' };
    },

    duplicateScript: async (projectId: string, scriptId: string): Promise<ScriptResponse> => {
      const idx = loadIndex();
      const orig = idx.scripts[scriptId];
      if (!orig) throw new Error(`Script not found: ${scriptId}`);
      const id = uuid();
      const ts = now();
      const content = await readScriptContent(scriptId);
      const sizeBytes = content == null ? 0 : await writeScriptContent(id, content);
      const meta: ScriptMeta = {
        ...orig.meta, id, title: `${orig.meta.title} (Copy)`,
        created_at: ts, updated_at: ts, size_bytes: sizeBytes,
      };
      idx.scripts[id] = { meta, project_id: projectId };
      saveIndex(idx);
      return { meta, content };
    },

    deleteScript: async (_projectId: string, scriptId: string): Promise<{ message: string }> => {
      const idx = loadIndex();
      delete idx.scripts[scriptId];
      saveIndex(idx);
      await deleteScriptFile(scriptId);
      return { message: 'Deleted' };
    },

    // ── Versions (no-op in fallback) ─────────────────────────────────

    checkin: async (): Promise<VersionInfo> => {
      throw new Error('Versioning is not available in file-fallback mode');
    },
    getVersions: async (): Promise<VersionInfo[]> => [],
    getVersionDiff: async (): Promise<DiffResponse> => ({ diff: '', from_hash: '', to_hash: '' }),
    getScriptAtVersion: async (): Promise<ScriptResponse> => {
      throw new Error('Versioning is not available in file-fallback mode');
    },
    restoreVersion: async (): Promise<VersionInfo> => {
      throw new Error('Versioning is not available in file-fallback mode');
    },

    // ── Collaboration (network-only) ─────────────────────────────────

    createCollabInvite: async (): Promise<CollabSession> => {
      throw new Error('Collaboration requires the SQLite-backed storage');
    },
    validateCollabSession: async (): Promise<CollabSession> => {
      throw new Error('Collaboration requires the SQLite-backed storage');
    },
    listCollabSessions: async (): Promise<CollabSession[]> => [],
    revokeCollabSession: async (): Promise<{ message: string }> => ({ message: 'ok' }),
    revokeAllCollabSessions: async (): Promise<{ message: string }> => ({ message: 'ok' }),

    // ── Assets ────────────────────────────────────────────────────────

    listAssets: async (projectId: string): Promise<any[]> => {
      const idx = loadIndex();
      return Object.values(idx.assets)
        .filter((a) => a.project_id === projectId)
        .map((a) => ({
          id: a.id,
          filename: a.filename,
          original_name: a.original_name,
          mime_type: a.mime_type,
          size_bytes: a.size_bytes,
          tags: a.tags,
          created_at: a.created_at,
        }))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },

    uploadAsset: async (projectId: string, file: File, tags: string[] = []): Promise<any> => {
      const idx = loadIndex();
      const id = uuid();
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const filename = ext ? `${id}.${ext}` : id;
      const ts = now();
      const projectAssetDir = `${ASSETS_DIR}/${projectId}`;
      await ensureDir(projectAssetDir);
      const buffer = new Uint8Array(await file.arrayBuffer());
      try {
        await writeFile(`${projectAssetDir}/${filename}`, buffer, {
          baseDir: BaseDirectory.AppData,
        });
      } catch (e) {
        throw new Error(
          `Could not write asset file: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const meta: AssetMeta = {
        id,
        project_id: projectId,
        filename,
        original_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        tags,
        created_at: ts,
      };
      idx.assets[id] = meta;
      saveIndex(idx);
      return {
        id,
        filename,
        original_name: meta.original_name,
        mime_type: meta.mime_type,
        size_bytes: meta.size_bytes,
        tags: meta.tags,
        created_at: ts,
      };
    },

    getAssetBytes: async (_projectId: string, assetId: string): Promise<Uint8Array> => {
      const idx = loadIndex();
      const a = idx.assets[assetId];
      if (!a) throw new Error(`Asset not found: ${assetId}`);
      return readFile(assetPath(a.project_id, a.filename), {
        baseDir: BaseDirectory.AppData,
      });
    },

    updateAssetTags: async (
      _projectId: string,
      assetId: string,
      tags: string[],
    ): Promise<void> => {
      const idx = loadIndex();
      const a = idx.assets[assetId];
      if (!a) throw new Error(`Asset not found: ${assetId}`);
      a.tags = tags;
      saveIndex(idx);
    },

    getAssetUrl: (projectId: string, assetId: string, filename?: string): string => {
      const idx = loadIndex();
      const meta = idx.assets[assetId];
      const fn = filename || (meta && meta.filename) || assetId;
      // baseDir is captured from appDataDir() above; joinPath is async, so
      // synthesize the path directly.  AppData paths use forward slashes for
      // convertFileSrc on all platforms.
      const filePath = `${baseDir}/${ASSETS_DIR}/${projectId}/${fn}`;
      return convertFileSrc(filePath);
    },

    deleteAsset: async (projectId: string, assetId: string): Promise<void> => {
      const idx = loadIndex();
      const a = idx.assets[assetId];
      if (!a) return;
      try {
        const path = assetPath(projectId, a.filename);
        if (await exists(path, { baseDir: BaseDirectory.AppData })) {
          await remove(path, { baseDir: BaseDirectory.AppData });
        }
      } catch (e) {
        console.warn(`File fallback: could not remove asset file`, e);
      }
      delete idx.assets[assetId];
      saveIndex(idx);
    },

    fetchLinkPreview: async (url: string): Promise<LinkPreview> => {
      // Best-effort: defer to the Rust command if available.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<LinkPreview>('fetch_link_preview', { url });
      } catch {
        return { url, title: '', description: '', image: '', site_name: '' };
      }
    },

    // ── Formatting templates ─────────────────────────────────────────

    listFormattingTemplates: async (): Promise<any[]> => {
      const idx = loadIndex();
      return Object.values(idx.templates);
    },
    createFormattingTemplate: async (template: any): Promise<any> => {
      const idx = loadIndex();
      const id = uuid();
      const ts = now();
      const t = { ...template, id, created_at: ts, updated_at: ts };
      idx.templates[id] = t;
      saveIndex(idx);
      return t;
    },
    updateFormattingTemplate: async (id: string, template: any): Promise<any> => {
      const idx = loadIndex();
      idx.templates[id] = { ...idx.templates[id], ...template, updated_at: now() };
      saveIndex(idx);
      return idx.templates[id];
    },
    deleteFormattingTemplate: async (id: string): Promise<any> => {
      const idx = loadIndex();
      delete idx.templates[id];
      saveIndex(idx);
      return { message: 'Deleted' };
    },
  };
}


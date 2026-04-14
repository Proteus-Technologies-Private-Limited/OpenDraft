/**
 * localStorage-based fallback storage for when Tauri SQLite is unavailable.
 *
 * This kicks in on older macOS versions (e.g. Catalina) where Tauri's IPC
 * or WKWebView APIs may not work. It provides the same interface as the
 * local-storage.ts SQLite implementation but uses browser localStorage.
 *
 * Limitations:
 * - 5 MB total storage limit (enough for several screenplays)
 * - No asset storage (images/files)
 * - No versioning (check-in/restore)
 * - Data is stored per-origin in the browser/WebView
 */

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

const STORAGE_KEY = 'opendraft:fallback';

interface FallbackData {
  projects: Record<string, ProjectInfo>;
  scripts: Record<string, { meta: ScriptMeta; content: any; project_id: string }>;
  templates: Record<string, any>;
}

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

function loadData(): FallbackData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt data */ }
  return { projects: {}, scripts: {}, templates: {} };
}

function saveData(data: FallbackData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Fallback storage: failed to save (quota exceeded?)', e);
  }
}

const EMPTY_PROPS: ProjectProperties = {
  genre: '', logline: '', synopsis: '', author: '', contact: '',
  copyright: '', draft: '', language: 'en', format: 'screenplay',
  production_company: '', director: '', producer: '', status: '',
  target_length: '', notes: '',
};

export function createFallbackStorage() {
  console.warn(
    '%c[OpenDraft] Using localStorage fallback — Tauri storage unavailable',
    'color: #ff9f43; font-weight: bold'
  );

  return {
    getDemoInfo: async (): Promise<DemoInfo> => ({ demo: false, message: null }),

    // ── Projects ──────────────────────────────────────────────────────

    listProjects: async (): Promise<ProjectInfo[]> => {
      const data = loadData();
      return Object.values(data.projects).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    },

    createProject: async (name: string): Promise<ProjectInfo> => {
      const data = loadData();
      const id = uuid();
      const ts = now();
      const project: ProjectInfo = {
        id, name, created_at: ts, updated_at: ts,
        properties: { ...EMPTY_PROPS }, color: '', pinned: false, sort_order: 0,
      };
      data.projects[id] = project;
      saveData(data);
      return project;
    },

    getProject: async (id: string): Promise<ProjectInfo> => {
      const data = loadData();
      const p = data.projects[id];
      if (!p) throw new Error(`Project not found: ${id}`);
      return p;
    },

    updateProject: async (
      id: string,
      updates: { name?: string; properties?: Partial<ProjectProperties>; color?: string; pinned?: boolean; sort_order?: number },
    ): Promise<ProjectInfo> => {
      const data = loadData();
      const p = data.projects[id];
      if (!p) throw new Error(`Project not found: ${id}`);
      if (updates.name !== undefined) p.name = updates.name;
      if (updates.properties) p.properties = { ...p.properties, ...updates.properties };
      if (updates.color !== undefined) p.color = updates.color;
      if (updates.pinned !== undefined) p.pinned = updates.pinned;
      if (updates.sort_order !== undefined) p.sort_order = updates.sort_order;
      p.updated_at = now();
      saveData(data);
      return p;
    },

    deleteProject: async (id: string): Promise<{ message: string }> => {
      const data = loadData();
      delete data.projects[id];
      // Delete all scripts for this project
      for (const [sid, s] of Object.entries(data.scripts)) {
        if (s.project_id === id) delete data.scripts[sid];
      }
      saveData(data);
      return { message: 'Deleted' };
    },

    reorderProjects: async (items: Array<{ id: string; sort_order: number }>): Promise<{ message: string }> => {
      const data = loadData();
      for (const item of items) {
        if (data.projects[item.id]) data.projects[item.id].sort_order = item.sort_order;
      }
      saveData(data);
      return { message: 'Reordered' };
    },

    // ── Scripts ───────────────────────────────────────────────────────

    listScripts: async (projectId: string): Promise<ScriptMeta[]> => {
      const data = loadData();
      return Object.values(data.scripts)
        .filter((s) => s.project_id === projectId)
        .map((s) => s.meta)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    },

    createScript: async (projectId: string, scriptData: { title: string; content?: any }): Promise<ScriptResponse> => {
      const data = loadData();
      const id = uuid();
      const ts = now();
      const content = scriptData.content || null;
      const contentStr = content ? JSON.stringify(content) : '';
      const meta: ScriptMeta = {
        id, title: scriptData.title, author: '', format: 'screenplay',
        created_at: ts, updated_at: ts, page_count: 0,
        size_bytes: contentStr.length, color: '', pinned: false, sort_order: 0, preview: '',
      };
      data.scripts[id] = { meta, content, project_id: projectId };
      // Update project timestamp
      if (data.projects[projectId]) data.projects[projectId].updated_at = ts;
      saveData(data);
      return { meta, content };
    },

    getScript: async (projectId: string, scriptId: string): Promise<ScriptResponse> => {
      const data = loadData();
      const s = data.scripts[scriptId];
      if (!s || s.project_id !== projectId) throw new Error(`Script not found: ${scriptId}`);
      return { meta: s.meta, content: s.content };
    },

    saveScript: async (
      projectId: string,
      scriptId: string,
      updates: { title?: string; content?: any; color?: string; pinned?: boolean; sort_order?: number },
    ): Promise<ScriptResponse> => {
      const data = loadData();
      const s = data.scripts[scriptId];
      if (!s) throw new Error(`Script not found: ${scriptId}`);
      if (updates.title !== undefined) s.meta.title = updates.title;
      if (updates.content !== undefined) {
        s.content = updates.content;
        s.meta.size_bytes = JSON.stringify(updates.content).length;
      }
      if (updates.color !== undefined) s.meta.color = updates.color;
      if (updates.pinned !== undefined) s.meta.pinned = updates.pinned;
      if (updates.sort_order !== undefined) s.meta.sort_order = updates.sort_order;
      s.meta.updated_at = now();
      if (data.projects[projectId]) data.projects[projectId].updated_at = now();
      saveData(data);
      return { meta: s.meta, content: s.content };
    },

    reorderScripts: async (_projectId: string, items: Array<{ id: string; sort_order: number }>): Promise<{ message: string }> => {
      const data = loadData();
      for (const item of items) {
        if (data.scripts[item.id]) data.scripts[item.id].meta.sort_order = item.sort_order;
      }
      saveData(data);
      return { message: 'Reordered' };
    },

    duplicateScript: async (projectId: string, scriptId: string): Promise<ScriptResponse> => {
      const data = loadData();
      const orig = data.scripts[scriptId];
      if (!orig) throw new Error(`Script not found: ${scriptId}`);
      const id = uuid();
      const ts = now();
      const meta: ScriptMeta = { ...orig.meta, id, title: `${orig.meta.title} (Copy)`, created_at: ts, updated_at: ts };
      data.scripts[id] = { meta, content: JSON.parse(JSON.stringify(orig.content)), project_id: projectId };
      saveData(data);
      return { meta, content: data.scripts[id].content };
    },

    deleteScript: async (_projectId: string, scriptId: string): Promise<{ message: string }> => {
      const data = loadData();
      delete data.scripts[scriptId];
      saveData(data);
      return { message: 'Deleted' };
    },

    // ── Versions (no-op in fallback) ─────────────────────────────────

    checkin: async (): Promise<VersionInfo> => {
      throw new Error('Versioning is not available in fallback storage mode');
    },
    getVersions: async (): Promise<VersionInfo[]> => [],
    getVersionDiff: async (): Promise<DiffResponse> => ({ diff: '', from_hash: '', to_hash: '' }),
    getScriptAtVersion: async (): Promise<ScriptResponse> => { throw new Error('Not available in fallback mode'); },
    restoreVersion: async (): Promise<VersionInfo> => { throw new Error('Not available in fallback mode'); },

    // ── Collaboration (pass-through — still works via HTTP) ──────────

    createCollabInvite: async (): Promise<CollabSession> => { throw new Error('Collaboration requires network access'); },
    validateCollabSession: async (): Promise<CollabSession> => { throw new Error('Not available'); },
    listCollabSessions: async (): Promise<CollabSession[]> => [],
    revokeCollabSession: async (): Promise<{ message: string }> => ({ message: 'ok' }),
    revokeAllCollabSessions: async (): Promise<{ message: string }> => ({ message: 'ok' }),

    // ── Assets (not supported in fallback) ───────────────────────────

    listAssets: async (): Promise<any[]> => [],
    uploadAsset: async (): Promise<any> => { throw new Error('Asset uploads are not available in fallback storage mode'); },
    deleteAsset: async (): Promise<void> => {},
    updateAssetTags: async (): Promise<void> => {},
    getAssetUrl: (): string => '',
    fetchLinkPreview: async (): Promise<LinkPreview> => ({ url: '', title: '', description: '', image: '', site_name: '' }),

    // ── Formatting templates ─────────────────────────────────────────

    listFormattingTemplates: async (): Promise<any[]> => {
      const data = loadData();
      return Object.values(data.templates);
    },
    createFormattingTemplate: async (template: any): Promise<any> => {
      const data = loadData();
      const id = uuid();
      const ts = now();
      const t = { ...template, id, created_at: ts, updated_at: ts };
      data.templates[id] = t;
      saveData(data);
      return t;
    },
    updateFormattingTemplate: async (id: string, template: any): Promise<any> => {
      const data = loadData();
      data.templates[id] = { ...data.templates[id], ...template, updated_at: now() };
      saveData(data);
      return data.templates[id];
    },
    deleteFormattingTemplate: async (id: string): Promise<any> => {
      const data = loadData();
      delete data.templates[id];
      saveData(data);
      return { message: 'Deleted' };
    },
  };
}

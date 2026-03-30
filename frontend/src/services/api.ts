import { API_BASE } from '../config';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectProperties {
  genre: string;
  logline: string;
  synopsis: string;
  author: string;
  contact: string;
  copyright: string;
  draft: string;
  language: string;
  format: string;
  production_company: string;
  director: string;
  producer: string;
  status: string;
  target_length: string;
  notes: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  properties: ProjectProperties;
  color: string;
  pinned: boolean;
  sort_order: number;
}

export interface ScriptMeta {
  id: string;
  title: string;
  author: string;
  format: string;
  created_at: string;
  updated_at: string;
  page_count: number;
  size_bytes: number;
  color: string;
  pinned: boolean;
  sort_order: number;
}

export interface ScriptResponse {
  meta: ScriptMeta;
  content: Record<string, unknown> | null;
}

export interface VersionInfo {
  hash: string;
  short_hash: string;
  message: string;
  date: string;
  author?: string;
}

export interface DiffResponse {
  diff: string;
  from_hash: string;
  to_hash: string;
}

export interface CollabSession {
  token: string;
  project_id: string;
  script_id: string;
  collaborator_name: string;
  role: string;
  created_at: string;
  expires_at: string;
  active: boolean;
  session_nonce?: string;
}

// ── API methods ──────────────────────────────────────────────────────────────

export const api = {
  // Projects
  listProjects: () =>
    request<{ projects: ProjectInfo[] }>('/projects/').then((r) => r.projects),

  createProject: (name: string) =>
    request<ProjectInfo>('/projects/', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getProject: (id: string) => request<ProjectInfo>(`/projects/${id}`),

  updateProject: (id: string, data: { name?: string; properties?: Partial<ProjectProperties>; color?: string; pinned?: boolean; sort_order?: number }) =>
    request<ProjectInfo>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteProject: (id: string) =>
    request<{ message: string }>(`/projects/${id}`, { method: 'DELETE' }),

  reorderProjects: (items: Array<{ id: string; sort_order: number }>) =>
    request<{ message: string }>('/projects/reorder', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  // Scripts
  listScripts: (projectId: string) =>
    request<ScriptMeta[]>(`/projects/${projectId}/scripts/`),

  createScript: (projectId: string, data: { title: string; content?: any }) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getScript: (projectId: string, scriptId: string) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}`),

  saveScript: (projectId: string, scriptId: string, data: { title?: string; content?: Record<string, unknown>; color?: string; pinned?: boolean; sort_order?: number }) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  reorderScripts: (projectId: string, items: Array<{ id: string; sort_order: number }>) =>
    request<{ message: string }>(`/projects/${projectId}/scripts/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  deleteScript: (projectId: string, scriptId: string) =>
    request<{ message: string }>(`/projects/${projectId}/scripts/${scriptId}`, {
      method: 'DELETE',
    }),

  // Versions (git-based)
  checkin: (projectId: string, message: string) =>
    request<VersionInfo>(`/projects/${projectId}/versions/checkin`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  getVersions: (projectId: string) =>
    request<VersionInfo[]>(`/projects/${projectId}/versions/`),

  getVersionDiff: (projectId: string, fromHash: string, toHash: string) =>
    request<DiffResponse>(
      `/projects/${projectId}/versions/diff?from_hash=${encodeURIComponent(fromHash)}&to_hash=${encodeURIComponent(toHash)}`
    ),

  getScriptAtVersion: (projectId: string, hash: string, scriptId: string) =>
    request<ScriptResponse>(
      `/projects/${projectId}/versions/${encodeURIComponent(hash)}/scripts/${encodeURIComponent(scriptId)}`
    ),

  restoreVersion: (projectId: string, hash: string) =>
    request<VersionInfo>(`/projects/${projectId}/versions/restore/${hash}`, {
      method: 'POST',
    }),

  // Collaboration
  createCollabInvite: (projectId: string, scriptId: string, collaboratorName: string, role: string = 'editor', expiresInHours: number = 1, sessionNonce: string = '') =>
    request<CollabSession>('/collab/invite', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, script_id: scriptId, collaborator_name: collaboratorName, role, expires_in_hours: expiresInHours, session_nonce: sessionNonce }),
    }),

  validateCollabSession: (token: string) =>
    request<CollabSession>(`/collab/session/${token}`),

  listCollabSessions: (projectId: string, scriptId: string) =>
    request<CollabSession[]>(`/collab/sessions/${projectId}/${scriptId}`),

  revokeCollabSession: (token: string) =>
    request<{ message: string }>(`/collab/session/${token}`, { method: 'DELETE' }),

  revokeAllCollabSessions: (projectId: string, scriptId: string) =>
    request<{ message: string }>(`/collab/sessions/${projectId}/${scriptId}`, { method: 'DELETE' }),
};

// ── Mobile storage initialisation ───────────────────────────────────────────
// On mobile Tauri (iOS / Android) the Python sidecar is not available, so we
// replace the HTTP methods above with a local SQLite implementation.
// On web and desktop Tauri this function is a no-op — every existing call-site
// continues to use the HTTP backend exactly as before.
//
// Must be called once before the React tree renders (see main.tsx).

export async function initStorage(): Promise<void> {
  // Dynamic imports keep the mobile code out of web/desktop bundles.
  const { isMobileTauri } = await import('./platform');
  if (!isMobileTauri()) return;                       // ← web & desktop: nothing changes

  const { createMobileStorage } = await import('./mobile-storage');
  const mobileApi = await createMobileStorage();
  // Swap every method on the existing `api` object so all call-sites pick
  // up the local implementation automatically.
  Object.assign(api, mobileApi);
}

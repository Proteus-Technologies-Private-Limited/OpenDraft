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

  updateProject: (id: string, data: { name?: string; properties?: Partial<ProjectProperties> }) =>
    request<ProjectInfo>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

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

  saveScript: (projectId: string, scriptId: string, data: { title?: string; content?: Record<string, unknown> }) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
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

  restoreVersion: (projectId: string, hash: string) =>
    request<VersionInfo>(`/projects/${projectId}/versions/restore/${hash}`, {
      method: 'POST',
    }),
};

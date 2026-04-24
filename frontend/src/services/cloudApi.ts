/**
 * cloudApi — the subset of `api` that ALWAYS talks to the remote Python
 * backend over HTTP, regardless of platform.
 *
 * On Tauri, the main `api` object is swapped to local SQLite by initStorage().
 * Cloud-origin scripts need the network path even on Tauri, so they go through
 * this module instead. Authentication uses the same collab JWT from
 * useSettingsStore — if the user is not signed in, requests return 401 and
 * the global AuthGate opens the login dialog.
 */

import { API_BASE } from '../config';
import { authedFetch } from './authedFetch';
import { handleNonOkResponse } from './api';
import type { ProjectInfo, ScriptMeta, ScriptResponse } from './api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  const res = await authedFetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) await handleNonOkResponse(res, 'Cloud API');
  return res.json();
}

export const cloudApi = {
  listProjects: (): Promise<ProjectInfo[]> =>
    request<{ projects: ProjectInfo[] }>('/projects/').then((r) => r.projects),

  createProject: (name: string) =>
    request<ProjectInfo>('/projects/', { method: 'POST', body: JSON.stringify({ name }) }),

  getProject: (id: string) => request<ProjectInfo>(`/projects/${id}`),

  listScripts: (projectId: string, includePreview: boolean = false) =>
    request<ScriptMeta[]>(
      `/projects/${projectId}/scripts/${includePreview ? '?include_preview=true' : ''}`,
    ),

  createScript: (projectId: string, data: { title: string; content?: any; format?: string }) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getScript: (projectId: string, scriptId: string) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}`),

  saveScript: (
    projectId: string,
    scriptId: string,
    data: {
      title?: string;
      content?: Record<string, unknown>;
      color?: string;
      pinned?: boolean;
      sort_order?: number;
    },
  ) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteScript: (projectId: string, scriptId: string) =>
    request<{ message: string }>(`/projects/${projectId}/scripts/${scriptId}`, {
      method: 'DELETE',
    }),
};

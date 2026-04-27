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

import { getApiBase } from '../config';
import { authedFetch } from './authedFetch';
import { handleNonOkResponse } from './api';
import type { ProjectInfo, ScriptMeta, ScriptResponse } from './api';

const NOT_CONFIGURED =
  'OpenDraft Cloud is not configured for this app. Open Settings → System Settings to set the OpenDraft server URL.';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getApiBase();
  if (!base) throw new Error(NOT_CONFIGURED);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  let res: Response;
  try {
    res = await authedFetch(`${base}${path}`, { ...options, headers });
  } catch (err) {
    // fetch() throws TypeError on network failure / DNS / CORS, and WebKit
    // throws "The string did not match the expected pattern" if the URL ends
    // up malformed (e.g. opaque-origin Tauri schemes). Surface a single clean
    // message so the user sees something actionable instead of either raw text.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot reach OpenDraft Cloud (${detail}).`);
  }
  if (!res.ok) await handleNonOkResponse(res, 'Cloud API');
  try {
    return await res.json();
  } catch {
    throw new Error('OpenDraft Cloud returned an invalid response. The server may be misconfigured.');
  }
}

export const cloudApi = {
  listProjects: (): Promise<ProjectInfo[]> =>
    request<{ projects: ProjectInfo[] }>('/projects/').then((r) => r.projects),

  createProject: (name: string) =>
    request<ProjectInfo>('/projects/', { method: 'POST', body: JSON.stringify({ name }) }),

  getProject: (id: string) => request<ProjectInfo>(`/projects/${id}`),

  updateProject: (
    id: string,
    data: { name?: string; color?: string; pinned?: boolean; sort_order?: number },
  ) => request<ProjectInfo>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteProject: (id: string) =>
    request<{ message: string }>(`/projects/${id}`, { method: 'DELETE' }),

  reorderProjects: (items: Array<{ id: string; sort_order: number }>) =>
    request<{ message: string }>('/projects/reorder', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

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

  reorderScripts: (
    projectId: string,
    items: Array<{ id: string; sort_order: number }>,
  ) =>
    request<{ message: string }>(`/projects/${projectId}/scripts/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
};

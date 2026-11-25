import { prepareScriptWrite } from '../utils/reviewSave';
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
import { getDeviceId } from './deviceId';
import { ApiError, handleNonOkResponse } from './api';
import type { ProjectInfo, ProjectProperties, ScriptMeta, ScriptResponse } from './api';
import { t } from '../i18n';

const notConfigured = (): string => t('messages:cloud.notConfigured');

export interface CloudRequestScope {
  base: string;
  isCurrent: () => boolean;
}

async function request<T>(path: string, options?: RequestInit, scope?: CloudRequestScope): Promise<T> {
  const base = scope?.base ?? getApiBase();
  if (!base) throw new Error(notConfigured());
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Lets the server's activity log say which device made a change.
    'X-Device-Id': getDeviceId(),
    ...(options?.headers as Record<string, string>),
  };
  let res: Response;
  try {
    res = await authedFetch(`${base}${path}`, { ...options, headers }, scope?.isCurrent);
  } catch (err) {
    // fetch() throws TypeError on network failure / DNS / CORS, and WebKit
    // throws "The string did not match the expected pattern" if the URL ends
    // up malformed (e.g. opaque-origin Tauri schemes). Surface a single clean
    // message so the user sees something actionable instead of either raw text.
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(t('messages:cloud.cannotReach', { detail }));
  }
  if (scope && !scope.isCurrent()) throw new Error('Cloud account or server changed');
  // Background uploads own their status and must not open a global login
  // prompt while the writer is editing a local script.
  if (!res.ok && (path.endsWith('/offline-content') || path.includes('/device-sync/') || path.includes('/device-scripts/')
    || path.includes('/projects/sync-'))) {
    throw new ApiError(res.status, await res.json().catch(() => null), `Cloud API: ${res.status}`);
  }
  if (!res.ok) await handleNonOkResponse(res, 'Cloud API', scope?.isCurrent);
  try {
    return await res.json();
  } catch {
    throw new Error(t('messages:cloud.invalidResponse'));
  }
}

export const cloudApi = {
  listProjects: (scope?: CloudRequestScope): Promise<ProjectInfo[]> =>
    request<{ projects: ProjectInfo[] }>('/projects/', undefined, scope).then((r) => r.projects),

  createProject: (name: string) =>
    request<ProjectInfo>('/projects/', { method: 'POST', body: JSON.stringify({ name }) }),

  ensureDeviceProject: (bindingId: string, name: string, scope: CloudRequestScope) =>
    request<ProjectInfo>(`/projects/device-sync/${bindingId}`, {
      method: 'PUT', body: JSON.stringify({ name }),
    }, scope),

  ensureDeviceScript: (projectId: string, scriptId: string,
    data: { title: string; format: string; content: Record<string, unknown> }, scope: CloudRequestScope) =>
    request<ScriptResponse>(`/projects/${projectId}/device-scripts/${scriptId}`, {
      method: 'PUT', body: JSON.stringify(data),
    }, scope),

  getProject: (id: string, scope?: CloudRequestScope) => request<ProjectInfo>(`/projects/${id}`, undefined, scope),

  updateProject: (
    id: string,
    data: { name?: string; color?: string; pinned?: boolean; sort_order?: number; properties?: Partial<ProjectProperties> },
  ) => request<ProjectInfo>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteProject: (id: string, scope?: CloudRequestScope) =>
    request<{ message: string }>(`/projects/${id}`, { method: 'DELETE' }, scope),

  reorderProjects: (items: Array<{ id: string; sort_order: number }>) =>
    request<{ message: string }>('/projects/reorder', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  listScripts: (projectId: string, includePreview: boolean = false, scope?: CloudRequestScope) =>
    request<ScriptMeta[]>(
      `/projects/${projectId}/scripts/${includePreview ? '?include_preview=true' : ''}`, undefined, scope,
    ),

  createScript: (projectId: string, data: { title: string; content?: any; format?: string }, scope?: CloudRequestScope) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/`, {
      method: 'POST',
      body: JSON.stringify(prepareScriptWrite(data)),
    }, scope),

  getScript: (projectId: string, scriptId: string, scope?: CloudRequestScope) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}`, undefined, scope),

  uploadOfflineScript: (projectId: string, scriptId: string, content: Record<string, unknown>,
    revision: string, scope: CloudRequestScope) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}/offline-content`, {
      method: 'PUT',
      body: JSON.stringify({ content, expected_content_revision: revision }),
    }, scope),

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
    scope?: CloudRequestScope,
  ) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}`, {
      method: 'PUT',
      body: JSON.stringify(prepareScriptWrite(data)),
    }, scope),

  deleteScript: (projectId: string, scriptId: string, scope?: CloudRequestScope) =>
    request<{ message: string }>(`/projects/${projectId}/scripts/${scriptId}`, {
      method: 'DELETE',
    }, scope),

  reorderScripts: (
    projectId: string,
    items: Array<{ id: string; sort_order: number }>,
  ) =>
    request<{ message: string }>(`/projects/${projectId}/scripts/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

  /**
   * Assets.
   *
   * Cloud had no asset methods at all, which only went unnoticed because a
   * project-less document carried its images as base64 inside the document and
   * they rode along with the script body. Now that images are stored by
   * reference, saving to the cloud has to be able to take the bytes with it —
   * otherwise every image in a cloud-saved script resolves on the authoring
   * machine and nowhere else.
   */
  uploadAsset: async (projectId: string, file: File, tags: string[] = []): Promise<{ id: string; filename?: string }> => {
    const base = getApiBase();
    if (!base) throw new Error(notConfigured());
    const formData = new FormData();
    formData.append('file', file);
    if (tags.length) formData.append('tags', tags.join(','));
    // Multipart — do NOT set Content-Type; the browser adds the boundary.
    const res = await authedFetch(`${base}/projects/${projectId}/assets/upload`, {
      method: 'POST',
      body: formData,
      headers: { 'X-Device-Id': getDeviceId() },
    });
    if (!res.ok) await handleNonOkResponse(res, 'Cloud upload');
    return res.json();
  },

  getAssetUrl: (projectId: string, assetId: string, _filename?: string): string => {
    const base = getApiBase();
    if (!base) throw new Error(notConfigured());
    return `${base}/projects/${projectId}/assets/${assetId}`;
  },
};

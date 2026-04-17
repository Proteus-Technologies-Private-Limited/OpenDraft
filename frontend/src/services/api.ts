import { API_BASE, getCollabWsUrl } from '../config';
import { useSettingsStore } from '../stores/settingsStore';

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

/** Authenticated request to the collab server (not the Python backend). */
async function collabServerRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getCollabWsUrl().replace(/^ws(s?):\/\//, 'http$1://');
  const { collabAuth } = useSettingsStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (collabAuth.accessToken) {
    headers['Authorization'] = `Bearer ${collabAuth.accessToken}`;
  }
  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  site_name: string;
}

export interface SubmissionEntry {
  id: string;
  date: string;
  submitted_to: string;
  type: string;
  status: string;
  notes: string;
}

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
  // Registration & Legal
  wga_registration: string;
  wga_registration_date: string;
  copyright_registration: string;
  copyright_year: string;
  agent_name: string;
  agent_contact: string;
  manager_name: string;
  manager_contact: string;
  submissions: SubmissionEntry[];
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
  preview: string;
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

export interface LocationEntry {
  id: string;
  name: string;
  fullName: string;
  type: 'interior' | 'exterior' | 'both';
  address: string;
  notes: string;
  contact: string;
  availability: string;
  tags: string[];
  imageAssetIds: string[];
  aliases: string[];
  created_at: string;
  updated_at: string;
}

export interface DemoInfo {
  demo: boolean;
  message: string | null;
}

export const api = {
  // Demo mode
  getDemoInfo: () => request<DemoInfo>('/demo-info'),

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
  listScripts: (projectId: string, includePreview: boolean = false) =>
    request<ScriptMeta[]>(`/projects/${projectId}/scripts/${includePreview ? '?include_preview=true' : ''}`),

  createScript: (projectId: string, data: { title: string; content?: any; format?: string }) =>
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

  duplicateScript: (projectId: string, scriptId: string) =>
    request<ScriptResponse>(`/projects/${projectId}/scripts/${scriptId}/duplicate`, {
      method: 'POST',
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

  // Collaboration (routed to collab server, not Python backend)
  createCollabInvite: (projectId: string, scriptId: string, collaboratorName: string, role: string = 'editor', expiresInHours: number = 1, sessionNonce: string = '') =>
    collabServerRequest<CollabSession>('/api/collab/invite', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, script_id: scriptId, collaborator_name: collaboratorName, role, expires_in_hours: expiresInHours, session_nonce: sessionNonce }),
    }),

  validateCollabSession: (token: string) =>
    collabServerRequest<CollabSession>(`/api/collab/session/${token}`),

  listCollabSessions: (projectId: string, scriptId: string) =>
    collabServerRequest<CollabSession[]>(`/api/collab/sessions/${projectId}/${scriptId}`),

  revokeCollabSession: (token: string) =>
    collabServerRequest<{ message: string }>(`/api/collab/session/${token}`, { method: 'DELETE' }),

  revokeAllCollabSessions: (projectId: string, scriptId: string) =>
    collabServerRequest<{ message: string }>(`/api/collab/sessions/${projectId}/${scriptId}`, { method: 'DELETE' }),

  // Assets
  listAssets: async (projectId: string): Promise<any[]> => {
    const data = await request<{ assets: any[] }>(`/projects/${projectId}/assets/`);
    return data.assets || [];
  },

  uploadAsset: async (projectId: string, file: File, tags: string[] = []): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    if (tags.length) formData.append('tags', tags.join(','));
    const res = await fetch(`${API_BASE}/projects/${projectId}/assets/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },

  deleteAsset: async (projectId: string, assetId: string): Promise<void> => {
    await request<{ message: string }>(`/projects/${projectId}/assets/${assetId}`, { method: 'DELETE' });
  },

  updateAssetTags: async (projectId: string, assetId: string, tags: string[]): Promise<void> => {
    await request<any>(`/projects/${projectId}/assets/${assetId}/tags`, {
      method: 'PUT',
      body: JSON.stringify(tags),
    });
  },

  getAssetUrl: (projectId: string, assetId: string, _filename?: string): string => {
    return `${API_BASE.replace(/\/api$/, '')}/api/projects/${projectId}/assets/${assetId}`;
  },

  fetchLinkPreview: async (url: string): Promise<LinkPreview> => {
    return request<LinkPreview>('/link/preview', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },

  // Locations
  listLocations: async (projectId: string): Promise<LocationEntry[]> => {
    const data = await request<{ locations: LocationEntry[] }>(`/projects/${projectId}/locations/`);
    return data.locations || [];
  },

  createLocation: (projectId: string, data: Partial<LocationEntry> & { name: string }) =>
    request<LocationEntry>(`/projects/${projectId}/locations/`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateLocation: (projectId: string, locId: string, data: Partial<LocationEntry>) =>
    request<LocationEntry>(`/projects/${projectId}/locations/${locId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteLocation: (projectId: string, locId: string) =>
    request<{ message: string }>(`/projects/${projectId}/locations/${locId}`, {
      method: 'DELETE',
    }),

  discoverLocations: (projectId: string) =>
    request<{ discovered: number; locations: LocationEntry[] }>(
      `/projects/${projectId}/locations/discover`,
      { method: 'POST' },
    ),

  // Formatting templates
  listFormattingTemplates: () =>
    request<any[]>('/formatting-templates/'),

  createFormattingTemplate: (template: any) =>
    request<any>('/formatting-templates/', {
      method: 'POST',
      body: JSON.stringify(template),
    }),

  updateFormattingTemplate: (id: string, template: any) =>
    request<any>(`/formatting-templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(template),
    }),

  deleteFormattingTemplate: (id: string) =>
    request<any>(`/formatting-templates/${id}`, { method: 'DELETE' }),
};

// ── Local storage initialisation ────────────────────────────────────────────
// On Tauri (desktop + mobile) we use a local SQLite database instead of the
// Python HTTP backend. This eliminates the sidecar process, removes the
// localhost network attack surface, and gives instant startup.
//
// On web (no Tauri) this function is a no-op — the HTTP backend is used as-is.
//
// Must be called once before the React tree renders (see main.tsx).

export async function initStorage(): Promise<void> {
  const { setCompat } = await import('./compat');
  // Dynamic imports keep the Tauri/SQLite code out of web bundles.
  const { isTauri } = await import('./platform');
  if (!isTauri()) {
    setCompat('storage', 'Storage', 'primary',
      'HTTP API (Python backend)', 'localStorage (browser fallback)');
    return;                                           // ← web: nothing changes
  }

  try {
    // Race the SQLite init against a generous timeout.  The timeout only
    // fires when Tauri IPC is fundamentally broken (e.g. older macOS
    // WKWebView).  Normal first-run migrations finish well under 15 s.
    // We clear the timer on success/failure to avoid an unhandled rejection.
    const { createLocalStorage } = await import('./local-storage');
    const localApi: Awaited<ReturnType<typeof createLocalStorage>> = await new Promise(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(
            'Tauri SQLite init timed out (15 s) — IPC may not work on this macOS version'
          )),
          15_000,
        );
        createLocalStorage()
          .then((api) => { clearTimeout(timer); resolve(api); })
          .catch((err) => { clearTimeout(timer); reject(err); });
      },
    );
    // Swap every method on the existing `api` object so all call-sites pick
    // up the local implementation automatically.
    Object.assign(api, localApi);
    setCompat('storage', 'Storage', 'primary',
      'Tauri SQLite (local database)', 'localStorage (browser fallback)');
  } catch (err) {
    // Tauri SQLite failed (e.g. older macOS with incompatible WKWebView APIs).
    // Fall back to localStorage so the app still works.
    console.error('Tauri SQLite init failed, falling back to localStorage:', err);
    const { createFallbackStorage } = await import('./fallback-storage');
    const fallbackApi = createFallbackStorage();
    Object.assign(api, fallbackApi);
    setCompat('storage', 'Storage', 'fallback',
      'Tauri SQLite (local database)', 'localStorage (browser fallback)');
  }
}

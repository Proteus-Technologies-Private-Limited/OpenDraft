/**
 * API configuration.
 *
 * In development the Vite dev server proxies /api to the backend on port 8000.
 * For web deployments the Python backend serves both frontend and API.
 *
 * On Tauri (desktop + mobile) the HTTP backend is NOT used — all data goes
 * through local SQLite. The API_BASE is only relevant for the web build.
 */

// Use the browser's hostname so the API is reachable when the frontend
// is accessed from another device on the local network (e.g. phone via IP).
// In dev mode (Vite on port 5173), hit the backend on port 8000.
// In production (frontend served by the backend itself), use same-origin /api.
const isDev = window.location.port === '5173';
const DEFAULT_API_BASE = isDev
  ? `http://${window.location.hostname}:8000/api`
  : `${window.location.origin}/api`;

export const API_BASE: string =
  import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

/** Server root without the /api suffix (used for asset URLs, etc.) */
export const SERVER_BASE: string = API_BASE.replace(/\/api$/, '');

/** WebSocket URL for the Hocuspocus collaboration server.
 *  Reads from localStorage (settings store) first, then falls back
 *  to the VITE env var, then to the default.
 */
const DEFAULT_COLLAB_WS = 'wss://opendraft-collab-267958344432.us-central1.run.app';
export function getCollabWsUrl(): string {
  const stored = localStorage.getItem('opendraft:collabServerUrl');
  if (stored) return stored;
  return import.meta.env.VITE_COLLAB_WS_URL || DEFAULT_COLLAB_WS;
}
// Static alias kept for backward-compatible imports
export const COLLAB_WS_URL: string =
  import.meta.env.VITE_COLLAB_WS_URL || DEFAULT_COLLAB_WS;

/**
 * Get the URL for an asset.
 *
 * On web this returns the backend HTTP URL (synchronous).
 * On Tauri (desktop + mobile) this returns a convertFileSrc() URL pointing
 * to the local file on disk (async because it needs path APIs).
 *
 * `filename` is the stored filename from the asset record — required on
 * Tauri.  On web it is ignored.
 */
export function getAssetUrlSync(
  projectId: string,
  assetId: string,
): string {
  // Web — use the HTTP backend
  return `${SERVER_BASE}/api/projects/${projectId}/assets/${assetId}`;
}

export async function getAssetUrl(
  projectId: string,
  assetId: string,
  filename?: string,
): Promise<string> {
  const { isTauri } = await import('./services/platform');
  if (isTauri()) {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    const { appDataDir } = await import('@tauri-apps/api/path');
    const base = await appDataDir();
    const filePath = `${base}/assets/${projectId}/${filename || assetId}`;
    return convertFileSrc(filePath);
  }
  return getAssetUrlSync(projectId, assetId);
}

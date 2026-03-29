/**
 * API configuration.
 *
 * In development the Vite dev server proxies /api to the backend on port 8000.
 * For the Tauri desktop build, VITE_API_BASE is set to http://localhost:18321/api
 * so the frontend talks directly to the bundled sidecar backend.
 */

const DEFAULT_API_BASE = 'http://localhost:8000/api';

export const API_BASE: string =
  import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

/** Server root without the /api suffix (used for asset URLs, etc.) */
export const SERVER_BASE: string = API_BASE.replace(/\/api$/, '');

/**
 * Get the URL for an asset.
 *
 * On web / desktop this returns the backend HTTP URL (synchronous).
 * On mobile Tauri this returns a convertFileSrc() URL pointing to the
 * local file on disk (async because it needs path APIs).
 *
 * `filename` is the stored filename from the asset record — required on
 * mobile.  On web/desktop it is ignored.
 */
export function getAssetUrlSync(
  projectId: string,
  assetId: string,
): string {
  // Web / desktop — always use the HTTP backend
  return `${SERVER_BASE}/api/projects/${projectId}/assets/${assetId}`;
}

export async function getAssetUrl(
  projectId: string,
  assetId: string,
  filename?: string,
): Promise<string> {
  const { isMobileTauri } = await import('./services/platform');
  if (isMobileTauri()) {
    const { convertFileSrc } = await import('@tauri-apps/api/core');
    const { appDataDir } = await import('@tauri-apps/api/path');
    const base = await appDataDir();
    const filePath = `${base}/assets/${projectId}/${filename || assetId}`;
    return convertFileSrc(filePath);
  }
  return getAssetUrlSync(projectId, assetId);
}

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

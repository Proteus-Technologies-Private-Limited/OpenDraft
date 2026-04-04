/**
 * Platform detection utilities.
 *
 * Determines whether we are running as:
 *  - a plain web app in the browser (uses Python backend over HTTP),
 *  - a Tauri desktop app (macOS / Windows / Linux), or
 *  - a Tauri mobile app (iOS / Android).
 *
 * On all Tauri platforms (desktop + mobile) the app uses a local SQLite
 * database for storage. The Python backend is only used by the web version.
 */

/** True when running inside any Tauri WebView (desktop or mobile). */
export function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__;
}

/** True when running inside a Tauri *mobile* WebView (iOS or Android). */
export function isMobileTauri(): boolean {
  if (!isTauri()) return false;
  const ua = navigator.userAgent || '';
  return /android/i.test(ua) || /iphone|ipad|ipod/i.test(ua);
}

/** True when running as a Tauri desktop app (macOS / Windows / Linux). */
export function isDesktopTauri(): boolean {
  return isTauri() && !isMobileTauri();
}

/** True when running as a plain browser web app (no Tauri). */
export function isWeb(): boolean {
  return !isTauri();
}

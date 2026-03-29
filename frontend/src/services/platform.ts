/**
 * Platform detection utilities.
 *
 * Determines whether we are running as:
 *  - a plain web app in the browser,
 *  - a Tauri desktop app (macOS / Windows / Linux), or
 *  - a Tauri mobile app (iOS / Android).
 *
 * On mobile Tauri the Python sidecar backend is unavailable, so the
 * frontend uses a local SQLite database for storage instead of HTTP.
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

/** True when running as a Tauri desktop app (has sidecar backend). */
export function isDesktopTauri(): boolean {
  return isTauri() && !isMobileTauri();
}

/** True when running as a plain browser web app (no Tauri). */
export function isWeb(): boolean {
  return !isTauri();
}

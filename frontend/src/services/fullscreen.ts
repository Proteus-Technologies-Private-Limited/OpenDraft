/**
 * Full screen for Focus Mode.
 *
 * Desktop app: the window itself (needs `core:window:allow-set-fullscreen`
 * in src-tauri/capabilities). Web: the Fullscreen API. iOS and Android apps
 * are already full screen, so there it does nothing.
 */
import { isMobileTauri, isTauri } from './platform';

export async function setAppFullscreen(on: boolean): Promise<void> {
  if (isMobileTauri()) return;
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(on);
      return;
    }
    if (typeof document === 'undefined') return;
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (!on && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch (err) {
    // Refused (no user gesture, an iframe, a browser setting): Focus Mode
    // still works, just inside the window.
    console.info('[focusMode] full screen unavailable:', err);
  }
}

/**
 * Calls `onExit` when the browser leaves full screen by itself — the writer
 * pressed Esc, which the Fullscreen API handles before any page sees it.
 * Returns the unsubscribe function. Not used in the desktop app, where
 * nothing but OpenDraft leaves full screen.
 */
export function onBrowserFullscreenExit(onExit: () => void): () => void {
  if (isTauri() || typeof document === 'undefined') return () => {};
  const handler = () => { if (!document.fullscreenElement) onExit(); };
  document.addEventListener('fullscreenchange', handler);
  return () => document.removeEventListener('fullscreenchange', handler);
}

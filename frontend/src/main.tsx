import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { initStorage } from './services/api';
import { initScratchAssets } from './services/scratchAssets';
import { scheduleScratchSweep } from './services/scratchSweep';
import { initDemoInfo } from './services/demoInfo';
import { getOS, isTauri } from './services/platform';
import { initCustomFonts } from './services/customFonts';
import { detectDeviceFonts } from './utils/deviceFonts';

/**
 * Keep the `ios-windowed` class in sync with whether the app is running in an
 * iPadOS window rather than full-screen.
 *
 * iPadOS draws its own window-management control — the three-dot pill — inside
 * the top-leading corner of a windowed app, on top of the app's own content,
 * and it is not reported through the safe-area insets.  The menu bar has to
 * reserve room for it or the File menu sits underneath it and cannot be
 * tapped.  Full-screen apps have no such control, so the gutter is applied
 * only where it is needed.
 *
 * iPadOS exposes no "am I in a window" API, so infer it from geometry: a
 * full-screen app spans the screen in one axis or the other, while Split View,
 * Slide Over and a free-floating window never do.
 */
function trackIpadWindowMode(): void {
  const TOLERANCE_PX = 2;

  const isWindowed = (): boolean => {
    const screenW = window.screen?.width || 0;
    const screenH = window.screen?.height || 0;
    // No screen metrics to compare against — assume full-screen rather than
    // indenting the menu bar on every iPhone for a control that is not there.
    if (!screenW || !screenH) return false;
    const w = window.innerWidth;
    const spansScreen =
      Math.abs(w - screenW) <= TOLERANCE_PX || Math.abs(w - screenH) <= TOLERANCE_PX;
    return !spansScreen;
  };

  const apply = () => {
    document.documentElement.classList.toggle('ios-windowed', isWindowed());
  };

  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  apply();
}

async function init() {
  // Apply saved theme before first render to avoid flash
  const savedTheme = localStorage.getItem('opendraft:theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Platform class for the safe-area rules in screenplay.css.  viewport-fit
  // now lives in the static meta tag in index.html — patching it here ran too
  // late on iOS, which reads the tag once at first layout.
  const platformOS = getOS();
  if (platformOS === 'android') document.documentElement.classList.add('android');
  if (platformOS === 'ios') document.documentElement.classList.add('ios');

  // Only the native app has iPadOS window controls drawn over it — a Split
  // View Safari tab showing the web build has the browser's chrome instead,
  // and would get an indented menu bar for a control that is not there.
  if (platformOS === 'ios' && isTauri()) trackIpadWindowMode();

  // Track the visual viewport height as a CSS variable so dialogs/overlays can
  // shrink when the soft keyboard appears. Android WebView's `dvh` unit is
  // unreliable for keyboard insets, but `visualViewport.height` is accurate.
  const updateViewportHeight = () => {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--vv-height', `${h}px`);
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewportHeight);
    window.visualViewport.addEventListener('scroll', updateViewportHeight);
  }
  window.addEventListener('resize', updateViewportHeight);
  updateViewportHeight();

  // On Tauri (desktop + mobile) this swaps the HTTP api with local SQLite.
  // On web it is a no-op — the Python backend is used as-is.
  // initStorage() handles its own timeout and fallback internally —
  // no additional wrapping needed here.
  await initStorage();

  // Where images go for a document that has no project yet, so the bytes never
  // sit inside the document (and never inside a recovery snapshot). Awaited:
  // once it resolves, image URLs resolve synchronously on Tauri.
  await initScratchAssets();
  // Housekeeping for images left behind by abandoned documents. Deliberately
  // late and idle — a delayed sweep costs disk, a hasty one costs a picture.
  scheduleScratchSweep();

  // Bring back the writer's own TTF/OTF fonts, and work out which of the
  // registry's system faces this machine actually has, before the first
  // document renders — otherwise a script written in an installed font shows
  // Courier for a frame. Neither can stop the app starting.
  initCustomFonts().catch((err) => console.warn('[fonts] custom fonts unavailable:', err));

  // Measuring a few hundred families is a few hundred canvas calls on the main
  // thread — nothing next to a document, but no reason to make first paint wait
  // for it either.
  const findDeviceFonts = () => {
    try {
      detectDeviceFonts();
    } catch (err) {
      console.warn('[fonts] device font detection failed:', err);
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(findDeviceFonts, { timeout: 4000 });
  else setTimeout(findDeviceFonts, 1200);

  // Fetch the backend's demo-mode flag once so CollabLoginDialog/SettingsPage
  // can decide whether to show demo warnings. Non-blocking best-effort.
  initDemoInfo().catch(() => {});

  // Set initial native window title on desktop (for macOS Window menu)
  import('./services/platform').then(({ isDesktopTauri }) => {
    if (!isDesktopTauri()) return;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_window_title', { title: 'Untitled Screenplay' }).catch(() => {});
    });
  });

  // Clear the loading-timeout diagnostic (and remove overlay if it fired early)
  if ((window as any)._renderTimeout) clearTimeout((window as any)._renderTimeout);
  const fatalOverlay = document.getElementById('_fatal');
  if (fatalOverlay) fatalOverlay.remove();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

init().catch((err) => {
  console.error('Fatal init error:', err);
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:#1a1a2e;color:#ff6b6b;font:14px/1.6 monospace;padding:40px;white-space:pre-wrap;';
  d.textContent = 'OpenDraft failed to start:\n\n' + (err?.stack || err?.message || String(err));
  document.body.appendChild(d);
});

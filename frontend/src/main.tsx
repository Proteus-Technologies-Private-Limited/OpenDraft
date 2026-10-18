import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { initStorage } from './services/api';
import { initScratchAssets } from './services/scratchAssets';
import { scheduleScratchSweep } from './services/scratchSweep';
import { initDemoInfo } from './services/demoInfo';
import { getOS, isTauri } from './services/platform';
import { isPhoneDevice, watchPhoneDevice, PHONE_DEVICE_CHANGE_EVENT } from './utils/phoneDevice';
import { useEditorStore } from './stores/editorStore';
import { initCustomFonts } from './services/customFonts';
import { detectDeviceFonts } from './utils/deviceFonts';
import { applyAppearance, applyNativeTheme, readAppearance } from './utils/appearance';

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
 * full-screen app fills the screen in BOTH axes, while Split View, Slide Over
 * and a free-floating window never do.
 *
 * Matching on width alone was not enough. A window dragged out to the full
 * width of the screen but left short of its height is still a window, still
 * carries the pill, and was being read as full-screen — so the gutter
 * collapsed and the control landed on top of the File menu. Both axes have to
 * span before the app can conclude there is no window frame around it.
 *
 * iPhone never has a window frame, so it is excluded outright: a hair of
 * measurement noise there would otherwise indent the menu bar for a control
 * that does not exist.
 */
function trackIpadWindowMode(): void {
  const TOLERANCE_PX = 2;

  const isWindowed = (): boolean => {
    // iPadOS reports a desktop-class UA, so an iPad is told from a Mac by its
    // touch points, and from an iPhone by name.
    const ua = navigator.userAgent || '';
    const isIpad = /ipad/i.test(ua)
      || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    if (!isIpad) return false;

    const screenW = window.screen?.width || 0;
    const screenH = window.screen?.height || 0;
    // No screen metrics to compare against — assume full-screen rather than
    // indenting the menu bar for a control that may not be there.
    if (!screenW || !screenH) return false;

    const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE_PX;
    const long = Math.max(screenW, screenH);
    const short = Math.min(screenW, screenH);
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Either orientation, but the window has to fill the screen in both axes.
    const spansScreen = (near(w, long) && near(h, short))
      || (near(w, short) && near(h, long));
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
  // Apply the remembered appearance before first render to avoid a flash.
  applyAppearance(readAppearance());
  // Not awaited: the native popups only need it by the time one is opened.
  void applyNativeTheme(readAppearance());

  // Platform class for the safe-area rules in screenplay.css.  viewport-fit
  // now lives in the static meta tag in index.html — patching it here ran too
  // late on iOS, which reads the tag once at first layout.
  const platformOS = getOS();
  if (platformOS === 'android') document.documentElement.classList.add('android');
  if (platformOS === 'ios') document.documentElement.classList.add('ios');
  // Phone-sized touch chrome (screenplay.css), independent of the view layout
  // the writer picks: a phone is fingers on a small screen either way.
  if (isPhoneDevice()) document.documentElement.classList.add('phone');
  // ...and kept current, for a browser that changes what it reports under an
  // open page (DevTools device mode). The toolbar re-measures what fits on
  // the event, since its buttons change size without its width changing.
  watchPhoneDevice((phone) => {
    document.documentElement.classList.toggle('phone', phone);
    useEditorStore.getState().followDevice(phone);
    window.dispatchEvent(new Event(PHONE_DEVICE_CHANGE_EVENT));
  });

  // Only the native app has iPadOS window controls drawn over it — a Split
  // View Safari tab showing the web build has the browser's chrome instead,
  // and would get an indented menu bar for a control that is not there.
  if (platformOS === 'ios' && isTauri()) trackIpadWindowMode();

  // Track the visual viewport height as a CSS variable so dialogs/overlays can
  // shrink when the soft keyboard appears. Android WebView's `dvh` unit is
  // unreliable for keyboard insets, but `visualViewport.height` is accurate.
  //
  // On an iPhone the same height also sizes the whole app (html.ios.phone in
  // screenplay.css). iOS does not shrink the page for the keyboard; it scrolls
  // the document instead, until the caret clears it — which on a phone carried
  // the menu bar up under the Dynamic Island with nothing to bring it back.
  // Fitting the app above the keyboard and pinning the document at the top
  // leaves the editor's own scroller as the only thing that moves, which is
  // what ProseMirror already scrolls to keep the caret in view.
  const root = document.documentElement;
  const isIosPhone = () => root.classList.contains('ios') && root.classList.contains('phone');
  const pinDocument = () => {
    if (!isIosPhone()) return;
    if (window.scrollY !== 0 || (window.visualViewport?.offsetTop ?? 0) !== 0) window.scrollTo(0, 0);
  };
  // The caret is scrolled into view when it is tapped, while the editor is
  // still full height; the keyboard then takes the bottom half away. Once the
  // app has shrunk, bring the caret back above it.
  const revealCaret = () => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const node = sel.focusNode;
      const el = node && (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement);
      const scroller = el?.closest('.editor-main');
      if (!el || !scroller) return;
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      // A collapsed range can report an empty box (WebKit, empty lines).
      if (rect.top === 0 && rect.bottom === 0) rect = el.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      const margin = 48;
      if (rect.bottom > box.bottom - margin) scroller.scrollTop += rect.bottom - (box.bottom - margin);
      else if (rect.top < box.top + margin) scroller.scrollTop -= box.top + margin - rect.top;
    } catch (err) {
      console.warn('[keyboard] could not reveal the caret:', err);
    }
  };
  let lastHeight = 0;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  const updateViewportHeight = () => {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vv-height', `${h}px`);
    if (isIosPhone()) {
      // The keyboard covers the home indicator, so its inset is not owed.
      // 120px: more than any browser toolbar collapsing, less than a keyboard.
      const open = !!vv && window.innerHeight - vv.height > 120;
      root.classList.toggle('keyboard-open', open);
      pinDocument();
      // The keyboard animates in over several resizes; check once it settles.
      if (open && h !== lastHeight) {
        clearTimeout(revealTimer);
        revealTimer = setTimeout(revealCaret, 120);
      }
    }
    lastHeight = h;
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewportHeight);
    window.visualViewport.addEventListener('scroll', updateViewportHeight);
  }
  window.addEventListener('resize', updateViewportHeight);
  window.addEventListener('scroll', pinDocument, { passive: true });
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
  // Browser only: the apps keep scripts in local SQLite and need no server at
  // launch, so this would be a request to open-draft.com on every start (and a
  // 10 s timeout offline). Both dialogs fetch the flag themselves when opened.
  if (!isTauri()) initDemoInfo().catch(() => {});

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

  // Retire the "OpenDraft failed to start" overlay for the rest of the
  // session: from here on a stray error or rejection is a fault inside a
  // running app, and a full-screen overlay with no way out of it would strand
  // the writer in their document (issue #97). See the flag's note in
  // index.html.
  (window as any).__odBooted = true;

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

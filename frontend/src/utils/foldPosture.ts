/** Fold signals use layout-viewport CSS pixels, never visual-viewport height
 * (which also changes when a keyboard opens). API presence alone does not
 * identify a foldable: ordinary Chrome exposes Device Posture too. */
import { ANDROID_FOLD_CHANGE_EVENT, androidFoldGeometry, readAndroidFoldSnapshot } from './androidFoldPosture';
export interface FoldState {
  size: 'phone' | 'wide';
  fold: 'flat' | 'laptop' | 'book';
  foldRect: DOMRect | null;
}
export const FOLD_CHANGE_EVENT = 'opendraft:foldchange';
/** Capture reading position before posture classes reflow the script. */
export const FOLD_WILL_CHANGE_EVENT = 'opendraft:beforefoldchange';
// Detection lasts for this document only: disable DevTools emulation and reload
// to return to ordinary-device behavior. Discard the old persistent marker.
try { localStorage.removeItem('opendraft:foldable'); } catch { /* storage unavailable */ }
interface Segment { left: number; top: number; width: number; height: number }
type SegmentViewport = { segments?: readonly Segment[] };
type PostureNavigator = Navigator & { devicePosture?: EventTarget & { type?: string } };
let confirmed = false;

/**
 * The hinge as the native app reports it (FoldPosture.m, iOS 27.1+).
 *
 * WKWebView has none of the browser fold APIs, so the iOS app pushes UIKit's
 * hinge state and crease into the page instead: `window.__opendraftNativeFold`,
 * plus NATIVE_FOLD_EVENT whenever it changes. `division` is the crease in the
 * page's CSS pixels, reported while fully open too (the region is then only
 * inactive); `hinge: 'none'` means the device has no hinge.
 */
export interface NativeFold {
  hinge: 'none' | 'unknown' | 'closed' | 'partiallyOpen' | 'fullyOpen';
  angle?: number;
  division: { x: number; y: number; width: number; height: number; active?: boolean } | null;
  viewport?: { width: number; height: number };
}
export const NATIVE_FOLD_EVENT = 'opendraft:nativefold';
type NativeFoldWindow = Window & { __opendraftNativeFold?: NativeFold };

/** The native report, if the app has sent a well-formed one. */
export function readNativeFold(): NativeFold | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = (window as NativeFoldWindow).__opendraftNativeFold;
    if (!value || typeof value !== 'object') return null;
    const hinges: readonly NativeFold['hinge'][] = ['none', 'unknown', 'closed', 'partiallyOpen', 'fullyOpen'];
    if (!hinges.includes(value.hinge)) return null;
    return value;
  } catch {
    return null;
  }
}

export function isFoldableDevice(): boolean {
  return confirmed;
}
function rememberFoldable() {
  confirmed = true;
}

/** Pure geometry shared by browser detection and tests. */
export function foldFromSegments(segments: readonly Segment[], folded: boolean): Pick<FoldState, 'fold' | 'foldRect'> {
  const valid = segments.filter(s => [s.left, s.top, s.width, s.height].every(Number.isFinite) && s.width > 0 && s.height > 0);
  if (valid.length !== 2) return { fold: 'flat', foldRect: null };
  const [a, b] = [...valid].sort((a, b) => a.top - b.top || a.left - b.left);
  let rect: DOMRect | null = null;
  let orientation: FoldState['fold'] = 'flat';
  if (a.top + a.height <= b.top && a.left === b.left && a.width === b.width) {
    rect = new DOMRect(a.left, a.top + a.height, a.width, b.top - a.top - a.height);
    orientation = 'laptop';
  } else if (a.left + a.width <= b.left && a.top === b.top && a.height === b.height) {
    rect = new DOMRect(a.left + a.width, a.top, b.left - a.left - a.width, a.height);
    orientation = 'book';
  }
  return { fold: folded ? orientation : 'flat', foldRect: rect };
}

/**
 * The same answer from the native hinge, for the app on a foldable iPhone.
 *
 * Closed means the cover screen: no crease on this display. Open, the crease
 * is the division region; it runs down a book-held device (taller than wide)
 * and across a laptop-held one. Fully open is flat, as the browser's
 * 'continuous' posture is, but keeps the crease for docking. A crease outside
 * the reported viewport (a Split View pane on one half) is no crease here.
 */
export function foldFromNative(native: NativeFold, viewport: { width: number; height: number }): Pick<FoldState, 'fold' | 'foldRect'> {
  if (native.hinge === 'none' || native.hinge === 'closed' || !native.division) return { fold: 'flat', foldRect: null };
  const { x, y, width, height } = native.division;
  const finite = [x, y, width, height].every(Number.isFinite);
  if (!finite || width < 0 || height < 0 || (width === 0 && height === 0)) return { fold: 'flat', foldRect: null };
  const inside = x < viewport.width && y < viewport.height && x + width > 0 && y + height > 0;
  if (!inside) return { fold: 'flat', foldRect: null };
  const orientation: FoldState['fold'] = height > width ? 'book' : 'laptop';
  return { fold: native.hinge === 'partiallyOpen' ? orientation : 'flat', foldRect: new DOMRect(x, y, width, height) };
}

let lastAndroidState: FoldState | null = null;
let watchedState: FoldState | null = null;
let waitingForAndroidLayout = false;

/** Subscribers share the geometry applied by the watcher, including native
 * reads; a posture event must not repeatedly block on the Java interface. */
export function getFoldState(): FoldState {
  return watchedState ?? detectFoldState();
}

function detectFoldState(): FoldState {
  if (typeof window === 'undefined') return { size: 'wide', fold: 'flat', foldRect: null };
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* unsupported */ }
  const size = coarse && Math.min(window.innerWidth, window.innerHeight) < 600 ? 'phone' : 'wide';
  // Chrome 138 ships window.viewport. Older origin-trial builds used
  // visualViewport.segments; keep that fallback without requiring either API.
  let geometry: Pick<FoldState, 'fold' | 'foldRect'> = { fold: 'flat', foldRect: null };
  const android = readAndroidFoldSnapshot();
  waitingForAndroidLayout = false;
  // Stopped/pending is a lifecycle gap, not evidence that a half-open hinge
  // became flat. Preserve size too, so backgrounding cannot change preferences.
  if (android && (!android.active || android.status === 'pending') && lastAndroidState) {
    waitingForAndroidLayout = true;
    return lastAndroidState;
  }
  try {
    const viewport = (window as Window & { viewport?: SegmentViewport }).viewport;
    const segments = viewport?.segments ?? (window.visualViewport as (VisualViewport & SegmentViewport) | null)?.segments ?? [];
    const posture = (navigator as PostureNavigator).devicePosture?.type;
    const folded = posture === 'folded' || (posture !== 'continuous' && android?.active
      && android.status === 'available' && android.feature?.folded === true);
    geometry = foldFromSegments(segments, !!folded);
  } catch { /* Experimental browser APIs must not mask native evidence. */ }
  if (geometry.foldRect) rememberFoldable();
  const native = geometry.foldRect ? null : readNativeFold();
  if (native && native.hinge !== 'none' && native.hinge !== 'unknown') {
    rememberFoldable();
    geometry = foldFromNative(native, { width: window.innerWidth, height: window.innerHeight });
  } else if (!geometry.foldRect && android) {
    if (android.confirmed) rememberFoldable();
    geometry = androidFoldGeometry(android, window.innerWidth, window.innerHeight);
  }
  if (android?.active && android.status === 'available') lastAndroidState = { size, ...geometry };
  return { size, ...geometry };
}

function signature(state: FoldState) {
  const r = state.foldRect;
  const foldable = isFoldableDevice();
  // Only confirmed foldables need viewport geometry to recalculate docking.
  // Ordinary resizes (including keyboard height changes) are not fold events;
  // genuine phone/wide size-class transitions still notify their readers.
  return [foldable ? window.innerWidth : null, foldable ? window.innerHeight : null,
    state.size, state.fold, r?.x, r?.y, r?.width, r?.height, foldable].join(':');
}

/** Start once before React mounts. Returns complete listener/timer cleanup. */
export function watchFoldPosture(onChange: (state: FoldState) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const apply = () => {
    const state = detectFoldState();
    if (waitingForAndroidLayout && watchedState) return;
    watchedState = state;
    const next = signature(state);
    if (next === last) return;
    last = next;
    window.dispatchEvent(new CustomEvent(FOLD_WILL_CHANGE_EVENT, { detail: state }));
    const root = document.documentElement;
    root.classList.toggle('foldable', isFoldableDevice());
    root.classList.toggle('wide', state.size === 'wide');
    root.classList.toggle('fold-laptop', state.fold === 'laptop');
    root.classList.toggle('fold-book', state.fold === 'book');
    for (const [name, value] of Object.entries({ top: state.foldRect?.y, left: state.foldRect?.x, width: state.foldRect?.width, height: state.foldRect?.height })) {
      root.style.setProperty(`--fold-${name}`, `${value ?? 0}px`);
    }
    onChange(state);
    window.dispatchEvent(new CustomEvent(FOLD_CHANGE_EVENT, { detail: state }));
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(apply, 150); };
  let posture: PostureNavigator['devicePosture'];
  try { posture = (navigator as PostureNavigator).devicePosture; } catch { /* optional API */ }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener(ANDROID_FOLD_CHANGE_EVENT, schedule);
  // Refresh on foregrounding even if a notification arrived while paused.
  document.addEventListener?.('visibilitychange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  posture?.addEventListener('change', schedule);
  window.addEventListener(NATIVE_FOLD_EVENT, schedule);
  const queries = ['(pointer: coarse)', '(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)'].map(query => window.matchMedia?.(query));
  queries.forEach(query => {
    if (query?.addEventListener) query.addEventListener('change', schedule);
    else query?.addListener?.(schedule);
  });
  apply();
  return () => {
    watchedState = null;
    clearTimeout(timer);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.removeEventListener(ANDROID_FOLD_CHANGE_EVENT, schedule);
    document.removeEventListener?.('visibilitychange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    posture?.removeEventListener('change', schedule);
    window.removeEventListener(NATIVE_FOLD_EVENT, schedule);
    queries.forEach(query => {
      if (query?.removeEventListener) query.removeEventListener('change', schedule);
      else query?.removeListener?.(schedule);
    });
  };
}

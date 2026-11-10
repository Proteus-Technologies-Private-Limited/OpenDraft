/** Fold signals use layout-viewport CSS pixels, never visual-viewport height
 * (which also changes when a keyboard opens). API presence alone does not
 * identify a foldable: ordinary Chrome exposes Device Posture too. */
export interface FoldState {
  size: 'phone' | 'wide';
  fold: 'flat' | 'laptop' | 'book';
  foldRect: DOMRect | null;
}
export const FOLD_CHANGE_EVENT = 'opendraft:foldchange';
/** Capture reading position before posture classes reflow the script. */
export const FOLD_WILL_CHANGE_EVENT = 'opendraft:beforefoldchange';
const CAPABILITY_KEY = 'opendraft:foldable';
interface Segment { left: number; top: number; width: number; height: number }
type SegmentViewport = { segments?: readonly Segment[] };
type PostureNavigator = Navigator & { devicePosture?: EventTarget & { type?: string } };
let confirmed = false;

export function isFoldableDevice(): boolean {
  if (confirmed) return true;
  try { return localStorage.getItem(CAPABILITY_KEY) === '1'; } catch { return false; }
}
function rememberFoldable() {
  confirmed = true;
  try { localStorage.setItem(CAPABILITY_KEY, '1'); } catch { /* private browsing */ }
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

export function getFoldState(): FoldState {
  if (typeof window === 'undefined') return { size: 'wide', fold: 'flat', foldRect: null };
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* unsupported */ }
  const size = coarse && Math.min(window.innerWidth, window.innerHeight) < 600 ? 'phone' : 'wide';
  // Chrome 138 ships window.viewport. Older origin-trial builds used
  // visualViewport.segments; keep that fallback without requiring either API.
  const viewport = (window as Window & { viewport?: SegmentViewport }).viewport;
  const segments = viewport?.segments ?? (window.visualViewport as (VisualViewport & SegmentViewport) | null)?.segments ?? [];
  const geometry = foldFromSegments(segments, (navigator as PostureNavigator).devicePosture?.type === 'folded');
  if (geometry.foldRect) rememberFoldable();
  return { size, ...geometry };
}

function signature(state: FoldState) {
  const r = state.foldRect;
  return [state.size, state.fold, r?.x, r?.y, r?.width, r?.height, isFoldableDevice()].join(':');
}

/** Start once before React mounts. Returns complete listener/timer cleanup. */
export function watchFoldPosture(onChange: (state: FoldState) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const apply = () => {
    const state = getFoldState();
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
  const posture = (navigator as PostureNavigator).devicePosture;
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  posture?.addEventListener('change', schedule);
  const queries = ['(pointer: coarse)', '(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)'].map(query => window.matchMedia?.(query));
  queries.forEach(query => {
    if (query?.addEventListener) query.addEventListener('change', schedule);
    else query?.addListener?.(schedule);
  });
  apply();
  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    posture?.removeEventListener('change', schedule);
    queries.forEach(query => {
      if (query?.removeEventListener) query.removeEventListener('change', schedule);
      else query?.removeListener?.(schedule);
    });
  };
}

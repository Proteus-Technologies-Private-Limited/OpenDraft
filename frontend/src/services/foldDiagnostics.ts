import { isFoldableDevice } from '../utils/foldPosture';
import { readAndroidFoldSnapshot, type AndroidFoldSnapshot } from '../utils/androidFoldPosture';

type Status = 'available' | 'unsupported' | 'error' | 'invalid';
interface Probe { status: Status; value?: unknown }
interface Rect { left: number | null; top: number | null; width: number | null; height: number | null }
interface Segments { status: Status; count: number | null; rects: Rect[]; truncated: boolean }

export interface FoldDiagnostics {
  kind: 'browser-snapshot';
  segmentsSource: 'window.viewport.segments' | 'visualViewport.segments' | 'size-only' | 'unreadable';
  windowSegments: Segments;
  legacySegments: Segments;
  devicePosture: { status: Status; value: 'continuous' | 'folded' | 'unrecognized' | null };
  nativeAndroid: AndroidFoldSnapshot | null;
  applied: {
    confirmed: boolean;
    foldableClass: boolean;
    size: 'phone' | 'wide' | 'unknown';
    posture: 'book' | 'laptop' | 'flat';
    crease: Rect | null;
    direction: 'ltr' | 'rtl';
  };
  viewport: {
    layout: { width: number | null; height: number | null };
    visual: { status: Status; width: number | null; height: number | null; offsetLeft: number | null; offsetTop: number | null; scale: number | null };
    screen: { width: number | null; height: number | null };
    devicePixelRatio: number | null;
    coarsePointer: boolean | null;
  };
}

function probe(read: () => unknown): Probe {
  try {
    const value = read();
    return value == null ? { status: 'unsupported' } : { status: 'available', value };
  } catch {
    // Error descriptions can contain arbitrary data; only record the status.
    return { status: 'error' };
  }
}

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const readNumber = (read: () => unknown) => number(probe(read).value);

function segments(input: Probe): Segments {
  if (input.status !== 'available') return { status: input.status, count: null, rects: [], truncated: false };
  if (!Array.isArray(input.value)) return { status: 'invalid', count: null, rects: [], truncated: false };
  try {
    // Copy only geometry, never arbitrary properties or browser-owned objects.
    const rects = input.value.slice(0, 8).map((value: unknown): Rect => {
      const rect = value as Partial<DOMRect> | null;
      return { left: number(rect?.left), top: number(rect?.top), width: number(rect?.width), height: number(rect?.height) };
    });
    return { status: 'available', count: input.value.length, rects, truncated: input.value.length > rects.length };
  } catch {
    return { status: 'error', count: null, rects: [], truncated: false };
  }
}

/** Read-only snapshot: opening Diagnostics must not confirm a foldable, emit
 * posture events, read script content or infer whether a keyboard is present. */
export function collectFoldDiagnostics(): FoldDiagnostics | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const current = probe(() => (window as Window & { viewport?: { segments?: unknown } }).viewport?.segments);
  const legacy = probe(() => (window.visualViewport as (VisualViewport & { segments?: unknown }) | null)?.segments);
  const posture = probe(() => (navigator as Navigator & { devicePosture?: { type?: unknown } }).devicePosture?.type);
  const root = document.documentElement;
  const cssNumber = (name: string) => {
    const raw = root.style.getPropertyValue(`--fold-${name}`).trim();
    return raw ? number(Number.parseFloat(raw)) : null;
  };
  const crease = { left: cssNumber('left'), top: cssNumber('top'), width: cssNumber('width'), height: cssNumber('height') };
  const visual = probe(() => window.visualViewport);
  const metrics = visual.status === 'available' ? probe(() => {
    const v = visual.value as VisualViewport;
    return { width: number(v.width), height: number(v.height), offsetLeft: number(v.offsetLeft), offsetTop: number(v.offsetTop), scale: number(v.scale) };
  }) : visual;
  const pointer = probe(() => window.matchMedia?.('(pointer: coarse)').matches);
  return {
    kind: 'browser-snapshot',
    nativeAndroid: readAndroidFoldSnapshot(),
    // Match the detector's nullish precedence, including an empty current list.
    segmentsSource: current.status === 'error' ? 'unreadable'
      : current.status === 'available' ? 'window.viewport.segments'
        : legacy.status === 'error' ? 'unreadable' : legacy.status === 'available' ? 'visualViewport.segments' : 'size-only',
    windowSegments: segments(current),
    legacySegments: segments(legacy),
    devicePosture: { status: posture.status, value: posture.status !== 'available' ? null
      : posture.value === 'folded' || posture.value === 'continuous' ? posture.value : 'unrecognized' },
    applied: {
      confirmed: isFoldableDevice(),
      foldableClass: root.classList.contains('foldable'),
      size: root.classList.contains('phone') ? 'phone' : root.classList.contains('wide') ? 'wide' : 'unknown',
      posture: root.classList.contains('fold-book') ? 'book' : root.classList.contains('fold-laptop') ? 'laptop' : 'flat',
      crease: Object.values(crease).some(value => value !== null && value !== 0) ? crease : null,
      direction: root.dir === 'rtl' ? 'rtl' : 'ltr',
    },
    viewport: {
      layout: { width: readNumber(() => window.innerWidth), height: readNumber(() => window.innerHeight) },
      visual: { status: metrics.status, width: null, height: null, offsetLeft: null, offsetTop: null, scale: null,
        ...(metrics.status === 'available' ? metrics.value as Record<string, number | null> : {}) },
      screen: { width: readNumber(() => window.screen?.width), height: readNumber(() => window.screen?.height) },
      devicePixelRatio: readNumber(() => window.devicePixelRatio),
      coarsePointer: typeof pointer.value === 'boolean' ? pointer.value : null,
    },
  };
}

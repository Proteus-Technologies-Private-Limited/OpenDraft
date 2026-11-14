import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOLD_WILL_CHANGE_EVENT, foldFromSegments, getFoldState, isFoldableDevice, watchFoldPosture } from './foldPosture';
class Rect {
  x: number; y: number; width: number; height: number;
  constructor(x = 0, y = 0, width = 0, height = 0) { this.x=x; this.y=y; this.width=width; this.height=height; }
}
const horizontal = [{ left: 0, top: 0, width: 800, height: 390 }, { left: 0, top: 410, width: 800, height: 390 }];
const vertical = [{ left: 0, top: 0, width: 390, height: 800 }, { left: 410, top: 0, width: 390, height: 800 }];
beforeEach(() => vi.stubGlobal('DOMRect', Rect));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('fold geometry', () => {
  it('distinguishes laptop and book, including reversed segment order', () => {
    expect(foldFromSegments(horizontal, true)).toEqual({ fold: 'laptop', foldRect: new Rect(0, 390, 800, 20) });
    expect(foldFromSegments([...vertical].reverse(), true)).toEqual({ fold: 'book', foldRect: new Rect(390, 0, 20, 800) });
  });
  it('retains a flat foldable crease without claiming a half-open posture', () => {
    expect(foldFromSegments(vertical, false)).toEqual({ fold: 'flat', foldRect: new Rect(390, 0, 20, 800) });
  });
  it('supports a zero-width crease', () => {
    expect(foldFromSegments([{ left: 0, top: 0, width: 400, height: 800 }, { left: 400, top: 0, width: 400, height: 800 }], true).fold).toBe('book');
  });
  it('rejects invalid, overlapping, single and mismatched segments', () => {
    for (const segments of [[], [vertical[0]], [vertical[0], vertical[0]], [vertical[0], { ...vertical[1], height: 10 }], [vertical[0], { ...vertical[1], width: NaN }]]) {
      expect(foldFromSegments(segments, true)).toEqual({ fold: 'flat', foldRect: null });
    }
  });
});

describe('browser detection', () => {
  it('does not treat Device Posture API presence as foldable evidence', () => {
    localStorage.removeItem('opendraft:foldable');
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 800, matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('navigator', { devicePosture: { type: 'continuous' } });
    expect(getFoldState()).toEqual({ size: 'phone', fold: 'flat', foldRect: null });
    expect(isFoldableDevice()).toBe(false);
  });
  it('reads the shipped API and retains confirmed capability on the cover', () => {
    const win = { innerWidth: 800, innerHeight: 800, matchMedia: () => ({ matches: true }), viewport: { segments: vertical } };
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', { devicePosture: { type: 'folded' } });
    expect(getFoldState().fold).toBe('book');
    expect(isFoldableDevice()).toBe(true);
    win.viewport.segments = []; win.innerWidth = 390;
    expect(getFoldState()).toEqual({ size: 'phone', fold: 'flat', foldRect: null });
    expect(isFoldableDevice()).toBe(true);
  });
  it('supports the legacy segments location', () => {
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 800, visualViewport: { segments: horizontal }, matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('navigator', { devicePosture: { type: 'folded' } });
    expect(getFoldState().fold).toBe('laptop');
  });
  it('debounces geometry changes and removes subscriptions and pending work', () => {
    vi.useFakeTimers();
    const win = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 800, matchMedia: () => ({ matches: true }), viewport: { segments: vertical } });
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', { devicePosture: Object.assign(new EventTarget(), { type: 'continuous' }) });
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    const seen = vi.fn();
    const stop = watchFoldPosture(seen);
    expect(seen).toHaveBeenCalledTimes(1);
    win.innerWidth = 400;
    win.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(100);
    win.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(149);
    expect(seen).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ size: 'phone' }));
    win.innerWidth = 800; win.dispatchEvent(new Event('resize')); stop();
    vi.runAllTimers(); win.dispatchEvent(new Event('resize')); vi.runAllTimers();
    expect(seen).toHaveBeenCalledTimes(2);
  });
  it('notifies readers before changing posture classes', () => {
    const win = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 800, matchMedia: () => ({ matches: true }) });
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', {});
    let wide = false;
    const before: boolean[] = [];
    vi.stubGlobal('document', { documentElement: {
      classList: { toggle: (name: string, value: boolean) => { if (name === 'wide') wide = value; } },
      style: { setProperty: vi.fn() },
    } });
    win.addEventListener(FOLD_WILL_CHANGE_EVENT, () => before.push(wide));
    const stop = watchFoldPosture(() => {});
    expect(before).toEqual([false]);
    expect(wide).toBe(true);
    stop();
  });

  it('forgets confirmed capability on a new document and discards the legacy marker', async () => {
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 800, matchMedia: () => ({ matches: true }), viewport: { segments: vertical } });
    vi.stubGlobal('navigator', {});
    vi.resetModules();
    const first = await import('./foldPosture');
    first.getFoldState();
    expect(first.isFoldableDevice()).toBe(true);
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: false }) });
    expect(first.isFoldableDevice()).toBe(true); // retained for folding within this page
    localStorage.setItem('opendraft:foldable', '1');
    vi.resetModules();
    const reloaded = await import('./foldPosture');
    reloaded.getFoldState();
    expect(reloaded.isFoldableDevice()).toBe(false);
    expect(localStorage.getItem('opendraft:foldable')).toBeNull();
  });

  it('reports a confirmed foldable resize even when segment and size classes stay unchanged', () => {
    vi.useFakeTimers();
    const win = Object.assign(new EventTarget(), { innerWidth: 951, innerHeight: 669, matchMedia: () => ({ matches: true }), viewport: { segments: vertical } });
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    getFoldState(); // establish capability independently of other tests
    win.viewport.segments = [];
    const changed = vi.fn();
    const stop = watchFoldPosture(changed);
    win.innerWidth = 800;
    win.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(150);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith({ size: 'wide', fold: 'flat', foldRect: null });
    stop();
  });

  it.each([
    { device: 'desktop', width: 1440, height: 1000, coarse: false, nextWidth: 1360, nextHeight: 1000 },
    { device: 'tablet', width: 1024, height: 1100, coarse: true, nextWidth: 944, nextHeight: 1100 },
    { device: 'phone keyboard resize', width: 390, height: 844, coarse: true, nextWidth: 390, nextHeight: 600 },
  ])('does not emit fold changes for an ordinary $device resize', async ({ width, height, coarse, nextWidth, nextHeight }) => {
    vi.resetModules();
    const ordinary = await import('./foldPosture');
    vi.useFakeTimers();
    const win = Object.assign(new EventTarget(), {
      innerWidth: width, innerHeight: height, matchMedia: () => ({ matches: coarse }),
    });
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    const changed = vi.fn();
    const before = vi.fn();
    win.addEventListener(FOLD_WILL_CHANGE_EVENT, before);
    const stop = ordinary.watchFoldPosture(changed);
    expect(ordinary.isFoldableDevice()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    win.innerWidth = nextWidth;
    win.innerHeight = nextHeight;
    win.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(150);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(before).toHaveBeenCalledTimes(1);
    stop();
  });

  it('still notifies an ordinary touch device when its phone/wide size class changes', async () => {
    vi.resetModules();
    const ordinary = await import('./foldPosture');
    vi.useFakeTimers();
    const win = Object.assign(new EventTarget(), {
      innerWidth: 800, innerHeight: 650, matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    const changed = vi.fn();
    const stop = ordinary.watchFoldPosture(changed);
    win.innerHeight = 590;
    win.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(150);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith({ size: 'phone', fold: 'flat', foldRect: null });
    expect(ordinary.isFoldableDevice()).toBe(false);
    stop();
  });

});

// The iOS app's report from UIKit's hinge (FoldPosture.m), for the WKWebView
// that has none of the browser fold APIs. Each test loads a fresh module,
// since a confirmed foldable is remembered for the life of the page.
describe('native hinge (iOS app)', () => {
  const duoBook = { x: 470, y: 0, width: 11, height: 669 };
  const duoLaptop = { x: 0, y: 470, width: 669, height: 11 };
  const fresh = async () => { vi.resetModules(); return import('./foldPosture'); };
  const nativeWindow = (report: unknown, size = { innerWidth: 951, innerHeight: 669 }) =>
    Object.assign(new EventTarget(), { ...size, matchMedia: () => ({ matches: true }), __opendraftNativeFold: report });

  it('maps hinge status and crease direction to postures', async () => {
    const { foldFromNative } = await fresh();
    const viewport = { width: 951, height: 669 };
    expect(foldFromNative({ hinge: 'partiallyOpen', division: duoBook }, viewport)).toEqual({ fold: 'book', foldRect: new Rect(470, 0, 11, 669) });
    expect(foldFromNative({ hinge: 'partiallyOpen', division: duoLaptop }, { width: 669, height: 951 })).toEqual({ fold: 'laptop', foldRect: new Rect(0, 470, 669, 11) });
    // Fully open is flat but keeps the crease, like the browser's 'continuous'.
    expect(foldFromNative({ hinge: 'fullyOpen', division: { ...duoBook, active: false } }, viewport)).toEqual({ fold: 'flat', foldRect: new Rect(470, 0, 11, 669) });
    expect(foldFromNative({ hinge: 'closed', division: duoBook }, viewport)).toEqual({ fold: 'flat', foldRect: null });
  });

  it('ignores a crease that is invalid or outside this window', async () => {
    const { foldFromNative } = await fresh();
    for (const division of [null, { x: NaN, y: 0, width: 11, height: 669 }, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: -1, height: 669 }]) {
      expect(foldFromNative({ hinge: 'partiallyOpen', division }, { width: 951, height: 669 })).toEqual({ fold: 'flat', foldRect: null });
    }
    // Split View: a pane on one half of the open screen does not contain the crease.
    expect(foldFromNative({ hinge: 'fullyOpen', division: duoBook }, { width: 470, height: 669 }).foldRect).toBeNull();
  });

  it('confirms a foldable from the hinge, including on the cover screen', async () => {
    const { getFoldState, isFoldableDevice } = await fresh();
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', nativeWindow({ hinge: 'closed', division: null }, { innerWidth: 466, innerHeight: 678 }));
    expect(getFoldState()).toEqual({ size: 'phone', fold: 'flat', foldRect: null });
    expect(isFoldableDevice()).toBe(true);
  });

  it('does not confirm a foldable without a hinge, or before the hinge has answered', async () => {
    const { getFoldState, isFoldableDevice } = await fresh();
    vi.stubGlobal('navigator', {});
    for (const report of [{ hinge: 'none', division: null }, { hinge: 'unknown', division: duoBook }, { hinge: 'sideways', division: duoBook }, 'closed', null]) {
      vi.stubGlobal('window', nativeWindow(report));
      expect(getFoldState()).toEqual({ size: 'wide', fold: 'flat', foldRect: null });
    }
    expect(isFoldableDevice()).toBe(false);
  });

  it('lets the browser APIs win when they report a crease', async () => {
    const { getFoldState } = await fresh();
    vi.stubGlobal('navigator', { devicePosture: { type: 'folded' } });
    vi.stubGlobal('window', Object.assign(nativeWindow({ hinge: 'closed', division: null }, { innerWidth: 800, innerHeight: 800 }), { viewport: { segments: vertical } }));
    expect(getFoldState().fold).toBe('book');
  });

  it('re-reads posture when the app reports a hinge change', async () => {
    vi.useFakeTimers();
    const { watchFoldPosture, NATIVE_FOLD_EVENT } = await fresh();
    const win = nativeWindow({ hinge: 'closed', division: null }, { innerWidth: 466, innerHeight: 678 });
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    const seen = vi.fn();
    const stop = watchFoldPosture(seen);
    expect(seen).toHaveBeenLastCalledWith({ size: 'phone', fold: 'flat', foldRect: null });
    Object.assign(win, { innerWidth: 951, innerHeight: 669, __opendraftNativeFold: { hinge: 'partiallyOpen', division: duoBook } });
    win.dispatchEvent(new Event(NATIVE_FOLD_EVENT));
    vi.advanceTimersByTime(150);
    expect(seen).toHaveBeenLastCalledWith({ size: 'wide', fold: 'book', foldRect: new Rect(470, 0, 11, 669) });
    stop();
    win.dispatchEvent(new Event(NATIVE_FOLD_EVENT)); vi.runAllTimers();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

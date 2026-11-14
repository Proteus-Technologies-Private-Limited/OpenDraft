import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANDROID_FOLD_CHANGE_EVENT, androidFoldGeometry, readAndroidFoldSnapshot, type AndroidFoldSnapshot } from './androidFoldPosture';

const snapshot = (): AndroidFoldSnapshot => ({ version: 1, status: 'available', active: true, confirmed: true,
  webView: { left: 20, top: 40, width: 1600, height: 1600 },
  feature: { left: 800, top: 0, width: 40, height: 1680, orientation: 'vertical', folded: true } });
let raw: unknown;
let win: Window & { OpenDraftAndroidFold: { snapshot: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.stubGlobal('DOMRect', class {
    x: number; y: number; width: number; height: number;
    constructor(x: number, y: number, width: number, height: number) { this.x = x; this.y = y; this.width = width; this.height = height; }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  });
  raw = JSON.stringify(snapshot());
  win = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 800,
    matchMedia: () => ({ matches: true }), OpenDraftAndroidFold: { snapshot: vi.fn(() => raw) } }) as unknown as typeof win;
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Android fold geometry', () => {
  it('translates window offsets and scales physical pixels to CSS without assuming density', () => {
    const result = androidFoldGeometry(snapshot(), 800, 800);
    expect(result.fold).toBe('book');
    expect(result.foldRect?.toJSON()).toMatchObject({ x: 390, y: 0, width: 20, height: 800 });
    expect(androidFoldGeometry(snapshot(), 400, 400).foldRect?.x).toBe(195);
  });
  it('maps a zero-height horizontal crease and distinguishes flat from half-open', () => {
    const s = snapshot();
    s.feature = { left: 0, top: 840, width: 1680, height: 0, orientation: 'horizontal', folded: true };
    expect(androidFoldGeometry(s, 800, 800)).toMatchObject({ fold: 'laptop', foldRect: { y: 400, height: 0 } });
    s.feature.folded = false;
    expect(androidFoldGeometry(s, 800, 800)).toMatchObject({ fold: 'flat', foldRect: { y: 400 } });
  });
  it('does not split a WebView confined to one side, or a partial cross-axis feature', () => {
    const s = snapshot();
    s.webView.width = 700;
    expect(androidFoldGeometry(s, 350, 800).foldRect).toBeNull();
    s.webView.width = 1600;
    s.feature!.height = 800;
    expect(androidFoldGeometry(s, 800, 800).foldRect).toBeNull();
  });
  it.each(['pending', 'unavailable'] as const)('ignores stale geometry while %s', status => {
    const s = snapshot(); s.status = status;
    expect(androidFoldGeometry(s, 800, 800).foldRect).toBeNull();
  });
  it('handles stopped, unmeasured, unconfirmed and cover snapshots', () => {
    for (const change of [{ active: false }, { confirmed: false }, { feature: null }, { webView: { ...snapshot().webView, width: 0 } }]) {
      expect(androidFoldGeometry({ ...snapshot(), ...change }, 800, 800)).toEqual({ fold: 'flat', foldRect: null });
    }
  });
});

describe('read-only native protocol', () => {
  it('copies only the fixed geometry fields', () => {
    raw = JSON.stringify({ ...snapshot(), secret: 'synthetic title', feature: { ...snapshot().feature, secret: 'draft' } });
    expect(readAndroidFoldSnapshot()).toEqual(snapshot());
    expect(win.OpenDraftAndroidFold.snapshot).toHaveBeenCalledTimes(1);
  });
  it.each([null, '', 'invalid JSON', '{}', JSON.stringify({ ...snapshot(), version: 2 }),
    JSON.stringify({ ...snapshot(), active: 'true' }), JSON.stringify({ ...snapshot(), confirmed: 1 }),
    JSON.stringify({ ...snapshot(), webView: { ...snapshot().webView, width: -1 } }),
    JSON.stringify({ ...snapshot(), feature: { ...snapshot().feature, orientation: 'diagonal' } }),
    JSON.stringify({ ...snapshot(), feature: { ...snapshot().feature, width: null } }), ' '.repeat(2049),
  ])('ignores unsupported or malformed snapshots: %j', value => {
    raw = value;
    expect(readAndroidFoldSnapshot()).toBeNull();
  });
  it('handles throwing or missing native interfaces', () => {
    win.OpenDraftAndroidFold.snapshot.mockImplementation(() => { throw new Error('private detail'); });
    expect(readAndroidFoldSnapshot()).toBeNull();
    vi.stubGlobal('window', {});
    expect(readAndroidFoldSnapshot()).toBeNull();
  });
});

describe('detector integration', () => {
  beforeEach(() => vi.resetModules());
  it('uses native geometry without browser segment/posture APIs', async () => {
    const { getFoldState, isFoldableDevice } = await import('./foldPosture');
    expect(getFoldState()).toMatchObject({ fold: 'book', foldRect: { x: 390, width: 20 } });
    expect(isFoldableDevice()).toBe(true);
  });
  it('keeps valid browser geometry ahead of native geometry', async () => {
    Object.assign(win, { viewport: { segments: [{ left: 0, top: 0, width: 800, height: 390 }, { left: 0, top: 410, width: 800, height: 390 }] } });
    vi.stubGlobal('navigator', { devicePosture: { type: 'folded' } });
    expect((await import('./foldPosture')).getFoldState().fold).toBe('laptop');
  });
  it('uses native half-open evidence when only browser segments are exposed', async () => {
    Object.assign(win, { viewport: { segments: [{ left: 0, top: 0, width: 800, height: 390 }, { left: 0, top: 410, width: 800, height: 390 }] } });
    expect((await import('./foldPosture')).getFoldState().fold).toBe('laptop');
  });
  it('falls back to native when a browser API getter throws', async () => {
    Object.defineProperty(win, 'viewport', { get() { throw new Error('unsupported'); } });
    expect((await import('./foldPosture')).getFoldState().fold).toBe('book');
  });
  it('does not identify a cold cover or ordinary phone from an empty native result', async () => {
    raw = JSON.stringify({ ...snapshot(), confirmed: false, feature: null });
    const detector = await import('./foldPosture');
    expect(detector.getFoldState().foldRect).toBeNull();
    expect(detector.isFoldableDevice()).toBe(false);
  });
  it('retains Activity evidence on the cover but resets with an unconfirmed new Activity', async () => {
    raw = JSON.stringify({ ...snapshot(), feature: null });
    const detector = await import('./foldPosture');
    expect(detector.getFoldState().foldRect).toBeNull();
    expect(detector.isFoldableDevice()).toBe(true);
    vi.resetModules(); raw = JSON.stringify({ ...snapshot(), confirmed: false, feature: null });
    const next = await import('./foldPosture'); next.getFoldState();
    expect(next.isFoldableDevice()).toBe(false);
  });
  it('debounces native events, captures before reflow and cleans up its listener/timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    const { watchFoldPosture } = await import('./foldPosture');
    const changed = vi.fn();
    const stop = watchFoldPosture(changed);
    raw = JSON.stringify({ ...snapshot(), feature: null });
    win.dispatchEvent(new Event(ANDROID_FOLD_CHANGE_EVENT));
    vi.advanceTimersByTime(149);
    expect(changed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenLastCalledWith({ size: 'wide', fold: 'flat', foldRect: null });
    raw = JSON.stringify(snapshot());
    win.dispatchEvent(new Event(ANDROID_FOLD_CHANGE_EVENT)); stop(); vi.runAllTimers();
    win.dispatchEvent(new Event(ANDROID_FOLD_CHANGE_EVENT)); vi.runAllTimers();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('refreshes the cached snapshot on foregrounding and removes that subscription', async () => {
    vi.useFakeTimers();
    const doc = Object.assign(new EventTarget(), { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    vi.stubGlobal('document', doc);
    const { watchFoldPosture } = await import('./foldPosture');
    const changed = vi.fn();
    const stop = watchFoldPosture(changed);
    raw = JSON.stringify({ ...snapshot(), feature: null });
    doc.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(150);
    expect(changed).toHaveBeenLastCalledWith({ size: 'wide', fold: 'flat', foldRect: null });
    stop(); raw = JSON.stringify(snapshot());
    doc.dispatchEvent(new Event('visibilitychange')); vi.runAllTimers();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it.each(['book', 'laptop'] as const)('keeps %s layout and preferences through stop/pending until fresh geometry arrives', async posture => {
    vi.useFakeTimers();
    const value = snapshot();
    if (posture === 'laptop') value.feature = {
      left: 0, top: 840, width: 1680, height: 0, orientation: 'horizontal', folded: true,
    };
    raw = JSON.stringify(value);
    const toggle = vi.fn();
    vi.stubGlobal('document', { documentElement: { classList: { toggle }, style: { setProperty: vi.fn() } } });
    const detector = await import('./foldPosture');
    const changed = vi.fn();
    const before = vi.fn();
    win.addEventListener(detector.FOLD_WILL_CHANGE_EVENT, before);
    const stop = detector.watchFoldPosture(changed);
    const initial = detector.getFoldState();
    expect(initial.fold).toBe(posture);
    const appliedClasses = toggle.mock.calls.length;
    for (const active of [false, true]) {
      raw = JSON.stringify({ ...value, active, status: 'pending', feature: null });
      Object.assign(win, { innerWidth: 400, innerHeight: 700 });
      win.dispatchEvent(new Event(ANDROID_FOLD_CHANGE_EVENT));
      vi.advanceTimersByTime(500);
      expect(detector.getFoldState()).toEqual(initial);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(before).toHaveBeenCalledTimes(1);
      expect(toggle).toHaveBeenCalledTimes(appliedClasses);
    }
    raw = JSON.stringify({ ...value, feature: null });
    win.dispatchEvent(new Event(ANDROID_FOLD_CHANGE_EVENT));
    vi.advanceTimersByTime(150);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(detector.getFoldState()).toEqual({ size: 'phone', fold: 'flat', foldRect: null });
    stop();
  });
  it('shares one native read across all subscribers in each applied event', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn() }, style: { setProperty: vi.fn() } } });
    const detector = await import('./foldPosture');
    const stop = detector.watchFoldPosture(() => {
      for (let i = 0; i < 4; i++) detector.getFoldState();
    });
    expect(win.OpenDraftAndroidFold.snapshot).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) detector.getFoldState();
    expect(win.OpenDraftAndroidFold.snapshot).toHaveBeenCalledTimes(1);
    raw = JSON.stringify({ ...snapshot(), feature: null });
    win.dispatchEvent(new Event(ANDROID_FOLD_CHANGE_EVENT));
    vi.advanceTimersByTime(150);
    expect(win.OpenDraftAndroidFold.snapshot).toHaveBeenCalledTimes(2);
    stop();
  });

});

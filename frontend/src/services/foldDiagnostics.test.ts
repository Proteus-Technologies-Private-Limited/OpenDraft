import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let collect: typeof import('./foldDiagnostics').collectFoldDiagnostics;
let detector: typeof import('../utils/foldPosture');
const book = [{ left: 0, top: 0, width: 390, height: 800 }, { left: 410, top: 0, width: 390, height: 800 }];
let classes: Set<string>;
let css: Record<string, string>;
let win: Record<string, unknown>;

beforeEach(async () => {
  vi.resetModules();
  classes = new Set(['wide']);
  css = {};
  win = { innerWidth: 800, innerHeight: 800, devicePixelRatio: 2,
    screen: { width: 800, height: 800 }, matchMedia: () => ({ matches: true }), visualViewport: null };
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { userAgent: 'Synthetic browser', platform: 'Linux' });
  vi.stubGlobal('document', { documentElement: { classList: { contains: (name: string) => classes.has(name) },
    style: { getPropertyValue: (name: string) => css[name] ?? '' }, dir: 'ltr' } });
  vi.stubGlobal('DOMRect', class {
    x: number; y: number; width: number; height: number;
    constructor(x: number, y: number, width: number, height: number) { this.x=x; this.y=y; this.width=width; this.height=height; }
  });
  detector = await import('../utils/foldPosture');
  collect = (await import('./foldDiagnostics')).collectFoldDiagnostics;
});

afterEach(() => vi.unstubAllGlobals());

describe('foldable diagnostic snapshot', () => {
  it('copies only fixed native geometry without confirming capability or changing the detector', () => {
    win.OpenDraftAndroidFold = { snapshot: () => JSON.stringify({ version: 1, status: 'available', active: true, confirmed: true,
      webView: { left: 0, top: 0, width: 1600, height: 1600 }, feature: null, script: 'private draft' }) };
    const report = collect()!;
    expect(report.nativeAndroid).toMatchObject({ confirmed: true, feature: null, status: 'available' });
    expect(JSON.stringify(report)).not.toContain('private draft');
    expect(report.applied.confirmed).toBe(false);
    expect(detector.isFoldableDevice()).toBe(false);
  });
  it('handles ordinary devices and missing browser APIs without claiming foldable support', () => {
    const report = collect()!;
    expect(report.segmentsSource).toBe('size-only');
    expect(report.windowSegments.status).toBe('unsupported');
    expect(report.devicePosture).toEqual({ status: 'unsupported', value: null });
    expect(report.viewport.visual.status).toBe('unsupported');
    expect(report.applied).toMatchObject({ confirmed: false, posture: 'flat', crease: null });
  });

  it('captures browser inputs separately from the applied state without changing detection', () => {
    win.viewport = { segments: book };
    vi.stubGlobal('navigator', { devicePosture: { type: 'folded' } });
    const event = vi.fn(); win.dispatchEvent = event;
    const report = collect()!;
    expect(report.segmentsSource).toBe('window.viewport.segments');
    expect(report.windowSegments.rects).toEqual(book);
    expect(report.devicePosture.value).toBe('folded');
    expect(report.applied).toMatchObject({ confirmed: false, posture: 'flat' });
    expect(detector.isFoldableDevice()).toBe(false);
    expect(event).not.toHaveBeenCalled();
    expect(classes).toEqual(new Set(['wide']));
    expect(css).toEqual({});
  });

  it('reports the iOS app\'s native hinge read-only, copying only its fixed fields', () => {
    expect(collect()!.nativeHinge).toEqual({ status: 'unsupported', hinge: null, angle: null, division: null, divisionActive: null });
    win.__opendraftNativeFold = { hinge: 'partiallyOpen', angle: 1.6, extra: 'not copied',
      division: { x: 470, y: 0, width: 11, height: 669, active: true } };
    const report = collect()!;
    expect(report.segmentsSource).toBe('native-hinge');
    expect(report.nativeHinge).toEqual({ status: 'available', hinge: 'partiallyOpen', angle: 1.6,
      division: { left: 470, top: 0, width: 11, height: 669 }, divisionActive: true });
    // Reading it confirms nothing: that is the detector's job, not Diagnostics'.
    expect(detector.isFoldableDevice()).toBe(false);
    expect(classes).toEqual(new Set(['wide']));
  });

  it('uses the legacy location only when the current list is absent, not when it is empty', () => {
    win.visualViewport = { segments: book, width: 800, height: 400, offsetLeft: 0, offsetTop: 80, scale: 1 };
    expect(collect()!.segmentsSource).toBe('visualViewport.segments');
    win.viewport = { segments: [] };
    const report = collect()!;
    expect(report.segmentsSource).toBe('window.viewport.segments');
    expect(report.windowSegments.count).toBe(0);
    expect(report.legacySegments.count).toBe(2);
    expect(report.viewport.visual).toMatchObject({ status: 'available', height: 400, offsetTop: 80, scale: 1 });
    expect(report).not.toHaveProperty('keyboardOpen');
  });

  it('records a confirmed cover screen without treating its size as new evidence', () => {
    win.viewport = { segments: book };
    detector.getFoldState();
    win.viewport = { segments: [] }; win.innerWidth = 390;
    classes = new Set(['phone', 'foldable']);
    const report = collect()!;
    expect(report.applied).toMatchObject({ confirmed: true, foldableClass: true, size: 'phone', posture: 'flat' });
    expect(report.windowSegments.count).toBe(0);
  });

  it('includes applied crease geometry, direction and visual viewport offsets', () => {
    classes.add('foldable'); classes.add('fold-laptop');
    Object.assign(css, { '--fold-left': '0px', '--fold-top': '390px', '--fold-width': '800px', '--fold-height': '20px' });
    document.documentElement.dir = 'rtl';
    win.visualViewport = { width: 800, height: 300, offsetLeft: 12, offsetTop: 120, scale: 1.5 };
    expect(collect()!.applied).toMatchObject({ posture: 'laptop', direction: 'rtl', crease: { left: 0, top: 390, width: 800, height: 20 } });
    expect(collect()!.viewport.visual).toMatchObject({ width: 800, height: 300, offsetLeft: 12, offsetTop: 120, scale: 1.5 });
  });

  it('isolates unavailable and throwing experimental APIs without copying exception text', () => {
    Object.defineProperty(win, 'viewport', { get() { throw new Error('private script text'); } });
    vi.stubGlobal('navigator', { get devicePosture() { throw new Error('private title'); } });
    const report = collect()!;
    expect(report.windowSegments.status).toBe('error');
    expect(report.devicePosture.status).toBe('error');
    expect(report.segmentsSource).toBe('unreadable');
    expect(JSON.stringify(report)).not.toContain('private');
  });

  it('bounds copied geometry, drops unrelated properties and serializes invalid numbers safely', () => {
    win.viewport = { segments: Array.from({ length: 100 }, () => ({ ...book[0], width: Infinity, title: 'private title', toJSON() { throw new Error('Do not serialize browser objects'); } })) };
    const report = collect()!;
    expect(report.windowSegments).toMatchObject({ status: 'available', count: 100, truncated: true });
    expect(report.windowSegments.rects).toHaveLength(8);
    expect(report.windowSegments.rects[0].width).toBeNull();
    expect(JSON.stringify(report)).not.toContain('private');
    win.viewport = { segments: 'invalid API result' };
    expect(collect()!.windowSegments.status).toBe('invalid');
  });

  it('includes the snapshot in the existing copy report without reading script content or preferences', async () => {
    win.viewport = { segments: book };
    const { collectDiagnostics, formatReport } = await import('./diagnostics');
    const report = await collectDiagnostics();
    const text = formatReport(report);
    expect(report.display?.windowSegments.count).toBe(2);
    expect(text).toContain('Display and posture (browser snapshot):');
    expect(text).toContain('"segmentsSource": "window.viewport.segments"');
    expect(detector.isFoldableDevice()).toBe(false);
  });

  it('returns reduced diagnostics outside a browser', () => {
    vi.stubGlobal('window', undefined);
    expect(collect()).toBeNull();
  });
});

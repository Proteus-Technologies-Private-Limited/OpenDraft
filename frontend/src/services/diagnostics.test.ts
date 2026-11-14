import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDiagnostics } from './foldDiagnostics';

const fold = vi.hoisted(() => vi.fn<() => FoldDiagnostics | null>());
vi.mock('./foldDiagnostics', () => ({ collectFoldDiagnostics: fold }));
vi.mock('./platform', () => ({ isDesktopTauri: () => false }));
vi.mock('./appVersion', () => ({ readAppVersion: async () => '9.8.7', getAppVersion: () => '9.8.7' }));
vi.mock('./compat', () => ({ getCompatEntries: () => [{ label: 'Storage', mode: 'native', using: 'sqlite', errorReason: null }] }));

import { collectDiagnostics, detectOs, formatReport } from './diagnostics';
import { useStorageStatusStore } from '../stores/storageStatusStore';

beforeEach(() => {
  fold.mockReset().mockReturnValue(null);
  useStorageStatusStore.getState().setMode('file-fallback', 'SQLite unavailable');
});

describe('optional display diagnostics', () => {
  it('keeps an unavailable display snapshot nullable', async () => {
    const report = await collectDiagnostics();
    expect(report.display).toBeNull();
    expect(formatReport(report)).not.toContain('Display and posture');
    expect(fold).toHaveBeenCalledTimes(1);
  });

  it.each([new Error('private exception text'), 'private rejection text'])('preserves the report when the display collector throws %s', async failure => {
    fold.mockImplementation(() => { throw failure; });
    const report = await collectDiagnostics();
    expect(report).toMatchObject({ appVersion: '9.8.7', storageMode: 'file-fallback', storageError: 'SQLite unavailable', display: null });
    const text = formatReport(report);
    expect(text).toContain('Version: 9.8.7');
    expect(text).toContain('Storage error: SQLite unavailable');
    expect(text).toContain('Storage: native (sqlite)');
    expect(text).not.toContain('private');
    expect(text).not.toContain('Display and posture');
  });

  it('retains a successful display snapshot', async () => {
    const segments = { status: 'unsupported' as const, count: null, rects: [], truncated: false };
    const snapshot: FoldDiagnostics = {
      kind: 'browser-snapshot', segmentsSource: 'size-only', windowSegments: segments, legacySegments: segments,
      devicePosture: { status: 'unsupported', value: null },
      nativeHinge: { status: 'available', hinge: 'partiallyOpen', angle: 90,
        division: { left: 455.5, top: 0, width: 40, height: 669 }, divisionActive: true },
      applied: { confirmed: false, foldableClass: false, size: 'wide', posture: 'flat', crease: null, direction: 'ltr' },
      viewport: { layout: { width: 1200, height: 800 }, screen: { width: 1200, height: 800 }, devicePixelRatio: 1, coarsePointer: false,
        visual: { status: 'unsupported', width: null, height: null, offsetLeft: null, offsetTop: null, scale: null } },
    };
    fold.mockReturnValue(snapshot);
    const report = await collectDiagnostics();
    expect(report.display).toEqual(snapshot);
    expect(formatReport(report)).toContain('Display and posture (browser snapshot)');
    expect(report.display?.nativeHinge).toEqual(snapshot.nativeHinge);
    const displayJSON = formatReport(report)
      .split('Display and posture (browser snapshot):\n')[1].split('\n\nUser-Agent:')[0];
    expect(JSON.parse(displayJSON).nativeHinge).toEqual(snapshot.nativeHinge);
  });
});

// User agents as the app's web views actually send them.
const IPHONE_WKWEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD_MOBILE_UA =
  'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const DESKTOP_CLASS_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

describe('detectOs', () => {
  it('reports an iPhone as iOS, not macOS', () => {
    // Every iOS user agent says "like Mac OS X"; this was reported as macOS.
    expect(detectOs(IPHONE_WKWEBVIEW, 5)).toBe('iOS');
  });

  it('reports an iPad as iPadOS, whether its user agent says iPad or Macintosh', () => {
    expect(detectOs(IPAD_MOBILE_UA, 5)).toBe('iPadOS');
    expect(detectOs(DESKTOP_CLASS_SAFARI, 5)).toBe('iPadOS');
  });

  it('still reports a Mac, which has no touch points, as macOS with its version', () => {
    expect(detectOs(DESKTOP_CLASS_SAFARI, 0)).toBe('macOS 10.15.7');
  });

  it('keeps Android, Windows and Linux as before', () => {
    expect(detectOs('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36', 5)).toBe('Android');
    expect(detectOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 0)).toBe('Windows 10/11 (x64)');
    expect(detectOs('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', 0)).toBe('Linux');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDiagnostics } from './foldDiagnostics';

const fold = vi.hoisted(() => vi.fn<() => FoldDiagnostics | null>());
vi.mock('./foldDiagnostics', () => ({ collectFoldDiagnostics: fold }));
vi.mock('./platform', () => ({ isDesktopTauri: () => false }));
vi.mock('./appVersion', () => ({ readAppVersion: async () => '9.8.7', getAppVersion: () => '9.8.7' }));
vi.mock('./compat', () => ({ getCompatEntries: () => [{ label: 'Storage', mode: 'native', using: 'sqlite', errorReason: null }] }));

import { collectDiagnostics, formatReport } from './diagnostics';
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
      applied: { confirmed: false, foldableClass: false, size: 'wide', posture: 'flat', crease: null, direction: 'ltr' },
      viewport: { layout: { width: 1200, height: 800 }, screen: { width: 1200, height: 800 }, devicePixelRatio: 1, coarsePointer: false,
        visual: { status: 'unsupported', width: null, height: null, offsetLeft: null, offsetTop: null, scale: null } },
    };
    fold.mockReturnValue(snapshot);
    const report = await collectDiagnostics();
    expect(report.display).toEqual(snapshot);
    expect(formatReport(report)).toContain('Display and posture (browser snapshot)');
  });
});

import { describe, expect, it } from 'vitest';
import { writingViewport } from './writingViewport';

function win(report: unknown, visual: unknown = null) {
  return { innerWidth: 600, innerHeight: 800, visualViewport: visual,
    OpenDraftKeyboard: { snapshot: () => JSON.stringify(report) } } as unknown as Window;
}
const shown = { version: 1, available: true, visible: true, width: 1500, height: 2000, bottom: 1200 };

describe('writing viewport', () => {
  it('converts window pixels without assuming screen density', () => {
    expect(writingViewport(win(shown))).toEqual({ left: 0, top: 0, width: 600, height: 480, keyboard: true });
  });
  it('intersects native and visual limits without subtracting twice', () => {
    expect(writingViewport(win(shown, { width: 550, height: 400, offsetLeft: 12, offsetTop: 50 })))
      .toEqual({ left: 12, top: 50, width: 550, height: 400, keyboard: true });
    expect(writingViewport(win(shown, { width: 600, height: 700, offsetLeft: 0, offsetTop: 50 })).height).toBe(480);
  });
  it('does not shrink an already resized WebView or a floating IME with no bottom inset', () => {
    expect(writingViewport(win({ ...shown, bottom: 2000 })).keyboard).toBe(false);
    expect(writingViewport(win({ ...shown, bottom: 2000 })).height).toBe(800);
  });
  it('ignores hidden stale geometry, unsupported, invalid and throwing bridges', () => {
    for (const report of [{ ...shown, visible: false }, { ...shown, available: false }, { ...shown, bottom: -1 },
      { ...shown, height: 0 }, { ...shown, bottom: '1200' }, { ...shown, bottom: 3000 }, { ...shown, version: 2 }, null]) {
      expect(writingViewport(win(report)).height).toBe(800);
    }
    expect(writingViewport({ innerWidth: 600, innerHeight: 800 } as Window).height).toBe(800);
    const w = win(null);
    Object.defineProperty(w, 'OpenDraftKeyboard', { get: () => { throw new Error('gone'); } });
    expect(writingViewport(w).height).toBe(800);
  });
  it('maps the native edge through pinch scale and visual panning', () => {
    expect(writingViewport(win(shown, { width: 300, height: 400, offsetLeft: 20, offsetTop: 100 })))
      .toEqual({ left: 20, top: 100, width: 300, height: 240, keyboard: true });
  });
});

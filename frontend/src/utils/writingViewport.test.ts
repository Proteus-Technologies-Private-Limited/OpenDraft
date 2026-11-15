import { describe, expect, it, vi } from 'vitest';
import { subscribeWritingViewport, writingViewport } from './writingViewport';

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

it('keeps header controls below the native status/cutout edge, even after IME dismissal', () => {
  expect(writingViewport(win({ ...shown, top: 70 })))
    .toEqual({ left: 0, top: 28, width: 600, height: 452, keyboard: true });
  expect(writingViewport(win({ ...shown, top: 70, visible: false })))
    .toEqual({ left: 0, top: 28, width: 600, height: 772, keyboard: false });
});

function liveWindow() {
  let report: unknown = shown;
  const snapshot = vi.fn(() => JSON.stringify(report));
  const viewport = Object.assign(new EventTarget(), { width: 600, height: 800, offsetTop: 0, offsetLeft: 0 });
  const target = Object.assign(new EventTarget(), { innerWidth: 600, innerHeight: 800,
    visualViewport: viewport, OpenDraftKeyboard: { snapshot } });
  return { win: target as unknown as Window, snapshot, viewport, setReport: (next: unknown) => { report = next; } };
}

it('shares one stable snapshot and one bridge read per event across subscribers and drag reads', () => {
  const w = liveWindow();
  const notify = vi.fn();
  const stopA = subscribeWritingViewport(notify, w.win);
  const stopB = subscribeWritingViewport(notify, w.win);
  const before = writingViewport(w.win);
  for (let i = 0; i < 100; i++) expect(writingViewport(w.win)).toBe(before);
  expect(w.snapshot).toHaveBeenCalledTimes(1);
  w.win.dispatchEvent(new Event('opendraft:keyboardchange'));
  expect(w.snapshot).toHaveBeenCalledTimes(2);
  expect(writingViewport(w.win)).toBe(before);
  expect(notify).not.toHaveBeenCalled();
  w.setReport({ ...shown, visible: false });
  w.win.dispatchEvent(new Event('opendraft:keyboardchange'));
  expect(w.snapshot).toHaveBeenCalledTimes(3);
  expect(notify).toHaveBeenCalledTimes(2);
  expect(writingViewport(w.win)).toMatchObject({ keyboard: false, height: 800 });
  stopA();
  w.viewport.height = 600;
  w.viewport.dispatchEvent(new Event('resize'));
  expect(w.snapshot).toHaveBeenCalledTimes(4);
  expect(notify).toHaveBeenCalledTimes(3);
  stopB();
});

it('refreshes on window resize and visual panning, and releases listeners after the last subscriber', () => {
  const w = liveWindow();
  const stop = subscribeWritingViewport(vi.fn(), w.win);
  w.viewport.offsetTop = 100;
  w.viewport.dispatchEvent(new Event('scroll'));
  expect(writingViewport(w.win)).toMatchObject({ top: 100, height: 480 });
  w.setReport({ ...shown, bottom: 900 });
  w.win.dispatchEvent(new Event('resize'));
  expect(writingViewport(w.win).height).toBe(360);
  const reads = w.snapshot.mock.calls.length;
  stop();
  w.win.dispatchEvent(new Event('opendraft:keyboardchange'));
  w.win.dispatchEvent(new Event('resize'));
  w.viewport.dispatchEvent(new Event('resize'));
  w.viewport.dispatchEvent(new Event('scroll'));
  expect(w.snapshot).toHaveBeenCalledTimes(reads);
  w.setReport({ ...shown, visible: false });
  expect(writingViewport(w.win).keyboard).toBe(false);
  expect(w.snapshot).toHaveBeenCalledTimes(reads + 1);
});

it('closes the render-to-subscribe gap and recovers from a malformed or throwing native report', () => {
  const w = liveWindow();
  expect(writingViewport(w.win).keyboard).toBe(true);
  w.setReport(null);
  const stop = subscribeWritingViewport(vi.fn(), w.win);
  expect(writingViewport(w.win).keyboard).toBe(false);
  w.snapshot.mockImplementationOnce(() => { throw new Error('WebView unavailable'); });
  w.win.dispatchEvent(new Event('opendraft:keyboardchange'));
  expect(writingViewport(w.win).height).toBe(800);
  w.setReport(shown);
  w.win.dispatchEvent(new Event('opendraft:keyboardchange'));
  expect(writingViewport(w.win)).toMatchObject({ keyboard: true, height: 480 });
  stop();
});

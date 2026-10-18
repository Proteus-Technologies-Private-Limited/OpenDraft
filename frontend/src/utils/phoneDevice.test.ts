import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isPhoneDevice, watchPhoneDevice } from './phoneDevice';

/** A device with this pointer and this screen, in CSS px. */
function device(pointer: 'coarse' | 'fine', width: number, height: number) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === `(pointer: ${pointer})` }));
  vi.stubGlobal('screen', { width, height });
  Object.defineProperty(window, 'screen', { value: { width, height }, configurable: true });
}

describe('isPhoneDevice', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Pixel 6, portrait', 411, 914],
    ['Pixel 6, landscape', 914, 411],
    ['iPhone 16 Pro Max', 440, 956],
    ['iPhone SE', 375, 667],
  ])('is true for a %s', (_name, w, h) => {
    device('coarse', w, h);
    expect(isPhoneDevice()).toBe(true);
  });

  it.each([
    ['iPad mini', 744, 1133],
    ['7" Android tablet', 600, 1024],
    ['iPad Air 11"', 820, 1180],
  ])('is false for an %s', (_name, w, h) => {
    device('coarse', w, h);
    expect(isPhoneDevice()).toBe(false);
  });

  it('is false for a mouse, however small the screen', () => {
    device('fine', 400, 800);
    expect(isPhoneDevice()).toBe(false);
  });

  it('is false when the platform cannot say', () => {
    vi.stubGlobal('matchMedia', () => { throw new Error('unsupported'); });
    expect(isPhoneDevice()).toBe(false);
  });
});

describe('watchPhoneDevice', () => {
  // The suite runs under node (vitest.config.ts); a bare EventTarget is all of
  // `window` the watcher needs.
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  it('reports a phone turning into a desktop on resize, and back', () => {
    device('coarse', 411, 914);
    const seen: boolean[] = [];
    const stop = watchPhoneDevice((p) => seen.push(p));

    // DevTools device mode switched off: a mouse and a desktop screen.
    device('fine', 1440, 900);
    window.dispatchEvent(new Event('resize'));
    device('coarse', 390, 844);
    window.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([false, true]);

    stop();
    device('fine', 1440, 900);
    window.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([false, true]);
  });

  it('stays quiet while the answer does not change', () => {
    device('coarse', 411, 914);
    const onChange = vi.fn();
    const stop = watchPhoneDevice(onChange);
    device('coarse', 914, 411); // turned on its side: still a phone
    window.dispatchEvent(new Event('orientationchange'));
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });
});

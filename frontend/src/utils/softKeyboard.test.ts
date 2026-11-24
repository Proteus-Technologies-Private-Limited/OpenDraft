import { describe, it, expect } from 'vitest';
import { focusWithoutKeyboard, nativeKeyboardTop, nativeKeyboardVisible } from './softKeyboard';

describe('focusWithoutKeyboard', () => {
  /** A text field reduced to what the helper touches. */
  function field(inputmode: string | null) {
    const attrs = new Map<string, string>();
    if (inputmode !== null) attrs.set('inputmode', inputmode);
    const listeners = new Map<string, () => void>();
    const modeAtFocus: (string | null)[] = [];
    return {
      attrs, listeners, modeAtFocus,
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => { attrs.set(name, value); },
      removeAttribute: (name: string) => { attrs.delete(name); },
      focus: () => { modeAtFocus.push(attrs.get('inputmode') ?? null); },
      addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
      removeEventListener: (type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
  }

  it('focuses with the keyboard held down, then gives the field its mode back on the next press', () => {
    const f = field('text');
    focusWithoutKeyboard(f);
    expect(f.modeAtFocus).toEqual(['none']);
    expect(f.getAttribute('inputmode')).toBe('none');
    f.listeners.get('pointerdown')!();
    expect(f.getAttribute('inputmode')).toBe('text');
    expect(f.listeners.size).toBe(0);
  });

  it('gives the mode back when the field loses focus instead', () => {
    const f = field('text');
    focusWithoutKeyboard(f);
    f.listeners.get('blur')!();
    expect(f.getAttribute('inputmode')).toBe('text');
    expect(f.listeners.size).toBe(0);
  });

  it('removes the attribute again when the field had none', () => {
    const f = field(null);
    focusWithoutKeyboard(f);
    expect(f.modeAtFocus).toEqual(['none']);
    f.listeners.get('pointerdown')!();
    expect(f.attrs.has('inputmode')).toBe(false);
  });

  it('just focuses a field that already keeps the keyboard down', () => {
    const f = field('none');
    focusWithoutKeyboard(f);
    expect(f.modeAtFocus).toEqual(['none']);
    expect(f.listeners.size).toBe(0);
  });
});

describe('nativeKeyboardVisible', () => {
  it('reads the Android report', () => {
    expect(nativeKeyboardVisible({ OpenDraftKeyboard: { isVisible: () => true } })).toBe(true);
    expect(nativeKeyboardVisible({ OpenDraftKeyboard: { isVisible: () => false } })).toBe(false);
  });

  it('is unknown without one', () => {
    expect(nativeKeyboardVisible({})).toBeNull();
    expect(nativeKeyboardVisible(undefined)).toBeNull();
    expect(nativeKeyboardVisible({ OpenDraftKeyboard: {} })).toBeNull();
  });

  it('is unknown when the report fails', () => {
    const failing = { OpenDraftKeyboard: { isVisible: () => { throw new Error('gone'); } } };
    const error = console.error;
    console.error = () => {};
    try {
      expect(nativeKeyboardVisible(failing)).toBeNull();
    } finally {
      console.error = error;
    }
  });
});

describe('nativeKeyboardTop', () => {
  const win = (report: unknown, innerWidth = 411) => ({
    innerWidth,
    OpenDraftKeyboard: { snapshot: () => (typeof report === 'string' ? report : JSON.stringify(report)) },
  });

  it('converts the keyboard edge from window pixels to CSS pixels', () => {
    // A 1080-pixel-wide WebView shown 411 CSS pixels wide; keyboard from 1220 down.
    const top = nativeKeyboardTop(win({ version: 1, available: true, visible: true, width: 1080, height: 2092, bottom: 1220 }));
    expect(top).toBeCloseTo(1220 * 411 / 1080);
  });

  it('is null while the keyboard is down', () => {
    expect(nativeKeyboardTop(win({ version: 1, available: true, visible: false, width: 1080, height: 2092, bottom: 2092 }))).toBeNull();
  });

  it('is null when the keyboard does not cover the page (a floating keyboard, another window)', () => {
    expect(nativeKeyboardTop(win({ version: 1, available: true, visible: true, width: 1080, height: 2092, bottom: 2092 }))).toBeNull();
  });

  it('is null without the Android bridge, or with a report it does not understand', () => {
    expect(nativeKeyboardTop({ innerWidth: 400 })).toBeNull();
    expect(nativeKeyboardTop(undefined)).toBeNull();
    expect(nativeKeyboardTop(win({ version: 2, available: true, visible: true, width: 1080, height: 2092, bottom: 1220 }))).toBeNull();
    expect(nativeKeyboardTop(win({ version: 1, available: false }))).toBeNull();
    expect(nativeKeyboardTop(win({ version: 1, available: true, visible: true, width: 0, height: 2092, bottom: 1220 }))).toBeNull();
  });

  it('logs and returns null when the report cannot be read', () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      expect(nativeKeyboardTop(win('not json'))).toBeNull();
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});

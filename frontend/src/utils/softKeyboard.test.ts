import { describe, it, expect } from 'vitest';
import { focusWithoutKeyboard, nativeKeyboardVisible } from './softKeyboard';

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

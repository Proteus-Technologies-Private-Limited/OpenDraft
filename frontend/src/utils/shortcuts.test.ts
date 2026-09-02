import { describe, it, expect } from 'vitest';
import {
  keyFromCode, parseShortcut, formatSpec, shortcutFromEvent, matchesShortcut, formatShortcut,
} from './shortcuts';

/** A key event, as much of one as the shortcut helpers read. */
function ev(code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}, key?: string) {
  return {
    key: key ?? code,
    code,
    metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
    ...mods,
  };
}

describe('keyFromCode', () => {
  it('reads letters, digits and function keys off the physical key', () => {
    expect(keyFromCode('KeyE')).toBe('e');
    expect(keyFromCode('Digit1')).toBe('1');
    expect(keyFromCode('F5')).toBe('F5');
  });

  it('names the keys that have names', () => {
    expect(keyFromCode('Enter')).toBe('Enter');
    expect(keyFromCode('NumpadEnter')).toBe('Enter');
    expect(keyFromCode('Slash')).toBe('/');
  });

  it('refuses a key it cannot name portably', () => {
    expect(keyFromCode('Lang1')).toBeNull();
  });
});

describe('shortcutFromEvent', () => {
  it('reads Option+E as Alt-e even though the Mac reports the key as Dead', () => {
    expect(shortcutFromEvent(ev('KeyE', { altKey: true }, 'Dead'), true)).toBe('Alt-e');
  });

  it('maps the platform modifier to Mod either way', () => {
    expect(shortcutFromEvent(ev('Enter', { metaKey: true }), true)).toBe('Mod-Enter');
    expect(shortcutFromEvent(ev('Enter', { ctrlKey: true }), false)).toBe('Mod-Enter');
  });

  it('keeps a Mac Control separate from Command', () => {
    expect(shortcutFromEvent(ev('Enter', { ctrlKey: true }), true)).toBe('Ctrl-Enter');
  });

  it('orders modifiers the same way whatever order they arrive in', () => {
    expect(shortcutFromEvent(ev('KeyE', { metaKey: true, altKey: true, shiftKey: true }), true))
      .toBe('Mod-Alt-Shift-e');
  });

  it('is not a shortcut without a modifier, or on a bare modifier', () => {
    expect(shortcutFromEvent(ev('KeyE'), true)).toBeNull();
    expect(shortcutFromEvent(ev('Enter', { shiftKey: true }), true)).toBeNull();
    expect(shortcutFromEvent(ev('AltLeft', { altKey: true }, 'Alt'), true)).toBeNull();
  });
});

describe('parseShortcut', () => {
  it('accepts the aliases a person might type', () => {
    expect(formatSpec(parseShortcut('cmd-option-e')!)).toBe('Mod-Alt-e');
  });

  it('rejects a spec with no modifier — it would eat ordinary typing', () => {
    expect(parseShortcut('Enter')).toBeNull();
    expect(parseShortcut('Shift-Enter')).toBeNull();
  });

  it('rejects nonsense', () => {
    expect(parseShortcut('')).toBeNull();
    expect(parseShortcut('Hyper-e')).toBeNull();
  });
});

describe('matchesShortcut', () => {
  it('fires on the shortcut and nothing else', () => {
    expect(matchesShortcut(ev('Enter', { altKey: true }), 'Alt-Enter', true)).toBe(true);
    expect(matchesShortcut(ev('Enter', { altKey: true, shiftKey: true }), 'Alt-Enter', true)).toBe(false);
    expect(matchesShortcut(ev('Enter', { metaKey: true }), 'Alt-Enter', true)).toBe(false);
    expect(matchesShortcut(ev('KeyE', { altKey: true }), 'Alt-Enter', true)).toBe(false);
  });

  it('is never fired by an empty setting', () => {
    expect(matchesShortcut(ev('Enter', { altKey: true }), '', true)).toBe(false);
  });
});

describe('formatShortcut', () => {
  it('writes a Mac shortcut in glyphs, in system order', () => {
    expect(formatShortcut('Alt-Enter', true)).toBe('⌥↩');
    expect(formatShortcut('Mod-Alt-Shift-e', true)).toBe('⌥⇧⌘E');
    expect(formatShortcut('Ctrl-Enter', true)).toBe('⌃↩');
  });

  it('writes it in words everywhere else', () => {
    expect(formatShortcut('Alt-Enter', false)).toBe('Alt+Enter');
    expect(formatShortcut('Mod-Shift-e', false)).toBe('Ctrl+Shift+E');
  });

  it('does not say Ctrl twice off a Mac', () => {
    expect(formatShortcut('Mod-Ctrl-e', false)).toBe('Ctrl+E');
  });

  it('is empty for a setting that is off', () => {
    expect(formatShortcut('', true)).toBe('');
  });
});

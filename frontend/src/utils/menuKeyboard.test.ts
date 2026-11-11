import { describe, expect, it } from 'vitest';
import { menuKeyShortcuts, menuSearchKey, menuSearchText } from './menuKeyboard';

describe('menu typeahead text', () => {
  it('keeps Indic vowel signs, viramas and joiners distinct', () => {
    for (const [base, marked] of [['क', 'कि'], ['ক', 'কি'], ['ક', 'કિ'], ['க', 'கி'], ['క', 'కి'], ['ക', 'കി'], ['ಕ', 'ಕಿ'], ['ਕ', 'ਕਿ'], ['କ', 'କି']]) {
      expect(menuSearchText(base)).not.toBe(menuSearchText(marked));
      expect(menuSearchText(marked).startsWith(menuSearchText(base))).toBe(true);
    }
    expect(menuSearchText('क्ष')).toBe('क्ष');
    expect(menuSearchText('क्‍ष')).toBe('क्‍ष');
    expect(menuSearchText('ि')).not.toBe('');
  });

  it('still folds Latin accents and canonical equivalents', () => {
    expect(menuSearchText('ÉDITION')).toBe('edition');
    expect(menuSearchText('E\u0301dition')).toBe('edition');
    expect(menuSearchText('Zażółć')).toBe('zazołc');
    expect(menuSearchText('éकि')).toBe('eकि');
  });

  it.each(['क', 'ि', 'कि', 'क्ष', '😀', 'é', 'E\u0301'])('accepts the printable key %s', key => {
    expect(menuSearchKey(key)).toBe(true);
  });

  it.each(['', ' ', '\n', '\u0000', 'Shift', 'Dead', 'ArrowRight', 'F10', 'ab'])('ignores the non-character key %s', key => {
    expect(menuSearchKey(key)).toBe(false);
  });
});

describe('announced menu shortcuts', () => {
  it.each([
    ['⌘S', 'Meta+S'], ['⇧⌘S', 'Shift+Meta+S'], ['⌃⌥⇧⌘A', 'Control+Alt+Shift+Meta+A'],
    ['Ctrl+S', 'Control+S'], ['⇧Ctrl+S', 'Shift+Control+S'], ['Ctrl+⇧A', 'Control+Shift+A'],
    ['Ctrl++', 'Control+plus'], ['Ctrl+−', 'Control+-'], ['⌥↩', 'Alt+Enter'],
    ['Ctrl+Alt+Enter', 'Control+Alt+Enter'], ['F7', 'F7'], ['⇧F7', 'Shift+F7'],
    ['Ctrl+Down', 'Control+ArrowDown'], ['Alt+Space', 'Alt+Space'],
  ])('converts %s to %s', (display, aria) => {
    expect(menuKeyShortcuts(display)).toBe(aria);
  });

  it.each([undefined, '', 'not a shortcut', 'Ctrl+', 'Ctrl+K Ctrl+C'])('omits unsupported notation %s', display => {
    expect(menuKeyShortcuts(display)).toBeUndefined();
  });
});

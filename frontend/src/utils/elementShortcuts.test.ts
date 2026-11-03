import { describe, it, expect } from 'vitest';
import { ELEMENT_SHORTCUT_TYPES, elementShortcutSpec } from './elementShortcuts';

describe('elementShortcuts', () => {
  it('maps the eight elements to Mod-1 … Mod-8 in order', () => {
    expect(ELEMENT_SHORTCUT_TYPES.map((id) => [id, elementShortcutSpec(id)])).toEqual([
      ['sceneHeading', 'Mod-1'],
      ['action', 'Mod-2'],
      ['character', 'Mod-3'],
      ['dialogue', 'Mod-4'],
      ['parenthetical', 'Mod-5'],
      ['transition', 'Mod-6'],
      ['general', 'Mod-7'],
      ['shot', 'Mod-8'],
    ]);
  });

  it('gives no shortcut to elements outside the eight', () => {
    expect(elementShortcutSpec('lyrics')).toBeNull();
    expect(elementShortcutSpec('newAct')).toBeNull();
    expect(elementShortcutSpec('notAnElement')).toBeNull();
  });
});

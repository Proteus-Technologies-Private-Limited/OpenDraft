import { describe, it, expect } from 'vitest';
import { FONT_REGISTRY, FONT_CATEGORIES, getFontsByCategory } from './fonts';

describe('font registry', () => {
  // These used to appear in the picker only after importing a document that
  // used them (Toolbar scrapes unknown font names into a "Document Fonts"
  // group). They must be selectable outright.
  const alwaysAvailable = [
    'Courier Prime', 'Courier New', 'Arial',
    'Times New Roman', 'Georgia', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
  ];

  it.each(alwaysAvailable)('lists %s', (name) => {
    expect(FONT_REGISTRY.some((f) => f.name === name)).toBe(true);
  });

  it('marks OS-provided faces as system fonts so no webfont load is attempted', () => {
    for (const name of alwaysAvailable) {
      const entry = FONT_REGISTRY.find((f) => f.name === name);
      expect(entry, name).toBeDefined();
      if (name === 'Courier Prime') continue; // bundled with the app
      expect(entry!.source, name).toBe('system');
    }
  });

  it('has no duplicate font names', () => {
    const names = FONT_REGISTRY.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('files every font under a declared category', () => {
    for (const font of FONT_REGISTRY) {
      expect(FONT_CATEGORIES, font.name).toContain(font.category);
    }
  });

  it('groups every registry entry — none dropped by getFontsByCategory', () => {
    const grouped = Object.values(getFontsByCategory()).flat();
    expect(grouped).toHaveLength(FONT_REGISTRY.length);
  });
});

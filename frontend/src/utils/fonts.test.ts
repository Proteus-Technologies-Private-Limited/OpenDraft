import { describe, it, expect, afterEach } from 'vitest';
import {
  FONT_REGISTRY, FONT_CATEGORIES, getFontsByCategory, fontStack, genericFor, findFont,
  getAllFonts, setDynamicFonts, COURIER_FONTS,
} from './fonts';

describe('font registry', () => {
  // These used to appear in the picker only after importing a document that
  // used them (the Toolbar scrapes unknown font names into a "From This Document"
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

describe('font library breadth', () => {
  // Issue #84: the picker used to offer 31 fonts, most of them Noto faces for
  // scripts other than Latin. A writer wanting a serif for a title page had to
  // import a document that already used one.
  const shouldHave = [
    // Typewriter faces beyond Courier
    'Special Elite', 'Cutive Mono',
    // Serif
    'EB Garamond', 'Libre Baskerville', 'Merriweather', 'Playfair Display',
    // Sans serif
    'Open Sans', 'Lato', 'Montserrat', 'Inter',
    // Monospace
    'Roboto Mono', 'IBM Plex Mono', 'JetBrains Mono',
    // Display, for title pages
    'Bebas Neue', 'Cinzel', 'Abril Fatface',
    // Handwriting
    'Caveat', 'Permanent Marker',
  ];

  it.each(shouldHave)('offers %s', (name) => {
    expect(findFont(name)).toBeDefined();
  });

  it('offers a substantial library rather than a token one', () => {
    expect(FONT_REGISTRY.length).toBeGreaterThan(120);
  });

  it.each(['Serif', 'Sans Serif', 'Monospace', 'Display & Titles', 'Handwriting', 'Typewriter'])(
    'fills the %s group',
    (category) => {
      expect(getFontsByCategory()[category].length).toBeGreaterThanOrEqual(5);
    },
  );

  it('keeps every Courier the importers treat as interchangeable', () => {
    for (const name of COURIER_FONTS) {
      expect(genericFor(name), name).toBe('monospace');
    }
  });

  it('finds a font whatever case the document wrote it in', () => {
    expect(findFont('courier prime')?.name).toBe('Courier Prime');
    expect(findFont('  Georgia  ')?.name).toBe('Georgia');
    expect(findFont('')).toBeUndefined();
  });
});

describe('fontStack', () => {
  // What carries a font choice to a machine that hasn't got the font: the name
  // first, then fallbacks of the same kind — never Courier for everything.
  it('falls back to Courier for a screenplay face', () => {
    expect(fontStack('Courier Prime')).toBe("'Courier Prime', 'Courier New', Courier, monospace");
  });

  it('falls back to a serif for a serif, not to Courier', () => {
    expect(fontStack('Playfair Display')).toBe("'Playfair Display', 'Times New Roman', Times, serif");
  });

  it('falls back to a sans for a sans', () => {
    expect(fontStack('Bebas Neue')).toBe("'Bebas Neue', Arial, Helvetica, sans-serif");
  });

  it('falls back to a script face for handwriting', () => {
    expect(fontStack('Caveat')).toContain('cursive');
  });

  it('treats an unknown family as a screenplay font, as OpenDraft always has', () => {
    expect(fontStack('Some Unknown Face')).toBe("'Some Unknown Face', 'Courier Prime', 'Courier New', Courier, monospace");
  });

  it('classifies an unknown name by what it looks like', () => {
    expect(genericFor('Century Schoolbook')).toBe('serif');
    expect(genericFor('Helvetica Neue LT Pro')).toBe('sans-serif');
    expect(genericFor('Prestige Elite Std')).toBe('monospace');
    expect(genericFor('Lucida Handwriting')).toBe('cursive');
  });

  it('gives the document font a stack when nothing is set', () => {
    expect(fontStack('')).toBe("'Courier Prime', 'Courier New', Courier, monospace");
    expect(fontStack(null)).toContain('monospace');
  });

  it('is idempotent, so an HTML round trip cannot grow the stack', () => {
    const once = fontStack('Georgia');
    expect(fontStack(once)).toBe(once);
  });

  it('keeps a pasted stack that already ends in a generic', () => {
    expect(fontStack('Georgia, serif')).toBe('Georgia, serif');
  });

  it('completes a pasted stack that ends in a real family', () => {
    expect(fontStack('Helvetica Neue, Arial')).toBe("Helvetica Neue, Arial, Arial, Helvetica, sans-serif");
  });

  it('quotes a family name whose punctuation a bare CSS ident could not hold', () => {
    // An installed font may be called anything at all; its name still has to
    // come out as a value the browser reads as one family.
    expect(fontStack("Hank's Typewriter")).toContain('"Hank\'s Typewriter"');
    expect(fontStack('Réunion Display')).toContain('"Réunion Display"');
    expect(fontStack('Press Start 2P')).toContain("'Press Start 2P'");
  });
});

describe('fonts discovered on this device', () => {
  afterEach(() => {
    setDynamicFonts('custom', []);
    setDynamicFonts('device', []);
  });

  it('puts a writer\'s installed font at the top of the list, and finds it', () => {
    setDynamicFonts('custom', [{
      name: 'Chancery Deco', category: 'Custom Fonts', scripts: ['latin'],
      source: 'custom', direction: 'ltr', generic: 'cursive',
    }]);
    expect(getAllFonts()[0].name).toBe('Chancery Deco');
    expect(findFont('chancery deco')?.source).toBe('custom');
    // And the fallback follows the font's own kind, not a guess from its name.
    expect(fontStack('Chancery Deco')).toContain('cursive');
  });

  it('groups device fonts under their own heading', () => {
    setDynamicFonts('device', [{
      name: 'Zapfino', category: 'On This Device', scripts: ['latin'],
      source: 'device', direction: 'ltr', generic: 'cursive',
    }]);
    expect(getFontsByCategory()['On This Device'].map((f) => f.name)).toEqual(['Zapfino']);
  });
});

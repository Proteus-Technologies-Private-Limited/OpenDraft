import { describe, it, expect } from 'vitest';
import { isFontInstalled, canQueryLocalFonts, detectDeviceFonts, addNamedFont, PROBE_CANDIDATES } from './deviceFonts';
import { getAllFonts, setDynamicFonts } from './fonts';

describe('device font detection', () => {
  // jsdom cannot measure text, and neither can a WebView with canvas disabled.
  // The dangerous failure there is reporting every font as missing and greying
  // out the whole picker, so the unmeasurable case answers "installed".
  it('assumes a font is present when the browser cannot measure', () => {
    expect(isFontInstalled('Times New Roman')).toBe(true);
    expect(isFontInstalled('A Font Nobody Has')).toBe(true);
  });

  it('reports nothing installed for an empty name', () => {
    expect(isFontInstalled('   ')).toBe(false);
  });

  it('says so when the browser cannot list installed fonts', () => {
    expect(canQueryLocalFonts()).toBe(false);
  });

  it('claims to have found nothing when it cannot measure', () => {
    // The other half of the same decision: assuming a named font is present is
    // safe, but announcing 180 fonts the machine may not have is not.
    setDynamicFonts('device', []);
    const before = getAllFonts().length;
    expect(detectDeviceFonts()).toEqual([]);
    expect(getAllFonts()).toHaveLength(before);
  });

  it('runs once — the second call does not re-probe', () => {
    expect(detectDeviceFonts()).toEqual([]);
  });
});

describe('naming a font the platform will not enumerate', () => {
  // iPadOS and Android have no queryLocalFonts, so a font installed through a
  // font-manager app or a configuration profile cannot be discovered — only
  // named. Under a test runner nothing is measurable, so every name is
  // accepted, which is the same forgiving answer isFontInstalled gives.
  it('adds a font this device can render, and remembers it', () => {
    setDynamicFonts('device', []);
    expect(addNamedFont('Avenir Next Condensed')).toBe(true);
    expect(getAllFonts().some((f) => f.name === 'Avenir Next Condensed' && f.source === 'device')).toBe(true);
    expect(JSON.parse(localStorage.getItem('opendraft:device-fonts:named') || '[]'))
      .toContain('Avenir Next Condensed');
  });

  it('refuses an empty name rather than adding a blank row', () => {
    expect(addNamedFont('   ')).toBe(false);
  });

  it('does not duplicate a font the library already has', () => {
    setDynamicFonts('device', []);
    expect(addNamedFont('Georgia')).toBe(true);
    expect(getAllFonts().filter((f) => f.name === 'Georgia')).toHaveLength(1);
  });
});

describe('the list of faces worth probing', () => {
  it('names each font once — a duplicate shows up twice in the picker', () => {
    // "Papyrus" was in both the macOS and the Windows block, and duly appeared
    // twice under "On This Device" on an iPad.
    const seen = new Map<string, number>();
    for (const name of PROBE_CANDIDATES) {
      const key = name.toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect([...seen].filter(([, n]) => n > 1).map(([name]) => name)).toEqual([]);
  });

  it('covers the faces iPadOS ships, which are all an iPad writer has', () => {
    const ios = ['Chalkboard SE', 'Charter', 'Galvji', 'Party LET', 'Avenir Next Condensed',
      'PingFang SC', 'Kohinoor Devanagari', 'Tamil Sangam MN', 'Hiragino Sans', 'Geeza Pro'];
    for (const name of ios) expect(PROBE_CANDIDATES, name).toContain(name);
  });
});

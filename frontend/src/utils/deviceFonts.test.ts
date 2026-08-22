import { describe, it, expect } from 'vitest';
import { isFontInstalled, canQueryLocalFonts, detectDeviceFonts } from './deviceFonts';
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

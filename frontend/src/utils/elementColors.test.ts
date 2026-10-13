/**
 * Element colours for the PDF: which template rules count, and what they turn into.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildElementColors, normalizeHex } from './elementColors';

describe('normalizeHex', () => {
  it('expands short forms and lower-cases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#1A2B3C')).toBe('#1a2b3c');
  });
  it('rejects anything that is not a hex colour', () => {
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
  });
});

describe('buildElementColors', () => {
  it('keeps enabled elements that set a colour', () => {
    const out = buildElementColors({
      rules: {
        action: { enabled: true, textColor: '#112233', backgroundColor: null },
        sceneHeading: { enabled: true, textColor: null, backgroundColor: '#FFEECC' },
      },
    });
    expect(out.action).toEqual({ text: '#112233', background: null });
    expect(out.sceneHeading).toEqual({ text: null, background: '#ffeecc' });
  });
  it('skips disabled elements and elements with no colour', () => {
    const out = buildElementColors({
      rules: {
        dialogue: { enabled: false, textColor: '#ffffff' },
        general: { enabled: true, textColor: null, backgroundColor: null },
      },
    });
    expect(out).toEqual({});
  });
  it('copes with no template', () => {
    expect(buildElementColors(null)).toEqual({});
    expect(buildElementColors({})).toEqual({});
  });
});

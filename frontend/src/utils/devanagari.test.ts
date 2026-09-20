/**
 * Devanagari, put into the order a renderer that does not shape will draw it.
 *
 * The strings here are written as escapes as well as glyphs, because the whole
 * point is the difference between storage order and drawing order — and an
 * editor showing this file shapes both of them back into the same picture.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { reorderDevanagari, hasDevanagari } from './devanagari';

/** Names for the code points the assertions turn on. */
const HA = 'ह';      // ह
const NA = 'न';      // न
const DA = 'द';      // द
const SA = 'स';      // स
const THA = 'थ';     // थ
const TA = 'त';      // त
const I = 'ि';       // ि  the vowel sign that is drawn before its consonant
const II = 'ी';      // ी
const VIRAMA = '्';  // ्
const NUKTA = '़';   // ़
const ANUSVARA = 'ं'; // ं
const ZWNJ = '‌';
const ZWJ = '‍';

describe('hasDevanagari', () => {
  it('is false for anything outside the block', () => {
    for (const text of ['INT. LIBRARY - DAY', 'Привет', '', 'Café']) {
      expect(hasDevanagari(text), text).toBe(false);
    }
  });

  it('is true for a single Devanagari character anywhere in the string', () => {
    expect(hasDevanagari('a क b')).toBe(true);
    expect(hasDevanagari('हिन्दी')).toBe(true);
    expect(hasDevanagari('कहा।')).toBe(true); // the danda is in the block too
  });
});

describe('reorderDevanagari', () => {
  it('returns text with no Devanagari in it unchanged, and identically', () => {
    for (const text of ['INT. LIBRARY - DAY', 'Привет', '']) {
      expect(reorderDevanagari(text)).toBe(text);
    }
  });

  it('draws the vowel sign i before the consonant it is stored after', () => {
    expect(reorderDevanagari(HA + I)).toBe(I + HA);
  });

  it('moves it ahead of the whole conjunct, not just the last consonant', () => {
    // स्थि — the sign belongs to स्थ and is drawn to the left of the स.
    expect(reorderDevanagari(SA + VIRAMA + THA + I)).toBe(I + SA + VIRAMA + THA);
  });

  it('reorders each syllable of a word on its own', () => {
    // हिन्दी: ह ि | न ् द ी  ->  ि ह | न ् द ी
    const stored = HA + I + NA + VIRAMA + DA + II;
    expect(reorderDevanagari(stored)).toBe(I + HA + NA + VIRAMA + DA + II);
  });

  it('carries the nukta with the consonant it modifies', () => {
    // फ़ि — the dot belongs to the फ, and the sign is drawn before both.
    const stored = 'फ' + NUKTA + I;
    expect(reorderDevanagari(stored)).toBe(I + 'फ' + NUKTA);
  });

  it('leaves the signs that are already in drawing order where they are', () => {
    // ी sits after its consonant, ं above it; neither moves.
    expect(reorderDevanagari(DA + II)).toBe(DA + II);
    expect(reorderDevanagari(HA + ANUSVARA)).toBe(HA + ANUSVARA);
    expect(reorderDevanagari(NA + VIRAMA + TA + 'े')).toBe(NA + VIRAMA + TA + 'े');
  });

  it('keeps a joiner inside the syllable it is spelling', () => {
    for (const joiner of [ZWJ, ZWNJ]) {
      expect(reorderDevanagari(NA + VIRAMA + joiner + DA + I))
        .toBe(I + NA + VIRAMA + joiner + DA);
    }
  });

  it('keeps a trailing halant with its syllable', () => {
    expect(reorderDevanagari(HA + I + NA + VIRAMA)).toBe(I + HA + NA + VIRAMA);
  });

  it('leaves Latin, spaces and punctuation between words alone', () => {
    const stored = `EXT. ${HA + I}${NA}, ${DA + I}`;
    expect(reorderDevanagari(stored)).toBe(`EXT. ${I + HA}${NA}, ${I + DA}`);
  });

  it('does not lose a vowel sign with no consonant to attach to', () => {
    // Malformed, but a writer can type it; it must survive rather than vanish.
    expect(reorderDevanagari(`a${I}b`)).toBe(`a${I}b`);
  });

  it('is a permutation — every character comes out, exactly once', () => {
    for (const text of [
      'हिन्दी फ़िल्म नमस्ते कर्म',
      'मैं CUT TO: लिख रहा हूँ।',
      'स्थिति, प्यार और क्या?',
      'एक दो तीन ४५६',
    ]) {
      const sorted = (s: string) => [...s].sort().join('');
      expect(sorted(reorderDevanagari(text)), text).toBe(sorted(text));
      expect(reorderDevanagari(text).length, text).toBe(text.length);
    }
  });

  it('leaves text it has already reordered alone the second time', () => {
    // Drawing order has the sign before the consonant, where nothing matches a
    // syllable that needs moving — so the pass is safe to repeat.
    const once = reorderDevanagari('हिन्दी फ़िल्म');
    expect(reorderDevanagari(once)).toBe(once);
  });
});

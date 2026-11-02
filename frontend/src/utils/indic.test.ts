/**
 * The reordering, across the scripts that share it.
 *
 * Devanagari has its own file — it is where the algorithm was written and its
 * tests read it closely. These cover what generalising it brought in: the
 * scripts whose pre-base sign is a different code point, the ones that have
 * none at all, and the vowels written as one character and drawn as two.
 *
 * Written in escapes rather than in the scripts themselves. A reordering is
 * invisible in rendered text — a correct result and a wrong one look identical
 * in an editor that shapes them — so the only honest way to assert on it is
 * code point by code point.
 */
import { describe, it, expect } from 'vitest';
import {
  BENGALI, DEVANAGARI, KANNADA, MALAYALAM, SINHALA, TAMIL, TELUGU,
  reorderIndic, hasScript,
} from './indic';

/** A string as its code points, which is the only readable form here. */
const points = (text: string): string[] => [...text].map(
  (char) => char.codePointAt(0)!.toString(16).padStart(4, '0'),
);

describe('pre-base vowel signs move ahead of their consonant', () => {
  it('moves the Tamil ெ, which is stored after its consonant', () => {
    // க (0b95) + ெ (0bc6) is drawn ெ then க.
    expect(points(reorderIndic('கெ', TAMIL))).toEqual(['0bc6', '0b95']);
  });

  it('moves the Bengali ে', () => {
    expect(points(reorderIndic('কে', BENGALI))).toEqual(['09c7', '0995']);
  });

  it('moves the Malayalam െ', () => {
    expect(points(reorderIndic('കെ', MALAYALAM))).toEqual(['0d46', '0d15']);
  });

  it('moves the Sinhala ෙ', () => {
    expect(points(reorderIndic('කෙ', SINHALA))).toEqual(['0dd9', '0d9a']);
  });

  it('moves the sign ahead of a whole cluster, not just the letter before it', () => {
    // க + ் + ஷ + ெ — the vowel belongs to the conjunct, so it goes to the front
    // of all of it rather than sitting between the two consonants.
    expect(points(reorderIndic('க்ஷெ', TAMIL)))
      .toEqual(['0bc6', '0b95', '0bcd', '0bb7']);
  });
});

describe('Tamil, whose pulli ends a syllable rather than joining one', () => {
  // The Play Store report: எப்போது exported as எபேபாது. Tamil writes its
  // virama as a visible dot and forms no conjuncts, so in ப்போ the vowel sign
  // belongs to the second ப alone.
  it('moves the sign ahead of the last consonant only', () => {
    // எ ப ் ப ே ா த ு — ொ/ோ split, ே before the second ப.
    expect(points(reorderIndic('எப்போது', TAMIL)))
      .toEqual(['0b8e', '0baa', '0bcd', '0bc7', '0baa', '0bbe', '0ba4', '0bc1']);
  });

  it('does the same for ை after a doubled consonant', () => {
    // உன்னை: ை goes before the second ன, not before ன்ன.
    expect(points(reorderIndic('உன்னை', TAMIL)))
      .toEqual(['0b89', '0ba9', '0bcd', '0bc8', '0ba9']);
  });

  it('still keeps க்ஷ together, the one conjunct Tamil has', () => {
    expect(points(reorderIndic('க்ஷொ', TAMIL)))
      .toEqual(['0bc6', '0b95', '0bcd', '0bb7', '0bbe']);
  });

  it('leaves Devanagari clusters joined as they were', () => {
    // स्थि: the ि belongs to the whole of स्थ, which is what makes Tamil the
    // exception rather than the rule.
    expect(points(reorderIndic('स्थि', DEVANAGARI)))
      .toEqual(['093f', '0938', '094d', '0925']);
  });
});

describe('scripts whose signs are never drawn to the left', () => {
  it('leaves Telugu exactly as it was', () => {
    const text = 'కెమ';
    expect(reorderIndic(text, TELUGU)).toBe(text);
  });

  it('leaves Kannada exactly as it was', () => {
    const text = 'ಕಿಮ';
    expect(reorderIndic(text, KANNADA)).toBe(text);
  });
});

describe('vowels written as one character and drawn as two', () => {
  it('splits the Tamil ொ and moves only its left half', () => {
    // ொ (0bca) is ெ (0bc6) and ா (0bbe): the ெ is drawn before the consonant
    // and the ா after it, so the one character becomes three.
    expect(points(reorderIndic('கொ', TAMIL)))
      .toEqual(['0bc6', '0b95', '0bbe']);
  });

  it('splits the Bengali ো', () => {
    expect(points(reorderIndic('কো', BENGALI)))
      .toEqual(['09c7', '0995', '09be']);
  });

  it('splits the Malayalam ൌ, whose second half is a different sign', () => {
    expect(points(reorderIndic('കൌ', MALAYALAM)))
      .toEqual(['0d46', '0d15', '0d57']);
  });

  it('splits the Sinhala ෞ into three parts and keeps the order of the last two', () => {
    expect(points(reorderIndic('කෝ', SINHALA)))
      .toEqual(['0dd9', '0d9a', '0dcf', '0dca']);
  });
});

describe('text the script has no claim on', () => {
  it('returns a Latin string identical, and the same object', () => {
    const text = 'INT. LIBRARY - DAY';
    expect(reorderIndic(text, TAMIL)).toBe(text);
  });

  it('leaves Latin words inside a Tamil line where they are', () => {
    const mixed = `OK கெ OK`;
    expect(points(reorderIndic(mixed, TAMIL)))
      .toEqual(['004f', '004b', '0020', '0bc6', '0b95', '0020', '004f', '004b']);
  });

  it('does not touch another script that happens to be in the same string', () => {
    // Bengali's reordering has nothing to say about Tamil, and must not take
    // the Tamil sign with it.
    const text = 'கெ';
    expect(reorderIndic(text, BENGALI)).toBe(text);
  });

  it('leaves a stray sign with no consonant to attach to alone', () => {
    expect(points(reorderIndic('ெ', TAMIL))).toEqual(['0bc6']);
  });
});

describe('hasScript', () => {
  it('sees its own block and not a neighbouring one', () => {
    expect(hasScript('க', TAMIL)).toBe(true);
    expect(hasScript('ক', TAMIL)).toBe(false);
    expect(hasScript('Latin only', TAMIL)).toBe(false);
  });
});

describe('what reordering must never do', () => {
  it('keeps every character, only moving them', () => {
    // The two-part vowels are the one exception — they are split — so this is
    // asserted on a script without them.
    const text = 'கெல் கேள்';
    const before = [...text].sort().join('');
    const after = [...reorderIndic(text, TAMIL)].sort().join('');
    expect(after).toBe(before);
  });
});

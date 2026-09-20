/**
 * Putting an Indic syllable into the order it is drawn in.
 *
 * Every Brahmic script is stored in the order it is spoken and drawn in a
 * different one. The vowel sign is typed and stored *after* the consonant it
 * belongs to and painted *before* it: हिन्दी is held as ह ि न ् द ी, தமிழ் as
 * த ம ி ழ ். Every engine that lays these scripts out — the browser behind the
 * editor, Word, a PDF reader showing a file Acrobat made — runs the font's
 * OpenType rules and moves the sign. jsPDF runs none: it looks each character
 * up in the font's `cmap` and paints it where it came, so the sign lands after
 * the consonant with its hook arcing over whatever is next. हिन्दी reads as
 * हनि्दी. In a language where the vowel is the word that is not a typographic
 * nicety.
 *
 * So the one reordering these scripts cannot be read without is done here, on
 * the string, just before it is drawn. The scripts differ only in where their
 * letters sit in Unicode, so one engine walks all of them and `SCRIPTS` holds
 * what is different.
 *
 * What this deliberately does not do is shape. Conjuncts (क् + ष as क्ष) and
 * reph (the र् of कर्म, drawn as a stroke above the syllable) are substitutions,
 * not reorderings: the glyphs exist in the font but there is no way to ask
 * jsPDF for them, since it addresses glyphs only through `cmap` and a conjunct
 * has no character of its own. Those come out as an explicit halant — क्ष, कर्म
 * — which is how these scripts are written when a conjunct is being spelled
 * out, and reads correctly even though a typesetter would not have set it that
 * way. Closing that gap means shaping before drawing and addressing glyphs by
 * index; see `public/fonts/README.md`.
 */

/** A half-open range of code points, inclusive at both ends. */
type Range = readonly [number, number];

function inRanges(codePoint: number, ranges: readonly Range[]): boolean {
  for (const [lo, hi] of ranges) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/**
 * One script's furniture.
 *
 * The ranges are written out rather than derived from the block offset. The
 * Brahmic blocks mostly follow the same ISCII-derived layout, which makes
 * `block + 0x15` look like a safe way to find the first consonant — until
 * Tamil, which has a third of the consonants, or Sinhala, which is arranged
 * differently altogether. Explicit ranges can be checked against the code
 * chart; an offset cannot.
 */
export interface IndicScript {
  /** What this script is called, for the face that draws it. */
  name: string;
  /** The Unicode block. Text outside it is left exactly where it is. */
  block: Range;
  /** The letters that carry a syllable. */
  consonants: readonly Range[];
  /** Letters that open a syllable without being consonants — the vowels. */
  standalone: readonly Range[];
  /** Dependent vowel signs. The virama is not one. */
  matras: readonly Range[];
  /** Anusvara, visarga, candrabindu and friends — they ride the syllable. */
  signs: readonly Range[];
  /** The halant/virama that strings consonants into a cluster. */
  virama: number;
  /** The dot that makes क into क़, where the script has one. */
  nukta?: number;
  /** The signs painted to the left of the syllable they belong to. */
  preBase: readonly number[];
  /**
   * Vowel signs that are written as one character and drawn as two, one of
   * them before the syllable. They have to be taken apart before the pre-base
   * half can be moved — ொ is ெ and ா, and only the ெ goes to the front.
   */
  twoPart?: Readonly<Record<number, readonly number[]>>;
}

const ZWNJ = 0x200c; // asks for the halant to stay visible
const ZWJ = 0x200d;  // asks for the half form

export const DEVANAGARI: IndicScript = {
  name: 'Devanagari',
  block: [0x0900, 0x097f],
  // क–ह, the precomposed nukta forms क़–य़, and the later additions.
  consonants: [[0x0915, 0x0939], [0x0958, 0x095f], [0x0978, 0x097f]],
  standalone: [[0x0904, 0x0914], [0x093d, 0x093d], [0x0950, 0x0950]],
  matras: [[0x093a, 0x093b], [0x093e, 0x094c], [0x094e, 0x094f],
    [0x0955, 0x0957], [0x0962, 0x0963]],
  signs: [[0x0900, 0x0903], [0x0951, 0x0954], [0x093c, 0x093c]],
  virama: 0x094d,
  nukta: 0x093c,
  // ि, which is everywhere, and ॎ, which is not.
  preBase: [0x093f, 0x094e],
};

export const BENGALI: IndicScript = {
  name: 'Bengali',
  block: [0x0980, 0x09ff],
  consonants: [[0x0995, 0x09b9], [0x09dc, 0x09df], [0x09f0, 0x09f1]],
  standalone: [[0x0985, 0x098c], [0x098f, 0x0990], [0x0993, 0x0994]],
  matras: [[0x09be, 0x09cc], [0x09d7, 0x09d7], [0x09e2, 0x09e3]],
  signs: [[0x0981, 0x0983], [0x09bc, 0x09bc]],
  virama: 0x09cd,
  nukta: 0x09bc,
  preBase: [0x09bf, 0x09c7, 0x09c8],
  twoPart: { 0x09cb: [0x09c7, 0x09be], 0x09cc: [0x09c7, 0x09d7] },
};

export const GURMUKHI: IndicScript = {
  name: 'Gurmukhi',
  block: [0x0a00, 0x0a7f],
  consonants: [[0x0a15, 0x0a39], [0x0a59, 0x0a5c], [0x0a5e, 0x0a5e]],
  standalone: [[0x0a05, 0x0a0a], [0x0a0f, 0x0a10], [0x0a13, 0x0a14]],
  matras: [[0x0a3e, 0x0a4c]],
  signs: [[0x0a01, 0x0a03], [0x0a3c, 0x0a3c], [0x0a70, 0x0a71]],
  virama: 0x0a4d,
  nukta: 0x0a3c,
  preBase: [0x0a3f],
};

export const GUJARATI: IndicScript = {
  name: 'Gujarati',
  block: [0x0a80, 0x0aff],
  consonants: [[0x0a95, 0x0ab9]],
  standalone: [[0x0a85, 0x0a8d], [0x0a8f, 0x0a91], [0x0a93, 0x0a94],
    [0x0abd, 0x0abd]],
  matras: [[0x0abe, 0x0acc], [0x0ae2, 0x0ae3]],
  signs: [[0x0a81, 0x0a83], [0x0abc, 0x0abc]],
  virama: 0x0acd,
  nukta: 0x0abc,
  preBase: [0x0abf],
};

export const ORIYA: IndicScript = {
  name: 'Odia',
  block: [0x0b00, 0x0b7f],
  consonants: [[0x0b15, 0x0b39], [0x0b5c, 0x0b5d], [0x0b71, 0x0b71]],
  standalone: [[0x0b05, 0x0b0c], [0x0b0f, 0x0b10], [0x0b13, 0x0b14],
    [0x0b3d, 0x0b3d]],
  matras: [[0x0b3e, 0x0b4c], [0x0b55, 0x0b57], [0x0b62, 0x0b63]],
  signs: [[0x0b01, 0x0b03], [0x0b3c, 0x0b3c]],
  virama: 0x0b4d,
  nukta: 0x0b3c,
  preBase: [0x0b47],
  twoPart: { 0x0b4b: [0x0b47, 0x0b3e], 0x0b4c: [0x0b47, 0x0b57] },
};

export const TAMIL: IndicScript = {
  name: 'Tamil',
  block: [0x0b80, 0x0bff],
  consonants: [[0x0b95, 0x0bb9]],
  standalone: [[0x0b85, 0x0b8a], [0x0b8e, 0x0b90], [0x0b92, 0x0b94]],
  matras: [[0x0bbe, 0x0bcc], [0x0bd7, 0x0bd7]],
  signs: [[0x0b82, 0x0b83]],
  virama: 0x0bcd,
  preBase: [0x0bc6, 0x0bc7, 0x0bc8],
  twoPart: {
    0x0bca: [0x0bc6, 0x0bbe],
    0x0bcb: [0x0bc7, 0x0bbe],
    0x0bcc: [0x0bc6, 0x0bd7],
  },
};

export const TELUGU: IndicScript = {
  name: 'Telugu',
  block: [0x0c00, 0x0c7f],
  consonants: [[0x0c15, 0x0c39], [0x0c58, 0x0c5a]],
  standalone: [[0x0c05, 0x0c0c], [0x0c0e, 0x0c10], [0x0c12, 0x0c14],
    [0x0c3d, 0x0c3d]],
  matras: [[0x0c3e, 0x0c4c], [0x0c55, 0x0c56], [0x0c62, 0x0c63]],
  signs: [[0x0c00, 0x0c04]],
  virama: 0x0c4d,
  // Telugu hangs its vowel signs above and below the letter; none is drawn to
  // the left of it, so nothing here ever moves.  The script is in the table
  // for its face and its cluster walk, not for a reordering.
  preBase: [],
};

export const KANNADA: IndicScript = {
  name: 'Kannada',
  block: [0x0c80, 0x0cff],
  consonants: [[0x0c95, 0x0cb9], [0x0cde, 0x0cde]],
  standalone: [[0x0c85, 0x0c8c], [0x0c8e, 0x0c90], [0x0c92, 0x0c94],
    [0x0cbd, 0x0cbd]],
  matras: [[0x0cbe, 0x0ccc], [0x0cd5, 0x0cd6], [0x0ce2, 0x0ce3]],
  signs: [[0x0c81, 0x0c83], [0x0cbc, 0x0cbc]],
  virama: 0x0ccd,
  nukta: 0x0cbc,
  // As Telugu: Kannada's signs sit above and after the letter, never before it.
  preBase: [],
};

export const MALAYALAM: IndicScript = {
  name: 'Malayalam',
  block: [0x0d00, 0x0d7f],
  consonants: [[0x0d15, 0x0d3a]],
  standalone: [[0x0d05, 0x0d0c], [0x0d0e, 0x0d10], [0x0d12, 0x0d14],
    [0x0d3d, 0x0d3d]],
  matras: [[0x0d3e, 0x0d4c], [0x0d57, 0x0d57], [0x0d62, 0x0d63]],
  signs: [[0x0d01, 0x0d03]],
  virama: 0x0d4d,
  preBase: [0x0d46, 0x0d47, 0x0d48],
  twoPart: {
    0x0d4a: [0x0d46, 0x0d3e],
    0x0d4b: [0x0d47, 0x0d3e],
    0x0d4c: [0x0d46, 0x0d57],
  },
};

export const SINHALA: IndicScript = {
  name: 'Sinhala',
  block: [0x0d80, 0x0dff],
  consonants: [[0x0d9a, 0x0dc6]],
  standalone: [[0x0d85, 0x0d96]],
  matras: [[0x0dcf, 0x0ddf], [0x0df2, 0x0df3]],
  signs: [[0x0d82, 0x0d83]],
  virama: 0x0dca, // al-lakuna
  preBase: [0x0dd9],
  twoPart: {
    0x0dda: [0x0dd9, 0x0dca],
    0x0ddc: [0x0dd9, 0x0dcf],
    0x0ddd: [0x0dd9, 0x0dcf, 0x0dca],
    0x0dde: [0x0dd9, 0x0ddf],
  },
};

/** Every script this module reorders, for the font table to draw on. */
export const SCRIPTS: readonly IndicScript[] = [
  DEVANAGARI, BENGALI, GURMUKHI, GUJARATI, ORIYA,
  TAMIL, TELUGU, KANNADA, MALAYALAM, SINHALA,
];

/** Whether reordering has anything to do in this text at all. */
export function hasScript(text: string, script: IndicScript): boolean {
  const [lo, hi] = script.block;
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/**
 * Append one syllable, pre-base signs first.
 *
 * The sign moves ahead of the whole consonant cluster, not just the letter it
 * follows: in स्थिति the ि belongs to स्थ and is drawn before the स.
 */
function appendSyllable(
  out: number[],
  chars: number[],
  start: number,
  end: number,
  script: IndicScript,
): void {
  const isPreBase = (c: number) => script.preBase.includes(c);
  let moved = false;
  for (let i = start; i < end; i++) {
    if (isPreBase(chars[i])) {
      out.push(chars[i]);
      moved = true;
    }
  }
  for (let i = start; i < end; i++) {
    if (!moved || !isPreBase(chars[i])) out.push(chars[i]);
  }
}

/**
 * Split the vowel signs that are stored as one character and drawn as two.
 *
 * Only the scripts with a `twoPart` table have any, and only those characters
 * are touched — everything else comes through as it went in. The string grows
 * by a character where one is split, which is the one place this module is not
 * a pure permutation: a line counted before this ran is drawn one character
 * wider. These faces measure around 60% of the cell the count reserved, so it
 * finishes well inside the margin either way.
 */
function decomposeTwoPart(chars: number[], script: IndicScript): number[] {
  const table = script.twoPart;
  if (!table) return chars;

  let found = false;
  for (const char of chars) {
    if (table[char]) { found = true; break; }
  }
  if (!found) return chars;

  const out: number[] = [];
  for (const char of chars) {
    const parts = table[char];
    if (parts) out.push(...parts);
    else out.push(char);
  }
  return out;
}

/**
 * Reorder `text` for a renderer that paints characters where it finds them.
 *
 * Returns the input unchanged when the script is not in it, and when the
 * script has no pre-base sign to move — Telugu and Kannada are in the table
 * for their faces, not for a reordering.
 */
export function reorderIndic(text: string, script: IndicScript): string {
  if (!hasScript(text, script)) return text;

  const isConsonant = (c: number) => inRanges(c, script.consonants);
  const isStandalone = (c: number) => inRanges(c, script.standalone);
  const isMatra = (c: number) => inRanges(c, script.matras) && c !== script.virama;
  const isSign = (c: number) => inRanges(c, script.signs);

  const chars = decomposeTwoPart([...text].map((c) => c.codePointAt(0)!), script);
  const out: number[] = [];

  let i = 0;
  while (i < chars.length) {
    const start = i;

    // Anything that cannot open a syllable — Latin, a space, a danda, a digit,
    // a stray matra — stands on its own and is left where it is.
    if (!isConsonant(chars[i]) && !isStandalone(chars[i])) {
      out.push(chars[i]);
      i++;
      continue;
    }

    i++;
    if (script.nukta !== undefined && i < chars.length && chars[i] === script.nukta) i++;

    // Consonants strung together by viramas are one syllable, however many.
    while (i < chars.length && chars[i] === script.virama) {
      let next = i + 1;
      if (next < chars.length && (chars[next] === ZWJ || chars[next] === ZWNJ)) next++;
      if (next < chars.length && isConsonant(chars[next])) {
        i = next + 1;
        if (script.nukta !== undefined && i < chars.length && chars[i] === script.nukta) i++;
      } else {
        i++; // a virama with no consonant after it still belongs to this syllable
        break;
      }
    }

    while (i < chars.length && (isMatra(chars[i]) || isSign(chars[i]))) i++;

    appendSyllable(out, chars, start, i, script);
  }

  return String.fromCodePoint(...out);
}

/** The reordering `script` needs, ready to hand to a font table entry. */
export function reorderFor(script: IndicScript): (text: string) => string {
  return (text: string) => reorderIndic(text, script);
}

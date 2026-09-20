/**
 * Putting a Devanagari syllable into the order it is drawn in.
 *
 * Devanagari is stored in the order it is spoken and drawn in a different one.
 * The vowel sign ि (U+093F) is typed and stored *after* the consonant it
 * belongs to and painted *before* it: हिन्दी is held as ह ि न ् द ी. Every text
 * engine that lays Devanagari out — the browser behind the editor, Word, a PDF
 * reader showing a file Acrobat made — runs the font's OpenType rules and moves
 * it. jsPDF runs none: it looks each character up in the font's `cmap` and
 * paints it where it came, so ह ि goes out as ह followed by a vowel sign whose
 * hook arcs over whatever is next. A reader sees the sign hanging off the wrong
 * letter — हिन्दी reads as हनि्दी — which in a language where the vowel is the
 * word is not a typographic nicety.
 *
 * So the one reordering Devanagari cannot do without is done here, on the
 * string, just before it is drawn. It is a permutation: the same characters in
 * a different order, so nothing that counted them — line breaking, page
 * breaks, the ToUnicode map a reader copies text back out of — sees any change.
 *
 * What this deliberately does not do is shape. Conjuncts (क् + ष as क्ष) and
 * reph (the र् of कर्म, drawn as a stroke above the syllable) are substitutions,
 * not reorderings: the glyphs exist in the font but there is no way to ask
 * jsPDF for them, since it addresses glyphs only through `cmap` and a conjunct
 * has no character of its own. Those come out as an explicit halant — क्ष, कर्म
 * — which is how Devanagari is written when a conjunct is being spelled out,
 * and reads correctly even though a typesetter would not have set it that way.
 * Closing that gap means shaping before drawing and addressing glyphs by index;
 * see `public/fonts/README.md`.
 */

const VIRAMA = 0x094d;   // ्  halant — joins two consonants
const NUKTA = 0x093c;    // ़  the dot that makes क into क़
const ZWNJ = 0x200c;     // asks for the halant to stay visible
const ZWJ = 0x200d;      // asks for the half form

/** The Devanagari block — the range this module has anything to say about. */
function isDevanagari(codePoint: number): boolean {
  return codePoint >= 0x0900 && codePoint <= 0x097f;
}

/** क–ह, the precomposed nukta forms क़–य़, and the later additions. */
function isConsonant(codePoint: number): boolean {
  return (codePoint >= 0x0915 && codePoint <= 0x0939)
    || (codePoint >= 0x0958 && codePoint <= 0x095f)
    || (codePoint >= 0x0978 && codePoint <= 0x097f);
}

/** A letter that can open a syllable without being a consonant: अ–औ, ॐ, ऽ. */
function isStandaloneLetter(codePoint: number): boolean {
  return (codePoint >= 0x0904 && codePoint <= 0x0914)
    || codePoint === 0x093d || codePoint === 0x0950;
}

/** A dependent vowel sign — a matra. The virama is not one. */
function isMatra(codePoint: number): boolean {
  return (codePoint >= 0x093a && codePoint <= 0x093b)
    || (codePoint >= 0x093e && codePoint <= 0x094c)
    || (codePoint >= 0x094e && codePoint <= 0x094f)
    || (codePoint >= 0x0955 && codePoint <= 0x0957)
    || (codePoint >= 0x0962 && codePoint <= 0x0963);
}

/** Candrabindu, anusvara, visarga, the Vedic accents, and the nukta. */
function isSyllableSign(codePoint: number): boolean {
  return (codePoint >= 0x0900 && codePoint <= 0x0903)
    || (codePoint >= 0x0951 && codePoint <= 0x0954)
    || codePoint === NUKTA;
}

/**
 * The signs painted to the left of the syllable they belong to.
 *
 * Devanagari has two: ि, which is everywhere, and ॎ, which is not. The other
 * matras sit above, below or after the letter and are already in drawing order.
 */
function isPreBaseMatra(codePoint: number): boolean {
  return codePoint === 0x093f || codePoint === 0x094e;
}

/** Whether reordering has anything to do here at all. */
export function hasDevanagari(text: string): boolean {
  for (const char of text) {
    if (isDevanagari(char.codePointAt(0)!)) return true;
  }
  return false;
}

/**
 * Append one syllable, pre-base matra first.
 *
 * The matra moves ahead of the whole consonant sequence, not just the letter it
 * follows: in स्थिति the ि belongs to स्थ and is drawn before the स.
 */
function appendSyllable(out: number[], chars: number[], start: number, end: number): void {
  let moved = false;
  for (let i = start; i < end; i++) {
    if (isPreBaseMatra(chars[i])) {
      out.push(chars[i]);
      moved = true;
    }
  }
  for (let i = start; i < end; i++) {
    if (!moved || !isPreBaseMatra(chars[i])) out.push(chars[i]);
  }
}

/**
 * Reorder `text` for a renderer that paints characters where it finds them.
 *
 * Returns the input unchanged when there is no Devanagari in it, and always
 * returns the same characters — only their order can differ.
 */
export function reorderDevanagari(text: string): string {
  if (!hasDevanagari(text)) return text;

  const chars = [...text].map((char) => char.codePointAt(0)!);
  const out: number[] = [];

  let i = 0;
  while (i < chars.length) {
    const start = i;

    // Anything that cannot open a syllable — Latin, a space, a danda, a digit,
    // a stray matra — stands on its own and is left where it is.
    if (!isConsonant(chars[i]) && !isStandaloneLetter(chars[i])) {
      out.push(chars[i]);
      i++;
      continue;
    }

    i++;
    if (i < chars.length && chars[i] === NUKTA) i++;

    // Consonants strung together by viramas are one syllable, however many.
    while (i < chars.length && chars[i] === VIRAMA) {
      let next = i + 1;
      if (next < chars.length && (chars[next] === ZWJ || chars[next] === ZWNJ)) next++;
      if (next < chars.length && isConsonant(chars[next])) {
        i = next + 1;
        if (i < chars.length && chars[i] === NUKTA) i++;
      } else {
        i++; // a virama with no consonant after it still belongs to this syllable
        break;
      }
    }

    while (i < chars.length && (isMatra(chars[i]) || isSyllableSign(chars[i]))) i++;

    appendSyllable(out, chars, start, i);
  }

  return String.fromCodePoint(...out);
}

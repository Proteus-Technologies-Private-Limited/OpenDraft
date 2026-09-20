/**
 * Giving each Arabic letter the shape it takes in the word it is in.
 *
 * Arabic is cursive: a letter is written differently depending on whether it
 * joins to the letter before it, the one after it, both, or neither. بـ ـبـ ـب
 * ب are all the same letter. A font carries all four and an OpenType engine
 * picks between them — but jsPDF runs no OpenType engine. It looks each
 * character up in the font's `cmap` and paints the glyph it finds, which is
 * always the isolated form, so an Arabic line comes out as a row of
 * disconnected letters: legible to nobody, and wrong in the way a word written
 * in unjoined cursive is wrong.
 *
 * Unicode has an answer that a `cmap` can reach. The Arabic Presentation Forms
 * blocks give every shape of every letter a code point of its own — ب is
 * U+0628 and its initial form ـبـ is U+FE91 — so the shaping can be done to the
 * *characters*, before drawing, and jsPDF then finds each shape by looking up
 * an ordinary character. The blocks exist for round-tripping legacy encodings
 * and Unicode discourages storing text in them; using them as a rendering
 * intermediate, which is what happens here, is exactly what they can still do.
 *
 * The table is generated from Unicode's own decomposition data — every entry
 * is a character whose decomposition reads `<initial> 0628` or similar — so it
 * is not a transcription anybody had to check by hand. 76 letters, which is
 * the Arabic alphabet plus the letters Persian and Urdu add.
 *
 * What is not done:
 *
 * - **Optional ligatures.** Only lam-alef is substituted, because it is the
 *   one ligature Arabic orthography requires; لا is not written ل‌ا. The
 *   decorative ones (lam-meem, and the hundreds in the Forms-A block) are left
 *   as their separate letters, which is how plain Arabic prose is set.
 * - **Mark positioning.** Harakat are drawn where the font's default anchors
 *   put them, since GPOS is as unreachable as GSUB. Screenplay Arabic is
 *   normally written without them.
 */
/** Isolated, final, initial, medial — 0 where the letter has no such shape. */
type Forms = readonly [number, number, number, number];

const FORMS = new Map<number, Forms>([
  [0x0621, [0xfe80, 0x0000, 0x0000, 0x0000]],
  [0x0622, [0xfe81, 0xfe82, 0x0000, 0x0000]],
  [0x0623, [0xfe83, 0xfe84, 0x0000, 0x0000]],
  [0x0624, [0xfe85, 0xfe86, 0x0000, 0x0000]],
  [0x0625, [0xfe87, 0xfe88, 0x0000, 0x0000]],
  [0x0626, [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c]],
  [0x0627, [0xfe8d, 0xfe8e, 0x0000, 0x0000]],
  [0x0628, [0xfe8f, 0xfe90, 0xfe91, 0xfe92]],
  [0x0629, [0xfe93, 0xfe94, 0x0000, 0x0000]],
  [0x062a, [0xfe95, 0xfe96, 0xfe97, 0xfe98]],
  [0x062b, [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c]],
  [0x062c, [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0]],
  [0x062d, [0xfea1, 0xfea2, 0xfea3, 0xfea4]],
  [0x062e, [0xfea5, 0xfea6, 0xfea7, 0xfea8]],
  [0x062f, [0xfea9, 0xfeaa, 0x0000, 0x0000]],
  [0x0630, [0xfeab, 0xfeac, 0x0000, 0x0000]],
  [0x0631, [0xfead, 0xfeae, 0x0000, 0x0000]],
  [0x0632, [0xfeaf, 0xfeb0, 0x0000, 0x0000]],
  [0x0633, [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4]],
  [0x0634, [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8]],
  [0x0635, [0xfeb9, 0xfeba, 0xfebb, 0xfebc]],
  [0x0636, [0xfebd, 0xfebe, 0xfebf, 0xfec0]],
  [0x0637, [0xfec1, 0xfec2, 0xfec3, 0xfec4]],
  [0x0638, [0xfec5, 0xfec6, 0xfec7, 0xfec8]],
  [0x0639, [0xfec9, 0xfeca, 0xfecb, 0xfecc]],
  [0x063a, [0xfecd, 0xfece, 0xfecf, 0xfed0]],
  [0x0641, [0xfed1, 0xfed2, 0xfed3, 0xfed4]],
  [0x0642, [0xfed5, 0xfed6, 0xfed7, 0xfed8]],
  [0x0643, [0xfed9, 0xfeda, 0xfedb, 0xfedc]],
  [0x0644, [0xfedd, 0xfede, 0xfedf, 0xfee0]],
  [0x0645, [0xfee1, 0xfee2, 0xfee3, 0xfee4]],
  [0x0646, [0xfee5, 0xfee6, 0xfee7, 0xfee8]],
  [0x0647, [0xfee9, 0xfeea, 0xfeeb, 0xfeec]],
  [0x0648, [0xfeed, 0xfeee, 0x0000, 0x0000]],
  [0x0649, [0xfeef, 0xfef0, 0xfbe8, 0xfbe9]],
  [0x064a, [0xfef1, 0xfef2, 0xfef3, 0xfef4]],
  [0x0671, [0xfb50, 0xfb51, 0x0000, 0x0000]],
  [0x0677, [0xfbdd, 0x0000, 0x0000, 0x0000]],
  [0x0679, [0xfb66, 0xfb67, 0xfb68, 0xfb69]],
  [0x067a, [0xfb5e, 0xfb5f, 0xfb60, 0xfb61]],
  [0x067b, [0xfb52, 0xfb53, 0xfb54, 0xfb55]],
  [0x067e, [0xfb56, 0xfb57, 0xfb58, 0xfb59]],
  [0x067f, [0xfb62, 0xfb63, 0xfb64, 0xfb65]],
  [0x0680, [0xfb5a, 0xfb5b, 0xfb5c, 0xfb5d]],
  [0x0683, [0xfb76, 0xfb77, 0xfb78, 0xfb79]],
  [0x0684, [0xfb72, 0xfb73, 0xfb74, 0xfb75]],
  [0x0686, [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d]],
  [0x0687, [0xfb7e, 0xfb7f, 0xfb80, 0xfb81]],
  [0x0688, [0xfb88, 0xfb89, 0x0000, 0x0000]],
  [0x068c, [0xfb84, 0xfb85, 0x0000, 0x0000]],
  [0x068d, [0xfb82, 0xfb83, 0x0000, 0x0000]],
  [0x068e, [0xfb86, 0xfb87, 0x0000, 0x0000]],
  [0x0691, [0xfb8c, 0xfb8d, 0x0000, 0x0000]],
  [0x0698, [0xfb8a, 0xfb8b, 0x0000, 0x0000]],
  [0x06a4, [0xfb6a, 0xfb6b, 0xfb6c, 0xfb6d]],
  [0x06a6, [0xfb6e, 0xfb6f, 0xfb70, 0xfb71]],
  [0x06a9, [0xfb8e, 0xfb8f, 0xfb90, 0xfb91]],
  [0x06ad, [0xfbd3, 0xfbd4, 0xfbd5, 0xfbd6]],
  [0x06af, [0xfb92, 0xfb93, 0xfb94, 0xfb95]],
  [0x06b1, [0xfb9a, 0xfb9b, 0xfb9c, 0xfb9d]],
  [0x06b3, [0xfb96, 0xfb97, 0xfb98, 0xfb99]],
  [0x06ba, [0xfb9e, 0xfb9f, 0x0000, 0x0000]],
  [0x06bb, [0xfba0, 0xfba1, 0xfba2, 0xfba3]],
  [0x06be, [0xfbaa, 0xfbab, 0xfbac, 0xfbad]],
  [0x06c0, [0xfba4, 0xfba5, 0x0000, 0x0000]],
  [0x06c1, [0xfba6, 0xfba7, 0xfba8, 0xfba9]],
  [0x06c5, [0xfbe0, 0xfbe1, 0x0000, 0x0000]],
  [0x06c6, [0xfbd9, 0xfbda, 0x0000, 0x0000]],
  [0x06c7, [0xfbd7, 0xfbd8, 0x0000, 0x0000]],
  [0x06c8, [0xfbdb, 0xfbdc, 0x0000, 0x0000]],
  [0x06c9, [0xfbe2, 0xfbe3, 0x0000, 0x0000]],
  [0x06cb, [0xfbde, 0xfbdf, 0x0000, 0x0000]],
  [0x06cc, [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff]],
  [0x06d0, [0xfbe4, 0xfbe5, 0xfbe6, 0xfbe7]],
  [0x06d2, [0xfbae, 0xfbaf, 0x0000, 0x0000]],
  [0x06d3, [0xfbb0, 0xfbb1, 0x0000, 0x0000]],
]);

const LAM_ALEF = new Map<number, readonly [number, number]>([
  [0x0622, [0xfef5, 0xfef6]],
  [0x0623, [0xfef7, 0xfef8]],
  [0x0625, [0xfef9, 0xfefa]],
  [0x0627, [0xfefb, 0xfefc]],
]);

const TRANSPARENT: readonly (readonly [number, number])[] = [
  [0x0610, 0x061a], [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x06df, 0x06e4], [0x06e7, 0x06e8], [0x06ea, 0x06ed], [0x0711, 0x0711], [0x0730, 0x074a],
];
const LAM = 0x0644;
const ISOLATED = 0;
const FINAL = 1;
const INITIAL = 2;
const MEDIAL = 3;

function isTransparent(codePoint: number): boolean {
  for (const [lo, hi] of TRANSPARENT) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** Whether this letter can join to the one that follows it. */
function joinsForward(codePoint: number): boolean {
  const forms = FORMS.get(codePoint);
  // Having an initial shape is the definition of joining forward: a letter
  // that never joins to the next one was never given one.
  return !!forms && forms[INITIAL] !== 0;
}

/** Whether this letter can join back to the one before it. */
function joinsBackward(codePoint: number): boolean {
  const forms = FORMS.get(codePoint);
  return !!forms && forms[FINAL] !== 0;
}

/**
 * One character of shaped output, and where in the input it came from.
 *
 * The index is carried because the caller has the text in styled runs and has
 * to put it back in them afterwards — and because lam-alef turns two
 * characters into one, so position alone stops being an answer.
 */
export interface ShapedChar {
  codePoint: number;
  /** Index into the original string. */
  source: number;
}

/**
 * Substitute every Arabic letter for the shape its neighbours give it.
 *
 * Returns one entry per drawn character. Anything that is not an Arabic
 * letter — Latin, spaces, digits, punctuation, and the marks, which are drawn
 * as they are — comes through untouched.
 */
export function shapeArabic(text: string): ShapedChar[] {
  const chars = [...text];
  const points = chars.map((char) => char.codePointAt(0)!);
  const out: ShapedChar[] = [];

  /** The nearest letter either side, looking past the marks that ride on one. */
  const neighbour = (from: number, step: number): number => {
    for (let i = from + step; i >= 0 && i < points.length; i += step) {
      if (!isTransparent(points[i])) return points[i];
    }
    return 0;
  };

  for (let i = 0; i < points.length; i++) {
    const codePoint = points[i];
    const forms = FORMS.get(codePoint);
    if (!forms) {
      out.push({ codePoint, source: i });
      continue;
    }

    const afterJoiner = joinsForward(neighbour(i, -1));

    // لا is one glyph, not two. Taken before the ordinary shaping so the alef
    // is never emitted on its own.
    if (codePoint === LAM) {
      const next = neighbour(i, 1);
      const ligature = LAM_ALEF.get(next);
      if (ligature) {
        const form = afterJoiner && ligature[1] ? ligature[1] : ligature[0];
        out.push({ codePoint: form, source: i });
        // Skip the alef itself, and any marks between the two letters, which
        // have nowhere to sit once the pair is one glyph.
        let j = i + 1;
        while (j < points.length && isTransparent(points[j])) j++;
        i = j;
        continue;
      }
    }

    const beforeJoiner = joinsBackward(neighbour(i, 1));
    let form: number;
    if (afterJoiner && beforeJoiner && forms[MEDIAL]) form = forms[MEDIAL];
    else if (afterJoiner && forms[FINAL]) form = forms[FINAL];
    else if (beforeJoiner && forms[INITIAL]) form = forms[INITIAL];
    else form = forms[ISOLATED];

    out.push({ codePoint: form || codePoint, source: i });
  }

  return out;
}

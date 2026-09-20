/**
 * Writing something other than Latin into an exported PDF.
 *
 * jsPDF draws in the PDF Standard 14 faces, and those are WinAnsi-encoded:
 * outside that repertoire there is simply no byte to write.  jsPDF does not
 * refuse; it switches the whole string to two-byte UTF-16 and a reader, still
 * reading WinAnsi, prints one Latin character per byte.  A Cyrillic script
 * came out as `" ' B > C B 5 1 O` — the low bytes of its own code points.
 *
 * The fix is a real embedded font, and which one depends on the script.
 * `FALLBACKS` is that table: each face declares the code points its subset
 * carries, whether it sits on Final Draft's fixed cell, and any reordering the
 * script cannot be read without.  Adding a script is an entry here and a font
 * file — see `test-script/fetch-export-fonts.sh`, which cuts the subsets and
 * holds the same ranges.
 *
 * Text is split by face character by character, so a Latin word inside a Hindi
 * line stays on Courier's cell instead of being dragged into a proportional
 * face with it.  The split is sticky: once in a fallback, text stays there for
 * as long as that face can write it, which is what keeps a Cyrillic sentence
 * one continuous piece of DejaVu rather than a mosaic of it and Courier.
 *
 * Nothing here is embedded that the document does not use.  The faces are
 * chosen from the text about to be drawn, jsPDF then writes only the glyphs
 * that text reached, and a Latin script that never gets this far carries no
 * font at all.
 *
 * ## What is still beyond this module
 *
 * **Right-to-left** is handled a level up.  Hebrew and Arabic have faces here,
 * but the reordering a line needs before it can be drawn spans the whole line
 * rather than one face's share of it, so `utils/bidi` does it first and this
 * module receives text already in the order it is painted.  Arabic arrives
 * substituted for its joined forms, which is why the coverage above carries
 * the presentation blocks.
 *
 * **Shaping.**  Conjuncts and reph are substitutions, and jsPDF addresses a
 * font only through its `cmap` — see `utils/indic.ts` and
 * `public/fonts/README.md`.
 */
import type jsPDF from 'jspdf';
import {
  SCRIPTS, reorderFor, type IndicScript,
} from './indic';

/**
 * The jsPDF font ids the fallbacks are registered under — and, because jsPDF
 * writes the id as the /BaseFont, the names a reader shows for them.
 */
export const UNICODE_FONT_ID = 'DejaVuSansMono';
export const DEVANAGARI_FONT_ID = 'NotoSansDevanagari';
export const CJK_FONT_ID = 'NotoSansCJK';

export type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

/** A half-open range of code points, inclusive at both ends. */
type Range = readonly [number, number];

function inRanges(codePoint: number, ranges: readonly Range[]): boolean {
  for (const [lo, hi] of ranges) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** Where a face's files come from, which decides what happens offline. */
type FontFiles = Partial<Record<FontStyle, string>>;

/**
 * One family this face can be drawn from, chosen per document.
 *
 * Only CJK has more than one.  Han is written in all of Chinese, Japanese and
 * Korean, so no per-character rule can say which family a given ideograph
 * belongs to — that is a fact about the document, not about the character.
 * The markers are what settles it: kana means Japanese, hangul means Korean,
 * and Han on its own is taken as Chinese.
 */
interface FaceVariant {
  key: string;
  /** What this face is for, as the writer would name it if it failed to load. */
  label: string;
  files: FontFiles;
  /** Characters that mean the document is written in this variant. */
  markers?: readonly Range[];
}

/** One of the fallback faces, and what it is good for. */
interface FallbackSpec {
  id: string;
  /** The code points this face's subset actually carries. */
  coverage: readonly Range[];
  /**
   * Whether the face sits on Final Draft's fixed cell.  A monospaced one is
   * stretched to it and measured by character count; a proportional one is
   * drawn and measured at its own advances.
   */
  monospace: boolean;
  /**
   * Whether the files ship inside the app.  A bundled face works offline and
   * always has; a remote one is fetched on first use and kept, because it is
   * megabytes rather than kilobytes and every user would otherwise install it
   * to export a script almost none of them write.
   */
  remote?: boolean;
  /** Reordering the script needs before it can be drawn — see utils/indic. */
  shape?: (text: string) => string;
  /** The families this face can be drawn from; the first is the default. */
  variants: readonly FaceVariant[];
}

/** A bundled Noto face for one Indic script, as they are all declared alike. */
function indicFace(script: IndicScript, prefix: string, coverage: readonly Range[]): FallbackSpec {
  return {
    id: prefix,
    coverage,
    monospace: false,
    shape: reorderFor(script),
    variants: [{
      key: prefix,
      label: script.name,
      files: {
        normal: `/fonts/${prefix}-Regular.ttf`,
        bold: `/fonts/${prefix}-Bold.ttf`,
      },
    }],
  };
}

const byName = (name: string): IndicScript => {
  const found = SCRIPTS.find((script) => script.name === name);
  if (!found) throw new Error(`no Indic script named ${name}`);
  return found;
};

/**
 * The spaces are in every range so a line keeps its own word spacing rather
 * than dropping back to Courier's cell between words, and U+25CC so a vowel
 * sign with no consonant still shows the dotted circle it is drawn on.
 */
const SHARED: readonly Range[] = [[0x0020, 0x0020], [0x00a0, 0x00a0], [0x25cc, 0x25cc]];
const JOINERS: readonly Range[] = [[0x200c, 0x200d]];
const RUPEE: readonly Range[] = [[0x20b9, 0x20b9]];

/**
 * Where the CJK families are fetched from.
 *
 * Google's own font CDN, which is where the bundled subsets were cut from too.
 * Each URL carries the hash of one published version, so it keeps serving that
 * exact file after a newer one appears — a link that rots into the wrong font
 * would be worse than one that rots into a 404, and this cannot do either.
 *
 * Refresh them with `./test-script/fetch-export-fonts.sh --cjk-urls`, which
 * asks the Google Fonts CSS API for the current TrueType of each family. They
 * are only worth refreshing to pick up upstream fixes; nothing breaks if they
 * are left alone.
 */
const CJK_FILES: Readonly<Record<string, FontFiles>> = {
  SC: {
    normal: 'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaG9_FnYw.ttf',
    bold: 'https://fonts.gstatic.com/s/notosanssc/v40/k3kCo84MPvpLmixcA63oeAL7Iqp5IZJF9bmaGzjCnYw.ttf',
  },
  TC: {
    normal: 'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz76Cy_Co.ttf',
    bold: 'https://fonts.gstatic.com/s/notosanstc/v39/-nFuOG829Oofr2wohFbTp9ifNAn722rq0MXz70e1_Co.ttf',
  },
  JP: {
    normal: 'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf',
    bold: 'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf',
  },
  KR: {
    normal: 'https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLQ.ttf',
    bold: 'https://fonts.gstatic.com/s/notosanskr/v39/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzg01eLQ.ttf',
  },
};

/**
 * Narrowest coverage first: the script-specific faces and DejaVu overlap only
 * on characters either could write, and the script's own face should get them.
 */
const FALLBACKS: readonly FallbackSpec[] = [
  indicFace(byName('Devanagari'), DEVANAGARI_FONT_ID,
    [[0x0900, 0x097f], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Bengali'), 'NotoSansBengali',
    [[0x0980, 0x09ff], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Gurmukhi'), 'NotoSansGurmukhi',
    [[0x0a00, 0x0a7f], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Gujarati'), 'NotoSansGujarati',
    [[0x0a80, 0x0aff], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Odia'), 'NotoSansOriya',
    [[0x0b00, 0x0b7f], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Tamil'), 'NotoSansTamil',
    [[0x0b80, 0x0bff], ...JOINERS, ...SHARED]),
  indicFace(byName('Telugu'), 'NotoSansTelugu',
    [[0x0c00, 0x0c7f], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Kannada'), 'NotoSansKannada',
    [[0x0c80, 0x0cff], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Malayalam'), 'NotoSansMalayalam',
    [[0x0d00, 0x0d7f], ...JOINERS, ...RUPEE, ...SHARED]),
  indicFace(byName('Sinhala'), 'NotoSansSinhala',
    [[0x0d80, 0x0dff], ...JOINERS, ...SHARED]),
  {
    // Hebrew and Arabic are drawn right to left, which is not this module's
    // business: the line is reordered by utils/bidi before it ever gets here,
    // and by then it is in the order it is painted.  What is this module's
    // business is that Arabic arrives already substituted for its joined
    // forms, so the coverage has to carry the presentation blocks as well as
    // the letters themselves.
    id: 'NotoSansHebrew',
    coverage: [[0x0590, 0x05ff], [0xfb1d, 0xfb4f], [0x200e, 0x200f],
      [0x0020, 0x0020], [0x00a0, 0x00a0]],
    monospace: false,
    variants: [{
      key: 'NotoSansHebrew',
      label: 'Hebrew',
      files: {
        normal: '/fonts/NotoSansHebrew-Regular.ttf',
        bold: '/fonts/NotoSansHebrew-Bold.ttf',
      },
    }],
  },
  {
    id: 'NotoSansArabic',
    coverage: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff],
      [0xfb50, 0xfbb1], [0xfbd3, 0xfbe9], [0xfbfc, 0xfbff], [0xfe70, 0xfefc],
      [0x200e, 0x200f], [0x0020, 0x0020], [0x00a0, 0x00a0]],
    monospace: false,
    variants: [{
      key: 'NotoSansArabic',
      label: 'Arabic',
      files: {
        normal: '/fonts/NotoSansArabic-Regular.ttf',
        bold: '/fonts/NotoSansArabic-Bold.ttf',
      },
    }],
  },
  {
    // Thai stores its pre-base vowels before the consonant already, so unlike
    // every Indic script above it needs no reordering at all.
    id: 'NotoSansThai',
    coverage: [[0x0e00, 0x0e7f], ...SHARED],
    monospace: false,
    variants: [{
      key: 'NotoSansThai',
      label: 'Thai',
      files: {
        normal: '/fonts/NotoSansThai-Regular.ttf',
        bold: '/fonts/NotoSansThai-Bold.ttf',
      },
    }],
  },
  {
    id: UNICODE_FONT_ID,
    // The blocks the bundled subset was cut to — see public/fonts/README.md.
    coverage: [[0x0000, 0x02ff], [0x0370, 0x058f], [0x10a0, 0x10ff],
      [0x1e00, 0x1eff], [0x2000, 0x206f], [0x20a0, 0x20bf],
      [0x2100, 0x214f], [0x2190, 0x2193], [0x2212, 0x2212]],
    monospace: true,
    variants: [{
      key: UNICODE_FONT_ID,
      label: 'Cyrillic, Greek, Armenian and Georgian',
      files: {
        normal: '/fonts/DejaVuSansMono-Regular.ttf',
        bold: '/fonts/DejaVuSansMono-Bold.ttf',
        italic: '/fonts/DejaVuSansMono-Italic.ttf',
        bolditalic: '/fonts/DejaVuSansMono-BoldItalic.ttf',
      },
    }],
  },
  {
    // Han, kana, hangul, and the punctuation and full-width forms that go with
    // them.  Fetched rather than bundled: these families are 5–10 MB each,
    // which no subset can help with, because which ideographs a screenplay
    // uses is not known until it is exported.
    id: CJK_FONT_ID,
    coverage: [[0x1100, 0x11ff], [0x2e80, 0x2fdf], [0x3000, 0x303f],
      [0x3040, 0x30ff], [0x3130, 0x318f], [0x31f0, 0x31ff],
      [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa960, 0xa97f],
      [0xac00, 0xd7af], [0xf900, 0xfaff], [0xfe30, 0xfe4f],
      [0xff00, 0xffef], ...SHARED],
    monospace: false,
    remote: true,
    variants: [
      {
        key: 'SC',
        label: 'Chinese',
        files: CJK_FILES.SC,
      },
      {
        key: 'JP',
        label: 'Japanese',
        // Kana. Japanese always mixes it with Han, so its presence settles a
        // document that Han alone could not.
        markers: [[0x3040, 0x30ff], [0x31f0, 0x31ff]],
        files: CJK_FILES.JP,
      },
      {
        key: 'KR',
        label: 'Korean',
        markers: [[0x1100, 0x11ff], [0x3130, 0x318f], [0xa960, 0xa97f], [0xac00, 0xd7af]],
        files: CJK_FILES.KR,
      },
      {
        // Traditional Chinese cannot be told from Simplified by block — they
        // share most of their characters — so this is a handful of common
        // words that exist only in the traditional form, and whose Japanese
        // equivalent is written differently again (Japanese uses 国, 会, 来,
        // not 國, 會, 來). Kana settles a Japanese document before this is
        // reached, so the overlap that remains is a Japanese script with no
        // kana in it at all, which is not a thing screenplays are.
        //
        // Getting this wrong is not fatal: both families carry both sets of
        // code points, so a misread document is drawn in the other one's
        // glyph shapes rather than left blank.
        key: 'TC',
        label: 'Chinese (traditional)',
        markers: [
          [0x4e5f, 0x4e5f], [0x5011, 0x5011], [0x5169, 0x5169], [0x570b, 0x570b],
          [0x5c0d, 0x5c0d], [0x5be6, 0x5be6], [0x6703, 0x6703], [0x6a23, 0x6a23],
          [0x6c92, 0x6c92], [0x7063, 0x7063], [0x7522, 0x7522], [0x767c, 0x767c],
          [0x8046, 0x8046], [0x8207, 0x8207], [0x8b1b, 0x8b1b], [0x8b80, 0x8b80],
          [0x8aaa, 0x8aaa], [0x9019, 0x9019], [0x9084, 0x9084], [0x9ebc, 0x9ebc],
          [0x9ede, 0x9ede], [0x9ad4, 0x9ad4], [0x95dc, 0x95dc], [0x5b78, 0x5b78],
          [0x4f86, 0x4f86], [0x7232, 0x7232], [0x8cfa, 0x8cfa], [0x904e, 0x904e],
        ],
        files: CJK_FILES.TC,
      },
    ],
  },
];

/**
 * The scripts this module knows by name but cannot draw, so the writer is told
 * which one is missing rather than "some characters".
 *
 * Anything not listed is reported generically. The point is a name the writer
 * recognises, not a complete census of Unicode.
 */
const UNSUPPORTED_SCRIPTS: readonly (readonly [Range, string])[] = [
  [[0x0700, 0x074f], 'Syriac'],
  [[0x0780, 0x07bf], 'Thaana'],
  [[0x07c0, 0x07ff], "N'Ko"],
  [[0x0e80, 0x0eff], 'Lao'],
  [[0x0f00, 0x0fff], 'Tibetan'],
  [[0x1000, 0x109f], 'Myanmar'],
  [[0x1200, 0x139f], 'Ethiopic'],
  [[0x13a0, 0x13ff], 'Cherokee'],
  [[0x1780, 0x17ff], 'Khmer'],
  [[0x1800, 0x18af], 'Mongolian'],
];

/**
 * The WinAnsi code points above Latin-1 — jsPDF maps these itself, so a curly
 * quote or an em dash still goes out in the document's own face.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Whether a Standard 14 face can write this code point at all. */
function isStandardEncodable(codePoint: number): boolean {
  if (codePoint < 0x80) return true; // ASCII
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true; // WinAnsi agrees with Latin-1 here
  return WINANSI_EXTRAS.has(codePoint);
}

/** The bundled face that has to draw this code point, or null for the built-ins. */
function specFor(codePoint: number): FallbackSpec | null {
  if (isStandardEncodable(codePoint)) return null;
  for (const spec of FALLBACKS) {
    if (inRanges(codePoint, spec.coverage)) return spec;
  }
  return null; // nothing bundled covers it — see unsupportedScripts()
}

/** Whether this text has to be drawn in a bundled font to come out right. */
export function needsUnicodeFont(text: string): boolean {
  for (const char of text) {
    if (!isStandardEncodable(char.codePointAt(0)!)) return true;
  }
  return false;
}

/** A string as it will be drawn, so the export knows which faces to embed. */
export interface StyledText {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export function styleKey(bold?: boolean, italic?: boolean): FontStyle {
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

/** A face the document needs: which styles, and which family to draw it from. */
export interface RequiredFace {
  styles: Set<FontStyle>;
  /** The chosen variant's key — only CJK has a choice to make. */
  variant: string;
}

/** Which fallback faces are needed, in which styles — empty for a Latin script. */
export type RequiredFaces = Map<string, RequiredFace>;

/**
 * Pick the family a face is drawn from, for the one face that has a choice.
 *
 * The first variant is the default and the others are taken in order, so a
 * document with both kana and hangul in it lands on whichever is declared
 * first rather than on something arbitrary.
 */
function chooseVariant(spec: FallbackSpec, text: string): string {
  for (const variant of spec.variants) {
    if (!variant.markers) continue;
    for (const char of text) {
      if (inRanges(char.codePointAt(0)!, variant.markers)) return variant.key;
    }
  }
  return spec.variants[0].key;
}

export function requiredUnicodeFaces(drawn: StyledText[]): RequiredFaces {
  const required: RequiredFaces = new Map();
  // Only the text that reached a face with a choice to make, so deciding which
  // CJK family a document is in does not mean re-walking all of it.
  const samples = new Map<string, string[]>();

  for (const item of drawn) {
    if (!item.text) continue;
    const style = styleKey(item.bold, item.italic);
    for (const char of item.text) {
      const spec = specFor(char.codePointAt(0)!);
      if (!spec) continue;
      let face = required.get(spec.id);
      if (!face) {
        required.set(spec.id, (face = { styles: new Set(), variant: spec.variants[0].key }));
        if (spec.variants.length > 1) samples.set(spec.id, []);
      }
      face.styles.add(style);
      samples.get(spec.id)?.push(char);
    }
  }

  for (const [id, chars] of samples) {
    const spec = FALLBACKS.find((candidate) => candidate.id === id);
    const face = required.get(id);
    if (spec && face) face.variant = chooseVariant(spec, chars.join(''));
  }

  return required;
}

/**
 * The scripts in `drawn` that no bundled face can write, named.
 *
 * Without this such a script exports in silence: `specFor` finds nothing, the
 * built-in faces take the text, and the page comes back blank or mangled with
 * nothing said — the very failure that bundling fonts was meant to end, just
 * one script further out. Every name is reported once.
 */
export function unsupportedScripts(drawn: StyledText[]): string[] {
  const names = new Set<string>();
  let other = false;

  for (const item of drawn) {
    if (!item.text) continue;
    for (const char of item.text) {
      const codePoint = char.codePointAt(0)!;
      if (isStandardEncodable(codePoint) || specFor(codePoint)) continue;
      const known = UNSUPPORTED_SCRIPTS.find(([range]) => inRanges(codePoint, [range]));
      if (known) names.add(known[1]);
      else other = true;
    }
  }

  const found = [...names];
  if (other) found.push('an unsupported script');
  return found;
}

// ── Getting the bytes ───────────────────────────────────────────────────────

/** Font bytes, base64 for jsPDF's VFS. */
const fontCache = new Map<string, string>();

/**
 * Where a fetched font is kept between sessions.
 *
 * The in-memory map alone means a writer who exports Hindi every morning
 * re-reads the font every morning; for a bundled 16 kB face that is a local
 * read and nobody notices, but a remote CJK family is 5–10 MB over the
 * network, and paying that twice would be indefensible. The Cache API keeps it
 * per machine instead.
 *
 * Every use is wrapped: `caches` is absent in Node (where the tests run), and
 * a browser can refuse it in a private window or when site data is blocked.
 * A cache that cannot be opened is not an error — it just means the fetch is
 * the only copy.
 */
const CACHE_NAME = 'opendraft-export-fonts-v1';

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null;
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** How a long download is reported while it runs. */
export interface FontProgress {
  /** What is being fetched, as the writer would name it. */
  label: string;
  /** Bytes in so far, and the total when the server declared one. */
  loaded: number;
  total?: number;
}

export type ProgressHandler = (progress: FontProgress) => void;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // fromCharCode is applied to the chunk; a whole font overflows the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Read a response, reporting progress as it arrives.
 *
 * A bundled font is a local read and reports nothing worth showing; a remote
 * CJK family takes long enough that saying nothing reads as a hang.
 */
async function readWithProgress(
  response: Response,
  label: string,
  onProgress?: ProgressHandler,
): Promise<Uint8Array> {
  // Nothing here needs a complete Response — only its bytes.  A length it did
  // not declare, or a body that cannot be streamed, costs the progress
  // reporting and nothing else.
  if (!onProgress || typeof response.body?.getReader !== 'function') {
    return new Uint8Array(await response.arrayBuffer());
  }

  const declared = Number(response.headers?.get?.('content-length')) || undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ label, loaded, total: declared });
  }

  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

async function fetchFont(
  url: string,
  label: string,
  onProgress?: ProgressHandler,
): Promise<string | null> {
  const cached = fontCache.get(url);
  if (cached) return cached;

  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const base64 = toBase64(new Uint8Array(await hit.arrayBuffer()));
        fontCache.set(url, base64);
        return base64;
      }
    } catch {
      // A cache that cannot be read is simply a cache miss.
    }
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    // The response can only be read once, so the copy for the cache is taken
    // before this one is consumed.
    const forCache = cache ? response.clone() : null;
    const bytes = await readWithProgress(response, label, onProgress);
    const base64 = toBase64(bytes);
    fontCache.set(url, base64);
    if (cache && forCache) {
      // Storing is best-effort: a full quota must not fail an export whose
      // font is already in hand.
      cache.put(url, forCache).catch(() => {});
    }
    return base64;
  } catch {
    return null; // no fallback available — the caller keeps to the built-in faces
  }
}

// ── Embedding ───────────────────────────────────────────────────────────────

/** An embedded fallback, once it is in the document and ready to be drawn in. */
export interface UnicodeFont {
  id: string;
  /**
   * Character spacing that stretches the face to Final Draft's cell, exactly as
   * the exporter does for Courier.  Zero for a proportional face, which has no
   * cell to be stretched to.
   */
  charSpace: number;
  /** Whether widths come from the character count or have to be measured. */
  monospace: boolean;
  /** Whether this face can write the code point. */
  covers(codePoint: number): boolean;
  /** The text as this face needs it ordered, which for Latin scripts is as it is. */
  shape(text: string): string;
}

/** The fallback faces a document ended up with. */
export interface UnicodeFallbacks {
  /** True when the script needed none — the common, Latin case. */
  readonly none: boolean;
  /**
   * The faces this script needed and did not get, named for the writer.
   *
   * A font that will not load is the one failure this module cannot absorb:
   * the text has no other face to go to, so it is drawn with nothing and the
   * page comes out blank exactly where the writer was looking. The export
   * still happens — a script is not worth losing over a font — but the caller
   * has to say so rather than hand over a file with holes in it.
   */
  readonly missing: readonly string[];
  /** Scripts no face covers at all, named — see unsupportedScripts(). */
  readonly unsupported: readonly string[];
  /** The embedded face that has to write this code point, or null. */
  faceFor(codePoint: number): UnicodeFont | null;
}

export const NO_FALLBACKS: UnicodeFallbacks = {
  none: true, missing: [], unsupported: [], faceFor: () => null,
};

/**
 * Embed one face for the styles given, and return how to draw in it — or null
 * if its files could not be loaded, leaving the export to fall back on the
 * built-in faces as it did before.
 *
 * A style the family hasn't got, or whose file is missing, is registered with
 * the regular weight rather than left undefined, so a bold Devanagari scene
 * heading is still legible text instead of a jsPDF lookup error.
 */
async function embedOne(
  pdf: jsPDF,
  spec: FallbackSpec,
  variant: FaceVariant,
  styles: Set<FontStyle>,
  fdCharWidthPt: number,
  onProgress?: ProgressHandler,
): Promise<UnicodeFont | null> {
  // Progress is only worth showing for a face coming over the network; a
  // bundled one is read faster than the message could be looked at.
  const report = spec.remote ? onProgress : undefined;
  const regular = variant.files.normal
    ? await fetchFont(variant.files.normal, variant.label, report)
    : null;
  if (!regular) return null;

  const register = async (style: FontStyle) => {
    const url = variant.files[style];
    const data = (url && style !== 'normal' ? await fetchFont(url, variant.label, report) : null)
      || regular;
    const vfsName = `${spec.id}-${style}.ttf`;
    pdf.addFileToVFS(vfsName, data);
    pdf.addFont(vfsName, spec.id, style);
  };

  for (const style of styles) await register(style);
  // 'normal' backs any style that was not asked for but is reached anyway.
  if (!styles.has('normal')) await register('normal');

  let charSpace = 0;
  if (spec.monospace) {
    const previousFont = pdf.getFont();
    pdf.setFont(spec.id, 'normal');
    charSpace = fdCharWidthPt - pdf.getTextWidth('M');
    pdf.setFont(previousFont.fontName, previousFont.fontStyle);
  }

  return {
    id: spec.id,
    charSpace,
    monospace: spec.monospace,
    covers: (codePoint) => inRanges(codePoint, spec.coverage),
    shape: spec.shape ?? ((text) => text),
  };
}

/**
 * Embed every fallback face `required` asks for, and return the lookup the
 * exporter draws through.  A face that fails to load is left out; the rest of
 * the export is unaffected.
 */
export async function embedUnicodeFonts(
  pdf: jsPDF,
  required: RequiredFaces,
  fdCharWidthPt: number,
  options: { unsupported?: readonly string[]; onProgress?: ProgressHandler } = {},
): Promise<UnicodeFallbacks> {
  const unsupported = options.unsupported ?? [];
  if (required.size === 0) return { ...NO_FALLBACKS, unsupported };

  const faces: UnicodeFont[] = [];
  const missing: string[] = [];
  for (const spec of FALLBACKS) {
    const wanted = required.get(spec.id);
    if (!wanted) continue;
    const variant = spec.variants.find((candidate) => candidate.key === wanted.variant)
      ?? spec.variants[0];
    const face = await embedOne(
      pdf, spec, variant, wanted.styles, fdCharWidthPt, options.onProgress,
    );
    if (face) faces.push(face);
    else missing.push(variant.label);
  }
  if (faces.length === 0) return { ...NO_FALLBACKS, missing, unsupported };

  return {
    none: false,
    missing,
    unsupported,
    faceFor(codePoint: number) {
      if (isStandardEncodable(codePoint)) return null;
      return faces.find((face) => face.covers(codePoint)) ?? null;
    },
  };
}

/** A piece of a string that is drawn in one face. */
export interface FaceSegment {
  text: string;
  /** The fallback it must be drawn in, or null for the run's own face. */
  fallback: UnicodeFont | null;
}

/**
 * Split `text` into the pieces each face has to draw.
 *
 * A character the built-in faces cannot write goes to whichever bundled face
 * can.  One they can stays where it is — unless a fallback is already open and
 * can write it too, in which case it stays in that face rather than starting a
 * new piece.  That stickiness is what keeps a Cyrillic sentence, spaces and
 * full stops included, one continuous run of DejaVu, and a Hindi one a
 * continuous run of Noto with its own word spacing.
 */
export function segmentByFace(text: string, fallbacks: UnicodeFallbacks): FaceSegment[] {
  if (fallbacks.none || !needsUnicodeFont(text)) return [{ text, fallback: null }];

  const segments: FaceSegment[] = [];
  let current: FaceSegment | null = null;

  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    let fallback = fallbacks.faceFor(codePoint);
    if (!fallback && current?.fallback?.covers(codePoint)) fallback = current.fallback;

    if (current && current.fallback === fallback) current.text += char;
    else segments.push((current = { text: char, fallback }));
  }

  return segments;
}

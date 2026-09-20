/**
 * Writing something other than Latin into an exported PDF.
 *
 * jsPDF draws in the PDF Standard 14 faces, and those are WinAnsi-encoded:
 * outside that repertoire there is simply no byte to write.  jsPDF does not
 * refuse; it switches the whole string to two-byte UTF-16 and a reader, still
 * reading WinAnsi, prints one Latin character per byte.  A Cyrillic script
 * came out as `" ' B > C B 5 1 O` — the low bytes of its own code points.
 *
 * The fix is a real embedded font, and which one depends on the script.  Two
 * are bundled in `public/fonts`:
 *
 *   - **DejaVu Sans Mono** for Cyrillic, Greek, Armenian and Georgian.  It is
 *     monospaced on the same cell as Courier, so a script that switches to it
 *     keeps every Final Draft indent, centring and page break it had before.
 *   - **Noto Sans Devanagari** for Hindi, Marathi, Nepali and anything else
 *     written in the Devanagari block (issue #128).  DejaVu has no Devanagari
 *     at all, so this text used to reach a face with nothing to draw it with
 *     and vanish from the page entirely — not mangled, absent.  No monospaced
 *     Devanagari face exists, so this one is drawn at its own advances; it is
 *     narrower than the cell the layout reserved, so it fits inside the margins
 *     the script was paginated to.
 *
 * Text is split by face character by character, so a Latin word inside a Hindi
 * line stays on Courier's cell instead of being dragged into a proportional
 * face with it.  The split is sticky: once in a fallback, text stays there for
 * as long as that face can write it, which is what keeps a Cyrillic sentence
 * one continuous piece of DejaVu rather than a mosaic of it and Courier.
 *
 * jsPDF embeds only the glyphs a document actually uses, so a Latin script that
 * never reaches this module carries neither font.
 */
import type jsPDF from 'jspdf';
import { reorderDevanagari } from './devanagari';

/**
 * The jsPDF font ids the fallbacks are registered under — and, because jsPDF
 * writes the id as the /BaseFont, the names a reader shows for them.
 */
export const UNICODE_FONT_ID = 'DejaVuSansMono';
export const DEVANAGARI_FONT_ID = 'NotoSansDevanagari';

export type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

/** A half-open range of code points, inclusive at both ends. */
type Range = readonly [number, number];

function inRanges(codePoint: number, ranges: readonly Range[]): boolean {
  for (const [lo, hi] of ranges) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** One of the bundled fallback faces, and what it is good for. */
interface FallbackSpec {
  id: string;
  files: Partial<Record<FontStyle, string>>;
  /** The code points this face's subset actually carries. */
  coverage: readonly Range[];
  /**
   * Whether the face sits on Final Draft's fixed cell.  A monospaced one is
   * stretched to it and measured by character count; a proportional one is
   * drawn and measured at its own advances.
   */
  monospace: boolean;
  /** Reordering the script needs before it can be drawn — see utils/devanagari. */
  shape?: (text: string) => string;
}

/**
 * Narrowest coverage first: Devanagari and DejaVu overlap only on characters
 * either could write, and the script-specific face should get them.
 */
const FALLBACKS: readonly FallbackSpec[] = [
  {
    id: DEVANAGARI_FONT_ID,
    files: {
      normal: '/fonts/NotoSansDevanagari-Regular.ttf',
      bold: '/fonts/NotoSansDevanagari-Bold.ttf',
    },
    // The Devanagari block, the joiners that spell conjuncts, the rupee sign,
    // the dotted circle a lone matra is shown on, and the two spaces — so a
    // Hindi line keeps its own word spacing instead of Courier's.
    coverage: [[0x0900, 0x097f], [0x200c, 0x200d], [0x20b9, 0x20b9],
      [0x25cc, 0x25cc], [0x0020, 0x0020], [0x00a0, 0x00a0]],
    monospace: false,
    shape: reorderDevanagari,
  },
  {
    id: UNICODE_FONT_ID,
    files: {
      normal: '/fonts/DejaVuSansMono-Regular.ttf',
      bold: '/fonts/DejaVuSansMono-Bold.ttf',
      italic: '/fonts/DejaVuSansMono-Italic.ttf',
      bolditalic: '/fonts/DejaVuSansMono-BoldItalic.ttf',
    },
    // The blocks the bundled subset was cut to — see public/fonts/README.md.
    coverage: [[0x0000, 0x02ff], [0x0370, 0x058f], [0x10a0, 0x10ff],
      [0x1e00, 0x1eff], [0x2000, 0x206f], [0x20a0, 0x20bf],
      [0x2100, 0x214f], [0x2190, 0x2193], [0x2212, 0x2212]],
    monospace: true,
  },
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
  return null; // nothing bundled covers it; the built-ins get it and do their worst
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

/** Which fallback faces are needed, in which styles — empty for a Latin script. */
export type RequiredFaces = Map<string, Set<FontStyle>>;

export function requiredUnicodeFaces(drawn: StyledText[]): RequiredFaces {
  const required: RequiredFaces = new Map();
  for (const item of drawn) {
    if (!item.text) continue;
    const style = styleKey(item.bold, item.italic);
    for (const char of item.text) {
      const spec = specFor(char.codePointAt(0)!);
      if (!spec) continue;
      let styles = required.get(spec.id);
      if (!styles) required.set(spec.id, (styles = new Set()));
      styles.add(style);
    }
  }
  return required;
}

/** Font bytes, base64 for jsPDF's VFS. Fetched once per session, not per export. */
const fontCache = new Map<string, string>();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // fromCharCode is applied to the chunk; a whole font overflows the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchFont(url: string): Promise<string | null> {
  const cached = fontCache.get(url);
  if (cached) return cached;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const base64 = toBase64(new Uint8Array(await response.arrayBuffer()));
    fontCache.set(url, base64);
    return base64;
  } catch {
    return null; // no fallback available — the caller keeps to the built-in faces
  }
}

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
  /** The embedded face that has to write this code point, or null. */
  faceFor(codePoint: number): UnicodeFont | null;
}

export const NO_FALLBACKS: UnicodeFallbacks = { none: true, faceFor: () => null };

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
  styles: Set<FontStyle>,
  fdCharWidthPt: number,
): Promise<UnicodeFont | null> {
  const regular = spec.files.normal ? await fetchFont(spec.files.normal) : null;
  if (!regular) return null;

  const register = async (style: FontStyle) => {
    const url = spec.files[style];
    const data = (url && style !== 'normal' ? await fetchFont(url) : null) || regular;
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
): Promise<UnicodeFallbacks> {
  if (required.size === 0) return NO_FALLBACKS;

  const faces: UnicodeFont[] = [];
  for (const spec of FALLBACKS) {
    const styles = required.get(spec.id);
    if (!styles) continue;
    const face = await embedOne(pdf, spec, styles, fdCharWidthPt);
    if (face) faces.push(face);
  }
  if (faces.length === 0) return NO_FALLBACKS;

  return {
    none: false,
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

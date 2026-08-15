/**
 * Writing Cyrillic — and Greek, Armenian, Georgian — into an exported PDF.
 *
 * jsPDF draws in the PDF Standard 14 faces, and those are WinAnsi-encoded:
 * outside that repertoire there is simply no byte to write.  jsPDF does not
 * refuse; it switches the whole string to two-byte UTF-16 and a reader, still
 * reading WinAnsi, prints one Latin character per byte.  A Cyrillic script
 * came out as `" ' B > C B 5 1 O` — the low bytes of its own code points.
 *
 * The fix is a real embedded font.  Any text the Standard 14 cannot encode is
 * drawn in DejaVu Sans Mono instead, subset and bundled in `public/fonts`.  It
 * is monospaced on the same cell as Courier, so a script that switches to it
 * keeps every Final Draft indent, centring and page break it had before.
 *
 * jsPDF embeds only the glyphs a document actually uses, so a Latin script
 * that never reaches this module carries none of it.
 */
import type jsPDF from 'jspdf';

/**
 * The jsPDF font id the fallback is registered under — and, because jsPDF
 * writes the id as the /BaseFont, the name a reader shows for it.
 */
export const UNICODE_FONT_ID = 'DejaVuSansMono';

export type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

const FONT_FILES: Record<FontStyle, string> = {
  normal: '/fonts/DejaVuSansMono-Regular.ttf',
  bold: '/fonts/DejaVuSansMono-Bold.ttf',
  italic: '/fonts/DejaVuSansMono-Italic.ttf',
  bolditalic: '/fonts/DejaVuSansMono-BoldItalic.ttf',
};

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

/** Whether this text has to be drawn in the embedded font to come out right. */
export function needsUnicodeFont(text: string): boolean {
  for (const char of text) {
    if (!isStandardEncodable(char.codePointAt(0)!)) return true;
  }
  return false;
}

/** A string as it will be drawn, so the export knows which styles to embed. */
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

/** The styles the fallback is needed in — empty when the script is Latin. */
export function requiredUnicodeStyles(drawn: StyledText[]): Set<FontStyle> {
  const styles = new Set<FontStyle>();
  for (const item of drawn) {
    if (item.text && needsUnicodeFont(item.text)) styles.add(styleKey(item.bold, item.italic));
  }
  return styles;
}

/** Font bytes, base64 for jsPDF's VFS. Fetched once per session, not per export. */
const fontCache = new Map<FontStyle, string>();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // fromCharCode is applied to the chunk; a whole font overflows the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fetchFont(style: FontStyle): Promise<string | null> {
  const cached = fontCache.get(style);
  if (cached) return cached;
  try {
    const response = await fetch(FONT_FILES[style]);
    if (!response.ok) return null;
    const base64 = toBase64(new Uint8Array(await response.arrayBuffer()));
    fontCache.set(style, base64);
    return base64;
  } catch {
    return null; // no fallback available — the caller keeps to the built-in faces
  }
}

/** The embedded fallback, once it is in the document and ready to be drawn in. */
export interface UnicodeFont {
  id: string;
  /**
   * Character spacing that stretches the face to Final Draft's cell, exactly as
   * the exporter does for Courier.
   */
  charSpace: number;
}

/**
 * Embed the fallback in `pdf` for the styles given, and return how to draw in
 * it — or null if the font could not be loaded, leaving the export to fall
 * back on the built-in faces as it did before.
 *
 * A style whose file is missing is registered with the regular weight rather
 * than left undefined, so a bold Cyrillic scene heading is still legible text
 * instead of a jsPDF lookup error.
 */
export async function embedUnicodeFont(
  pdf: jsPDF,
  styles: Set<FontStyle>,
  fdCharWidthPt: number,
): Promise<UnicodeFont | null> {
  if (styles.size === 0) return null;

  const regular = await fetchFont('normal');
  if (!regular) return null;

  for (const style of styles) {
    const data = style === 'normal' ? regular : (await fetchFont(style)) || regular;
    const vfsName = `${UNICODE_FONT_ID}-${style}.ttf`;
    pdf.addFileToVFS(vfsName, data);
    pdf.addFont(vfsName, UNICODE_FONT_ID, style);
  }
  // 'normal' backs any style that was not asked for but is reached anyway.
  if (!styles.has('normal')) {
    const vfsName = `${UNICODE_FONT_ID}-normal.ttf`;
    pdf.addFileToVFS(vfsName, regular);
    pdf.addFont(vfsName, UNICODE_FONT_ID, 'normal');
  }

  const previousFont = pdf.getFont();
  pdf.setFont(UNICODE_FONT_ID, 'normal');
  const charSpace = fdCharWidthPt - pdf.getTextWidth('M');
  pdf.setFont(previousFont.fontName, previousFont.fontStyle);

  return { id: UNICODE_FONT_ID, charSpace };
}

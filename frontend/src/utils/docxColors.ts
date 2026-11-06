/**
 * Text colour and highlight, in both directions between the editor and Word.
 *
 * The editor keeps a run's colour on the `textStyle` mark and its highlight on
 * the (multicolour) `highlight` mark, both as CSS colours — usually `#rrggbb`
 * from the pickers, but pasted text brings `rgb()` and short hex too. Word
 * wants six bare hex digits.
 *
 * A highlight is written as run shading (`<w:shd w:fill>`), not `<w:highlight>`:
 * Word's highlight is a fixed list of sixteen named colours and the editor's
 * highlighter takes any colour, so shading is the only way to keep the one the
 * writer picked. Word, LibreOffice and Google Docs all draw run shading as a
 * background behind the text. Reading a file back accepts both forms (#226).
 */
import { parseCssColor } from './inkColor';

/** `#ff0000`, `rgb(255, 0, 0)`, `#f00` → `FF0000`; null when unparseable. */
export function cssToDocxHex(css: string | null | undefined): string | null {
  if (typeof css !== 'string' || !css.trim()) return null;
  const rgb = parseCssColor(css);
  if (!rgb) return null;
  return rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** A Word hex value (`FF0000`, `ff0000`) → `#ff0000`; null for `auto` or junk. */
export function docxHexToCss(val: string | null | undefined): string | null {
  if (typeof val !== 'string') return null;
  const v = val.trim();
  if (!/^[0-9a-f]{6}$/i.test(v)) return null;
  return `#${v.toLowerCase()}`;
}

/** The sixteen colours `<w:highlight w:val>` can name, as ECMA-376 defines them. */
const WORD_HIGHLIGHT_HEX: Record<string, string> = {
  black: '000000',
  blue: '0000FF',
  cyan: '00FFFF',
  green: '00FF00',
  magenta: 'FF00FF',
  red: 'FF0000',
  yellow: 'FFFF00',
  white: 'FFFFFF',
  darkblue: '000080',
  darkcyan: '008080',
  darkgreen: '008000',
  darkmagenta: '800080',
  darkred: '800000',
  darkyellow: '808000',
  darkgray: '808080',
  lightgray: 'C0C0C0',
};

/** `<w:highlight w:val="yellow">` → `#ffff00`; null for `none` or an unknown name. */
export function wordHighlightToCss(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const hex = WORD_HIGHLIGHT_HEX[name.trim().toLowerCase()];
  return hex ? `#${hex.toLowerCase()}` : null;
}

/**
 * The `TextRun` options that carry a run's colour and highlight.
 *
 * Spread into the options of every run built from editor text. A colour that
 * does not parse is left out rather than failing the export — the text is
 * still written, just in the document's ink.
 */
export function docxColorProps(run: { color?: string; highlight?: string }): {
  color?: string;
  shading?: { type: 'clear'; color: 'auto'; fill: string };
} {
  const out: { color?: string; shading?: { type: 'clear'; color: 'auto'; fill: string } } = {};
  const color = cssToDocxHex(run.color);
  if (color) out.color = color;
  const fill = cssToDocxHex(run.highlight);
  if (fill) out.shading = { type: 'clear', color: 'auto', fill };
  return out;
}

/**
 * Text colour and highlight, in both directions between the editor and Word.
 *
 * The editor keeps a run's colour on the `textStyle` mark and its highlight on
 * the (multicolour) `highlight` mark, both as CSS colours — usually `#rrggbb`
 * from the pickers, but pasted text brings `rgb()` and short hex too. Word
 * wants six bare hex digits.
 *
 * A highlight is written one of two ways. By default it is a real Word
 * highlight (`<w:highlight>`), in whichever of Word's named colours is closest
 * to the one the writer picked — Word's highlighter only knows that fixed list,
 * and only a real highlight is something it can remove, recolour or find. A
 * writer who would rather keep the exact shade can export highlights as run
 * shading (`<w:shd w:fill>`) instead, which takes any colour but which Word
 * treats as shading, not a highlight: its "No Color" leaves it alone. Reading a
 * file back accepts both forms (#226).
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

/**
 * The colours a picked highlight is matched against, by hue, with the dark and
 * light variant of each. White is left out: a white highlight is no highlight.
 */
/** Word's highlight names as the `docx` library spells them (its `HighlightColor`). */
export type WordHighlightName =
  | 'black' | 'blue' | 'cyan' | 'green' | 'magenta' | 'red' | 'yellow'
  | 'darkBlue' | 'darkCyan' | 'darkGreen' | 'darkMagenta' | 'darkRed' | 'darkYellow'
  | 'darkGray' | 'lightGray';

const HUED_HIGHLIGHTS: { hue: number; bright: WordHighlightName; dark: WordHighlightName }[] = [
  { hue: 0, bright: 'red', dark: 'darkRed' },
  { hue: 60, bright: 'yellow', dark: 'darkYellow' },
  { hue: 120, bright: 'green', dark: 'darkGreen' },
  { hue: 180, bright: 'cyan', dark: 'darkCyan' },
  { hue: 240, bright: 'blue', dark: 'darkBlue' },
  { hue: 300, bright: 'magenta', dark: 'darkMagenta' },
];

/**
 * The Word highlight colour closest to a CSS colour, as the `docx` library
 * names it (`yellow`, `darkCyan` …); null for white, near-white or junk.
 *
 * Matched by hue rather than by plain colour distance, because a highlighter
 * is mostly picked in light, washed-out shades: by distance a pale yellow
 * (`#ffe599`) or a sky blue (`#66ccff`) is nearer Word's light grey than its
 * yellow or cyan, which is not what the writer meant. Saturation decides
 * between a colour and a grey, and brightness between the bright and the dark
 * variant.
 */
export function nearestWordHighlight(css: string | null | undefined): WordHighlightName | null {
  if (typeof css !== 'string' || !css.trim()) return null;
  const rgb = parseCssColor(css);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.15) {
    if (max >= 0.9) return null;
    if (max >= 0.65) return 'lightGray';
    if (max >= 0.3) return 'darkGray';
    return 'black';
  }
  const d = max - min;
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue < 0) hue += 360;
  let best = HUED_HIGHLIGHTS[0];
  let bestGap = Infinity;
  for (const c of HUED_HIGHLIGHTS) {
    const raw = Math.abs(hue - c.hue);
    const gap = Math.min(raw, 360 - raw);
    if (gap < bestGap) { best = c; bestGap = gap; }
  }
  return max >= 0.65 ? best.bright : best.dark;
}

/** `<w:highlight w:val="yellow">` → `#ffff00`; null for `none` or an unknown name. */
export function wordHighlightToCss(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const hex = WORD_HIGHLIGHT_HEX[name.trim().toLowerCase()];
  return hex ? `#${hex.toLowerCase()}` : null;
}

/** How a highlight is written to Word — see the comment at the top. */
export interface DocxHighlightOptions {
  /** Shading in the exact colour, rather than Word's nearest named highlight. */
  exactHighlights?: boolean;
}

type DocxRunColors = {
  color?: string;
  highlight?: WordHighlightName;
  shading?: { type: 'clear'; color: 'auto'; fill: string };
};

/**
 * The `TextRun` options that carry a run's colour and highlight.
 *
 * Spread into the options of every run built from editor text. A colour that
 * does not parse is left out rather than failing the export — the text is
 * still written, just in the document's ink.
 */
export function docxColorProps(
  run: { color?: string; highlight?: string },
  options: DocxHighlightOptions = {},
): DocxRunColors {
  const out: DocxRunColors = {};
  const color = cssToDocxHex(run.color);
  if (color) out.color = color;
  if (options.exactHighlights) {
    const fill = cssToDocxHex(run.highlight);
    if (fill) out.shading = { type: 'clear', color: 'auto', fill };
  } else {
    const named = nearestWordHighlight(run.highlight);
    if (named) out.highlight = named;
  }
  return out;
}

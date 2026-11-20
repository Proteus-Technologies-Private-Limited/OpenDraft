/**
 * Script font size — how large the whole script is set.
 *
 * The page is laid out on Final Draft's grid: 12pt Courier, 10.33 characters
 * to the inch, six lines to the inch. A script set at another size is laid out
 * on the same grid scaled by `size / 12`: a character is that much wider, so
 * fewer fit on a line, and a line is that much taller, so fewer fit on a page.
 * Both the editor's pagination and the PDF read the scale from here, so the page
 * count on screen is the page count in the file (#270).
 *
 * The size lives in `PageLayout.fontSize`, so it is saved with the script like
 * the margins are. Absent means the standard 12pt.
 */

/** The size the grid is drawn for. */
export const BASE_FONT_PT = 12;
/** The smallest and largest sizes a script can be set at. */
export const MIN_SCRIPT_FONT_PT = 6;
export const MAX_SCRIPT_FONT_PT = 96;

/** A layout's script font size, made safe to lay out with. */
export function scriptFontSize(layout: { fontSize?: number } | null | undefined): number {
  const size = layout?.fontSize;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return BASE_FONT_PT;
  return Math.min(MAX_SCRIPT_FONT_PT, Math.max(MIN_SCRIPT_FONT_PT, size));
}

/** How much larger than the standard grid the script is drawn; 1 at 12pt. */
export function fontScaleOf(layout: { fontSize?: number } | null | undefined): number {
  return scriptFontSize(layout) / BASE_FONT_PT;
}

/**
 * Characters the screen fits in one inch at 12pt: 96px over the 9.29px a
 * Courier Prime character is drawn at once the editor's letter-spacing trim is
 * applied. The 10.33 the layout is specified in is this rounded, and rounding
 * it twice (here, then once more for the line width) put a scaled line a
 * character short of what the browser fits.
 */
const SCREEN_CPI = 96 / 9.29;

/**
 * Characters to a line at this scale, from the count at 12pt.
 *
 * Exactly `cpl` at scale 1, so a script at the standard size paginates as it
 * always has. Otherwise measured from the line's width in inches rather than
 * scaled from the rounded count: 36 columns of dialogue at 14pt is 31 on screen,
 * not the 30 that 36 / 1.1667 rounds down to.
 */
export function scaledCpl(cpl: number, scale: number, widthIn?: number): number {
  if (scale === 1) return cpl;
  const columns = widthIn === undefined ? cpl : widthIn * SCREEN_CPI;
  // The epsilon keeps an exact fit (31.0000…) from landing a hair under.
  return Math.max(1, Math.floor(columns / scale + 1e-6));
}

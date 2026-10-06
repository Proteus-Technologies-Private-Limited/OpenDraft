/**
 * Telling "this colour is just ink" from "this colour means something".
 *
 * Templates and pasted text very often carry an explicit black — the template
 * editor's colour picker starts at #000000, and Word and Google Docs put
 * `color:#000000` on everything they copy. On white paper that is invisible as
 * a choice; on a dark page (View → Theme → Dark Pages) it is black text on
 * near-black. A colour this close to black is treated as "the page's ink", and
 * one this close to white as "the page's paper", so both follow the page. Real
 * colours — a red, a navy — are left exactly as chosen.
 */

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
};

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() / rgba(), black, white. */
export function parseCssColor(css: string): [number, number, number] | null {
  const s = css.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) {
    return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  }
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/.exec(s);
  if (m) {
    const rgb = [m[1], m[2], m[3]].map(Number);
    if (rgb.every((v) => v <= 255)) return rgb as [number, number, number];
  }
  return null;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** How far a colour is from grey: the spread between its channels. */
function chroma([r, g, b]: [number, number, number]): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/** A grey up to about #383838 — reads as plain black on paper. A very dark
 *  navy or burgundy is a choice, not ink, so it has to be grey as well. */
export function isNearBlack(css: string | null | undefined): boolean {
  if (!css) return false;
  const rgb = parseCssColor(css);
  return !!rgb && chroma(rgb) <= 24 && relativeLuminance(rgb) <= 0.04;
}

/** A grey from about #eeeeee — reads as plain white paper. A pale yellow or
 *  pink is a deliberate tint and stays. */
export function isNearWhite(css: string | null | undefined): boolean {
  if (!css) return false;
  const rgb = parseCssColor(css);
  return !!rgb && chroma(rgb) <= 12 && relativeLuminance(rgb) >= 0.85;
}

/** A text colour for a page element: near-black becomes the page's ink. */
export function pageInk(css: string): string {
  return isNearBlack(css) ? 'var(--page-ink)' : css;
}

/** A background for a page element: near-white becomes the page's paper. */
export function pagePaper(css: string): string {
  return isNearWhite(css) ? 'var(--page-paper)' : css;
}

/**
 * Putting viewport coordinates into a page's own coordinate space.
 *
 * Anything the app draws over the script — the stand-in caret, the selection
 * handles — is an absolutely positioned child of `.page`, so it has to be
 * placed in that element's *unscaled* coordinates. ProseMirror answers in
 * viewport coordinates, which are scaled: the editor is zoomed by a transform
 * on an ancestor, and at 150% a caret placed straight from `coordsAtPos` sits
 * half a page away from the text it belongs to.
 *
 * The conversion is a measurement rather than a calculation, so nothing here
 * has to know how the page is being scaled, by which ancestor, or whether the
 * writer has changed it since.
 */

/** The parts of the page element this needs; an interface so tests can stub it. */
export interface ScaledPage {
  offsetWidth: number;
  getBoundingClientRect(): { left: number; top: number; width: number };
}

/** A viewport rectangle, as ProseMirror's `coordsAtPos` returns one. */
export interface ViewportRect {
  left: number;
  top: number;
  bottom: number;
}

/** A viewport rectangle with all four edges, as `getClientRects` returns them. */
export interface ViewportBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A rectangle in the page's unscaled coordinate space. */
export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A point in the page's unscaled coordinate space. */
export interface PagePoint {
  left: number;
  top: number;
  height: number;
}

/**
 * The scale an ancestor is painting `page` at: painted width over layout
 * width. 1 when nothing is scaling it.
 *
 * Null when the answer cannot be trusted — a page not laid out yet has no
 * width to divide by, and dividing anyway yields Infinity or NaN.
 */
export function pageScale(page: ScaledPage): number | null {
  return scaleOf(page.offsetWidth, page.getBoundingClientRect().width);
}

/**
 * The same division, over a width already measured — so a caller that needs
 * the rectangle as well as the scale can read the element once instead of
 * twice. `toPagePoint` is called for each end of a selection on every frame of
 * a handle drag, and each of those was two forced layouts rather than one.
 */
function scaleOf(offsetWidth: number, paintedWidth: number): number | null {
  if (offsetWidth <= 0) return null;
  const scale = paintedWidth / offsetWidth;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return scale;
}

/**
 * `rect`, in viewport coordinates, expressed relative to `page` and undone of
 * whatever scale the page is drawn at.
 *
 * The height has a floor: a collapsed rectangle — which is what an empty line
 * can measure — would otherwise give a caret or a handle no height at all, and
 * nothing to see or to grab.
 */
export function toPagePoint(page: ScaledPage, rect: ViewportRect): PagePoint | null {
  const bounds = page.getBoundingClientRect();
  const scale = scaleOf(page.offsetWidth, bounds.width);
  if (scale === null) return null;
  return {
    left: (rect.left - bounds.left) / scale,
    top: (rect.top - bounds.top) / scale,
    height: Math.max(8, (rect.bottom - rect.top) / scale),
  };
}

/**
 * `box`, in viewport coordinates, as a rectangle in the page's own space.
 *
 * The same conversion `toPagePoint` does, for the bands that stand in for a
 * selection highlight the system has stopped painting. No height floor: unlike
 * a caret, a band of no height is a line with nothing on it, and drawing it
 * 8px tall would put a stripe under an empty line.
 */
export function toPageRect(page: ScaledPage, box: ViewportBox): PageRect | null {
  const bounds = page.getBoundingClientRect();
  const scale = scaleOf(page.offsetWidth, bounds.width);
  if (scale === null) return null;
  return {
    left: (box.left - bounds.left) / scale,
    top: (box.top - bounds.top) / scale,
    width: (box.right - box.left) / scale,
    height: (box.bottom - box.top) / scale,
  };
}

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
  if (page.offsetWidth <= 0) return null;
  const scale = page.getBoundingClientRect().width / page.offsetWidth;
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
  const scale = pageScale(page);
  if (scale === null) return null;
  const bounds = page.getBoundingClientRect();
  return {
    left: (rect.left - bounds.left) / scale,
    top: (rect.top - bounds.top) / scale,
    height: Math.max(8, (rect.bottom - rect.top) / scale),
  };
}

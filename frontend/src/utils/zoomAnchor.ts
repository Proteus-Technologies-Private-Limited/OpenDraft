/**
 * Keeping the writer's place across a zoom (issue #156).
 *
 * Scaling scrollTop by new/old zoom only holds while zoom is a pure scale of
 * the sheet. In the phone view zoom sets the line length, so the text reflows
 * and the script's height changes by no fixed ratio — the old arithmetic sent
 * the writer from page 17 to page 9 and back out to page 30. It also kept the
 * top of the screen still rather than the point being pinched.
 *
 * So the place is held by content instead: the element under the focal point,
 * and how far down it the point fell. After the zoom, the scroll is moved until
 * that same spot is back under the same point on screen, whatever the reflow.
 */

export interface ZoomAnchor {
  /** The top-level editor element (a ProseMirror child) under the focal point. */
  el: Element;
  /** How far down that element the focal point fell, 0 at its top, 1 at its bottom. */
  frac: number;
  /** The focal point's distance from the top of the scroll container, in screen px. */
  offsetY: number;
}

/**
 * The top-level child of `root` whose box spans `y` (viewport coordinates), or
 * the nearest one when `y` falls in a gap or beyond either end. Children of a
 * ProseMirror root are laid out top to bottom, so this is a binary search —
 * a long script has thousands of them.
 */
export function childAtY(root: Element, y: number): Element | null {
  const children = root.children;
  const n = children.length;
  if (n === 0) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = children[mid].getBoundingClientRect();
    if (y < r.top) hi = mid;
    else if (y > r.bottom) lo = mid + 1;
    else return children[mid];
  }
  return children[lo];
}

/**
 * Record what sits under `focusY` (viewport coordinates) in `container`.
 * Defaults to the middle of the visible area when no focal point is given.
 */
export function captureZoomAnchor(
  container: HTMLElement,
  root: Element,
  focusY?: number,
): ZoomAnchor | null {
  const box = container.getBoundingClientRect();
  if (box.height <= 0) return null;
  const y = focusY !== undefined && focusY >= box.top && focusY <= box.bottom
    ? focusY
    : box.top + box.height / 2;
  const el = childAtY(root, y);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const frac = r.height > 0 ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0;
  return { el, frac, offsetY: y - box.top };
}

/**
 * Scroll `container` so the anchored spot is back where it was on screen.
 * Returns false when the anchor no longer applies (its element was removed).
 */
export function restoreZoomAnchor(container: HTMLElement, anchor: ZoomAnchor): boolean {
  if (!anchor.el.isConnected || !container.contains(anchor.el)) return false;
  const box = container.getBoundingClientRect();
  const r = anchor.el.getBoundingClientRect();
  const nowY = r.top + anchor.frac * r.height - box.top;
  const delta = nowY - anchor.offsetY;
  if (Math.abs(delta) >= 0.5) container.scrollTop += delta;
  return true;
}

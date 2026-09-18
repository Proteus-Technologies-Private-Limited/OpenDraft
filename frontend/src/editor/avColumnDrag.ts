/**
 * The arithmetic behind dragging an AV column divider.
 *
 * Kept out of the node view so it can be tested without a layout engine: the
 * view supplies the measurements it read off the DOM, this decides what the
 * widths become.
 *
 * Column widths are stored as relative units (`fr`), not pixels, because the
 * same body has to lay out on screen, on US Letter and on A4 — see
 * `gridTemplateFor`. So a drag measured in pixels has to be converted, and the
 * conversion is the whole of the problem here.
 */
import {
  visibleColumns,
  AV_MIN_COLUMN_WIDTH,
  AV_MAX_COLUMN_WIDTH,
  type AvColumnConfig,
  type AvColumnKey,
} from './extensions/AvBlock';

/**
 * Clamp a width a drag produced.
 *
 * Saturating, unlike `clampColumnWidth`: a column dragged past zero pins at the
 * minimum and stays there. `clampColumnWidth` answers 1 for anything at or
 * below zero, which is the right reading of a malformed stored attribute but
 * would make a column being squeezed to nothing snap to a middling width
 * instead — the divider jumping backwards under a pointer still moving
 * forwards.
 */
function clampDragWidth(n: number): number {
  if (!Number.isFinite(n)) return AV_MIN_COLUMN_WIDTH;
  return Math.min(Math.max(n, AV_MIN_COLUMN_WIDTH), AV_MAX_COLUMN_WIDTH);
}

/** One used track width, as a computed `grid-template-columns` writes it. */
const PX_TOKEN = /^-?(?:\d+\.?\d*|\.\d+)px$/;

/** A draggable divider, named by the two columns it sits between. */
export interface AvBoundary {
  id: string;
  left: AvColumnKey;
  right: AvColumnKey;
}

/**
 * Every divider the grid can show, in track order.
 *
 * All three are rendered for every row whatever the column config says, and
 * avScript.css both places and hides them from the block's own `data-cue` /
 * `data-image`. That is the same rule the cue gutter follows: a child node view
 * must not decide its own DOM from its parent's attributes, because the two
 * re-render independently and a divider on the wrong track line is worse than
 * no divider at all.
 */
export const AV_BOUNDARIES: readonly AvBoundary[] = [
  { id: 'cue-video', left: 'cue', right: 'video' },
  { id: 'video-audio', left: 'video', right: 'audio' },
  { id: 'audio-image', left: 'audio', right: 'image' },
] as const;

/** What the view measured off the row when the drag started. */
export interface AvDragMetrics {
  /** Total width the grid tracks share, in px — the row less its gaps. */
  totalPx: number;
}

/**
 * How many `fr` one pixel of pointer travel is worth.
 *
 * The visible tracks share the row's width, so the ratio of their total `fr` to
 * their total px is the exchange rate. Returns 0 when there is nothing to
 * measure against, which makes every drag a no-op rather than a division by
 * zero that sends a column to Infinity.
 */
export function frPerPixel(cfg: AvColumnConfig, metrics: AvDragMetrics): number {
  if (!(metrics.totalPx > 0)) return 0;
  const totalFr = visibleColumns(cfg).reduce((sum, key) => sum + cfg.widths[key], 0);
  if (totalFr <= 0) return 0;
  return totalFr / metrics.totalPx;
}

/**
 * The widths a drag of `deltaPx` across `boundary` produces.
 *
 * The two columns either side trade width; every other column is left exactly
 * as it was, so dragging one divider cannot shuffle the rest of the body.
 *
 * Both ends are clamped independently, which means a drag that pins one column
 * at its limit stops moving the other too — the alternative is a divider that
 * keeps sliding while only one side of it responds, which reads as the handle
 * having come loose from the line it is dragging.
 */
export function widthsAfterDrag(
  cfg: AvColumnConfig,
  boundary: AvBoundary,
  deltaPx: number,
  metrics: AvDragMetrics,
): Partial<AvColumnConfig['widths']> | null {
  const rate = frPerPixel(cfg, metrics);
  if (rate === 0) return null;
  const deltaFr = deltaPx * rate;
  const left = clampDragWidth(cfg.widths[boundary.left] + deltaFr);
  const right = clampDragWidth(cfg.widths[boundary.right] - deltaFr);
  // Whichever side hit its limit first decides how far the pair actually moved,
  // so the divider never claims travel the columns did not make.
  const movedLeft = left - cfg.widths[boundary.left];
  const movedRight = cfg.widths[boundary.right] - right;
  const moved = Math.abs(movedLeft) < Math.abs(movedRight) ? movedLeft : movedRight;
  if (moved === 0) return null;
  return {
    [boundary.left]: clampDragWidth(cfg.widths[boundary.left] + moved),
    [boundary.right]: clampDragWidth(cfg.widths[boundary.right] - moved),
  };
}

/**
 * How much width the tracks of `rowEl` have between them.
 *
 * Two sources, in order of preference:
 *
 *   1. `grid-template-columns` from the computed style. On a **rendered** grid
 *      this computes to the list of USED pixel values, which is the only place
 *      the real width of a `minmax()` or `fr` track can be had — the stored
 *      config says `0.5fr` and the cue column may well be sitting on its 64px
 *      floor instead.
 *   2. The row's own content box, less the gaps between the tracks. Which is
 *      the same number by definition, and does not depend on the computed value
 *      being the used one — it is the *specified* value (`minmax(64px, 0.5fr)
 *      2fr 2fr`) for a row that is not being laid out, and parsing that as
 *      pixels would put the exchange rate out by two orders of magnitude and
 *      send the first pixel of travel straight to the clamp.
 *
 * The two are told apart by SHAPE, not by count: a used-value list is entirely
 * `<number>px` tokens, one per visible column. Counting parseable numbers is not
 * enough — `minmax(64px, 0.5fr) 2fr 2fr` splits into four tokens of which three
 * parse as finite (0.5, 2, 2), which is the right count and completely the
 * wrong number.
 */
export function measureRow(rowEl: Element | null, columnCount: number): AvDragMetrics {
  if (!rowEl || typeof getComputedStyle !== 'function') return { totalPx: 0 };
  try {
    const style = getComputedStyle(rowEl);
    const tokens = (style.gridTemplateColumns || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === columnCount && tokens.every((t) => PX_TOKEN.test(t))) {
      const sum = tokens.reduce((total, t) => total + parseFloat(t), 0);
      if (sum > 0) return { totalPx: sum };
    }
    const gap = parseFloat(style.columnGap) || 0;
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const width = rowEl.getBoundingClientRect().width;
    return { totalPx: Math.max(0, width - padding - gap * Math.max(0, columnCount - 1)) };
  } catch {
    // A detached row. There is nothing to drag against.
    return { totalPx: 0 };
  }
}

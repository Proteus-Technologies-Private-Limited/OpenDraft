import { useEffect, useState } from 'react';
import { readSafeAreaInsets, type SafeAreaInsets } from '../utils/safeAreaInsets';

const FAB_SIZE = 36;
/** A side inset at least this wide is a status column the button fits inside. */
const STATUS_COLUMN_MIN = FAB_SIZE + 8;
/** Gap between the button and the bottom safe area in the status column. */
const BOTTOM_GAP = 12;

export interface FoldedMenuPosition {
  x: number;
  y: number;
  /**
   * The button sits inside the side status column (the iPhone Duo's cover
   * screen keeps its clock and status in a column down one edge). The caller
   * must then not clamp it out of the safe area, which is the whole point.
   */
  inStatusBar: boolean;
  /**
   * The side status column, when the screen has one the button fits in —
   * whether or not the button is in it. A drag that ends over it snaps the
   * button back in (statusColumnX), so it can be put back after moving it out.
   */
  statusColumn: StatusColumn | null;
}

export interface StatusColumn {
  side: 'left' | 'right';
  /** Left and right edges of the column in viewport px. */
  start: number;
  end: number;
  /** Left of the button centred in the column. */
  buttonX: number;
}

/**
 * The column-centred x for a button whose left edge is at `x`, when its centre
 * is over the status column; null when it is not, so it is placed as dragged.
 */
export function statusColumnX(x: number, column: StatusColumn | null): number | null {
  if (!column) return null;
  const centre = x + FAB_SIZE / 2;
  return centre >= column.start && centre <= column.end ? column.buttonX : null;
}

/**
 * Where the ☰ button goes on a folded foldable: inside a side status column
 * when there is one wide enough (the cover's status column has room to spare
 * below the clock, off the script and the toolbar; the button sits at its foot),
 * otherwise just under the toolbar on the right, as the design specifies.
 */
export function foldedMenuPosition(inset: SafeAreaInsets, viewport: { width: number; height: number }, toolbarBottom: number): FoldedMenuPosition {
  const side = inset.right >= STATUS_COLUMN_MIN ? 'right' : inset.left >= STATUS_COLUMN_MIN ? 'left' : null;
  if (side) {
    const width = side === 'right' ? inset.right : inset.left;
    const start = side === 'right' ? viewport.width - width : 0;
    const x = Math.round(start + (width - FAB_SIZE) / 2);
    const statusColumn: StatusColumn = { side, start, end: start + width, buttonX: x };
    // At the foot of the column, above the home indicator: in easy reach of
    // the thumb and well clear of the clock and status icons at its head.
    const y = Math.round(viewport.height - inset.bottom - FAB_SIZE - BOTTOM_GAP);
    return { x, y, inStatusBar: true, statusColumn };
  }
  return { x: Math.max(0, viewport.width - FAB_SIZE - 12), y: toolbarBottom + 10, inStatusBar: false, statusColumn: null };
}

/** Default spot for the ☰ button when a foldable is folded (Hidden mode). */
export function useFoldedMenuPosition(folded: boolean, navWidth: number): FoldedMenuPosition {
  const [position, setPosition] = useState<FoldedMenuPosition>({ x: navWidth + 14, y: 10, inStatusBar: false, statusColumn: null });
  useEffect(() => {
    if (!folded) return;
    const toolbar = document.querySelector('.toolbar');
    const measure = () => setPosition(foldedMenuPosition(
      readSafeAreaInsets(),
      { width: window.innerWidth, height: window.innerHeight },
      toolbar?.getBoundingClientRect().bottom ?? 52,
    ));
    const observer = new ResizeObserver(measure);
    if (toolbar) observer.observe(toolbar);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [folded]);
  return folded ? position : { x: navWidth + 14, y: 10, inStatusBar: false, statusColumn: null };
}

import { useEffect, useState } from 'react';
import { readSafeAreaInsets, type SafeAreaInsets } from '../utils/safeAreaInsets';

const FAB_SIZE = 36;
/** A side inset at least this wide is a status column the button fits inside. */
const STATUS_COLUMN_MIN = FAB_SIZE + 8;

export interface FoldedMenuPosition {
  x: number;
  y: number;
  /**
   * The button sits inside the side status column (the iPhone Duo's cover
   * screen keeps its clock and status in a column down one edge). The caller
   * must then not clamp it out of the safe area, which is the whole point.
   */
  inStatusBar: boolean;
}

/**
 * Where the ☰ button goes on a folded foldable: inside a side status column
 * when there is one wide enough (the cover's status column has room to spare
 * below the clock, off the script and the toolbar, centred for the thumb),
 * otherwise just under the toolbar on the right, as the design specifies.
 */
export function foldedMenuPosition(inset: SafeAreaInsets, viewport: { width: number; height: number }, toolbarBottom: number): FoldedMenuPosition {
  const side = inset.right >= STATUS_COLUMN_MIN ? 'right' : inset.left >= STATUS_COLUMN_MIN ? 'left' : null;
  if (side) {
    const column = side === 'right' ? inset.right : inset.left;
    const x = side === 'right' ? viewport.width - column + (column - FAB_SIZE) / 2 : (column - FAB_SIZE) / 2;
    return { x: Math.round(x), y: Math.round((viewport.height - FAB_SIZE) / 2), inStatusBar: true };
  }
  return { x: Math.max(0, viewport.width - FAB_SIZE - 12), y: toolbarBottom + 10, inStatusBar: false };
}

/** Default spot for the ☰ button when a foldable is folded (Hidden mode). */
export function useFoldedMenuPosition(folded: boolean, navWidth: number): FoldedMenuPosition {
  const [position, setPosition] = useState<FoldedMenuPosition>({ x: navWidth + 14, y: 10, inStatusBar: false });
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
  return folded ? position : { x: navWidth + 14, y: 10, inStatusBar: false };
}

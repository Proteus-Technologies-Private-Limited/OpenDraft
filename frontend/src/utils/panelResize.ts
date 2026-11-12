/** Physical arrow movement of a sidebar's inner edge, mirrored for RTL chrome. */
export function panelResize(width: number, key: string, side: 'left' | 'right', rtl = false): number | null {
  const min = side === 'left' ? 160 : 200;
  const max = side === 'left' ? 500 : 600;
  if (key === 'Home') return min;
  if (key === 'End') return max;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const direction = (side === 'left' ? 1 : -1) * (rtl ? -1 : 1);
  return Math.max(min, Math.min(max, width + (key === 'ArrowRight' ? 10 : -10) * direction));
}

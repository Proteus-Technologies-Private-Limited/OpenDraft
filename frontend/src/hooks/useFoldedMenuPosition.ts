import { useEffect, useState } from 'react';

/** Measure the real toolbar bottom, including native safe-area padding. */
export function useFoldedMenuPosition(folded: boolean, navWidth: number) {
  const [position, setPosition] = useState({ x: navWidth + 14, y: 10 });
  useEffect(() => {
    if (!folded) return;
    const toolbar = document.querySelector('.toolbar');
    const measure = () => setPosition({
      x: Math.max(0, window.innerWidth - 36 - 12),
      y: (toolbar?.getBoundingClientRect().bottom ?? 52) + 10,
    });
    const observer = new ResizeObserver(measure);
    if (toolbar) observer.observe(toolbar);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [folded]);
  return folded ? position : { x: navWidth + 14, y: 10 };
}

/**
 * A caret for a textarea, for the same reason PencilCaret exists.
 *
 * iPadOS paints a caret in a web view only while the software keyboard is up.
 * The handwriting sheet deliberately keeps it down — that is the point of
 * writing with a Pencil — so the field is focused and typing lands correctly
 * with nothing on screen to show where.
 *
 * A textarea offers no way to ask where its caret is, so this measures it: a
 * hidden div is given the field's own metrics and the text up to the caret, and
 * a marker span at the end of that text lands exactly where the caret would.
 * It is the long-standing way to do this, and it is exact because the mirror is
 * laid out by the same engine with the same font, width and wrapping.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface TextareaCaretProps {
  /** The field to draw a caret for. */
  areaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Current value — the caret moves whenever this or the selection does. */
  value: string;
  /** Off on desktop, where the platform draws its own. */
  enabled: boolean;
}

/** Properties the mirror has to match for its layout to agree with the field. */
const MIRRORED: (keyof CSSStyleDeclaration)[] = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
  'lineHeight', 'textTransform', 'textIndent', 'whiteSpace', 'wordBreak',
  'overflowWrap', 'tabSize',
];

const TextareaCaret: React.FC<TextareaCaretProps> = ({ areaRef, value, enabled }) => {
  const [box, setBox] = useState<{ left: number; top: number; height: number } | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const area = areaRef.current;
    if (!enabled || !area || document.activeElement !== area) { setBox(null); return; }
    // A range shows itself by highlight; a caret is only for a collapsed one.
    if (area.selectionStart !== area.selectionEnd) { setBox(null); return; }

    try {
      let mirror = mirrorRef.current;
      if (!mirror) {
        mirror = document.createElement('div');
        mirror.setAttribute('aria-hidden', 'true');
        mirror.style.position = 'absolute';
        mirror.style.visibility = 'hidden';
        mirror.style.top = '0';
        mirror.style.left = '-9999px';
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.overflowWrap = 'break-word';
        document.body.appendChild(mirror);
        mirrorRef.current = mirror;
      }

      const cs = getComputedStyle(area);
      for (const prop of MIRRORED) {
        // @ts-expect-error indexing a CSSStyleDeclaration by a known key
        mirror.style[prop] = cs[prop];
      }
      mirror.style.height = 'auto';

      const upto = value.slice(0, area.selectionStart ?? 0);
      mirror.textContent = upto;
      const marker = document.createElement('span');
      // A zero-width space, so an empty line and a trailing newline still give
      // the marker a box to be measured.
      marker.textContent = '​';
      mirror.appendChild(marker);

      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      // The marker's offset is inside the mirror, which stands in for the
      // field's own box; the caret is positioned against the wrapper, so the
      // field's position within it has to be added or the caret sits adrift by
      // the margin.
      setBox({
        left: area.offsetLeft + marker.offsetLeft - area.scrollLeft,
        top: area.offsetTop + marker.offsetTop - area.scrollTop,
        height: Math.max(8, lineHeight),
      });
    } catch {
      setBox(null);
    }
  }, [areaRef, value, enabled]);

  const schedule = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { frame.current = null; measure(); });
  }, [measure]);

  useEffect(() => {
    if (!enabled) return;
    const area = areaRef.current;
    if (!area) return;

    document.addEventListener('selectionchange', schedule);
    area.addEventListener('scroll', schedule, { passive: true });
    area.addEventListener('focus', schedule);
    area.addEventListener('blur', schedule);
    window.addEventListener('resize', schedule);

    schedule();
    return () => {
      document.removeEventListener('selectionchange', schedule);
      area.removeEventListener('scroll', schedule);
      area.removeEventListener('focus', schedule);
      area.removeEventListener('blur', schedule);
      window.removeEventListener('resize', schedule);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [areaRef, enabled, schedule]);

  // Re-measure whenever the text changes, not just the selection.
  useEffect(() => { if (enabled) schedule(); }, [value, enabled, schedule]);

  useEffect(() => () => {
    mirrorRef.current?.remove();
    mirrorRef.current = null;
  }, []);

  if (!box) return null;
  return (
    <div
      className="pencil-caret scribble-caret"
      aria-hidden="true"
      style={{ left: box.left, top: box.top, height: box.height }}
    />
  );
};

export default TextareaCaret;

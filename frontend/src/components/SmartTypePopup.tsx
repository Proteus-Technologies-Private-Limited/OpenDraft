/**
 * The SmartType popup: the list of completions offered for the block being
 * typed (editor/smartType decides what goes in it).
 *
 * It only draws and handles keys; it does not know whether the items are
 * character names, locations or transitions. Arrow keys move, Escape dismisses,
 * and a click outside dismisses too. Enter or Tab accepts: at once for a
 * character cue, and only after an arrow key for a location or transition, so
 * those keys keep moving the writer on until they step into the list.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { smartTypeKeyAction } from '../editor/smartType';

interface SmartTypePopupProps {
  position: { top: number; left: number };
  suggestions: string[];
  /** Scene headings and transitions require an arrow key before Enter/Tab. */
  requireNavigation?: boolean;
  onSelect: (item: string) => void;
  onDismiss: () => void;
}

const SmartTypePopup: React.FC<SmartTypePopupProps> = ({
  position, suggestions, requireNavigation = false, onSelect, onDismiss,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Adjust position to stay within viewport. A ref callback measures once the
  // element exists; the parent remounts the popup when its position changes.
  const [adjustedPos, setAdjustedPos] = useState(position);
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    menuRef.current = el;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { top, left } = position;
    if (top + rect.height > window.innerHeight - 8) {
      top = position.top - rect.height - 20;
    }
    if (left + rect.width > window.innerWidth - 8) {
      left = window.innerWidth - rect.width - 8;
    }
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    setAdjustedPos({ top, left });
  }, [position]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (suggestions.length === 0) return;

    // Only intercept keys when focus is in the editor, not in other panels
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const action = smartTypeKeyAction(requireNavigation, navigated, e.key);
    if (action === 'pass') return;

    e.preventDefault();
    e.stopPropagation();
    if (action === 'down') {
      setNavigated(true);
      setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (action === 'up') {
      setNavigated(true);
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (action === 'accept') {
      onSelect(suggestions[selectedIndex]);
    } else {
      onDismiss();
    }
  }, [selectedIndex, suggestions, requireNavigation, navigated, onSelect, onDismiss]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // Click outside to dismiss
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onDismiss]);

  if (suggestions.length === 0) return null;

  return (
    <div
      className="smarttype-popup"
      ref={measureRef}
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
    >
      {suggestions.map((item, i) => (
        <div
          key={item}
          ref={el => { itemRefs.current[i] = el; }}
          className={`smarttype-popup-item${i === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          {item}
        </div>
      ))}
    </div>
  );
};

export default SmartTypePopup;

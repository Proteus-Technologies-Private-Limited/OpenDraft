import React, { useEffect, useRef, useState, useCallback } from 'react';

interface CharacterAutocompleteProps {
  position: { top: number; left: number };
  suggestions: string[];
  onSelect: (name: string) => void;
  onDismiss: () => void;
}

const CharacterAutocomplete: React.FC<CharacterAutocompleteProps> = ({
  position, suggestions, onSelect, onDismiss,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Reset selection when suggestions change
  useEffect(() => { setSelectedIndex(0); }, [suggestions]);

  // Scroll selected item into view
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Adjust position to stay within viewport
  const [adjustedPos, setAdjustedPos] = useState(position);
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
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
  }, [position, suggestions]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (suggestions.length === 0) return;

    // Only intercept keys when focus is in the editor, not in other panels
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Tab':
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        onSelect(suggestions[selectedIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
        break;
      // All other keys pass through to the editor naturally
    }
  }, [selectedIndex, suggestions, onSelect, onDismiss]);

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
      className="character-autocomplete"
      ref={menuRef}
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
    >
      {suggestions.map((name, i) => (
        <div
          key={name}
          ref={el => { itemRefs.current[i] = el; }}
          className={`character-autocomplete-item${i === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(name); }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          {name}
        </div>
      ))}
    </div>
  );
};

export default CharacterAutocomplete;

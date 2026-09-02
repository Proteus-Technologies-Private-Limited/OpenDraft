import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ELEMENT_LABELS, type ElementType } from '../stores/editorStore';
import { ELEMENT_DESCRIPTIONS } from '../stores/formattingTypes';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';

// Context-aware element ordering: most likely choices first per current type
// The two non-printing elements sit at the end of every list: they are
// structure, not script, so they should never be the first thing offered.
const OUTLINE_TYPES: ElementType[] = ['section', 'note'];

const ELEMENT_ORDER: Record<string, ElementType[]> = {
  sceneHeading: ['action', 'character', 'general', 'transition', 'shot', 'sceneHeading', 'dialogue', 'parenthetical', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  action:       ['action', 'character', 'dialogue', 'general', 'sceneHeading', 'transition', 'shot', 'parenthetical', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  character:    ['dialogue', 'parenthetical', 'action', 'character', 'general', 'sceneHeading', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  dialogue:     ['action', 'character', 'general', 'dialogue', 'parenthetical', 'sceneHeading', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  parenthetical:['dialogue', 'action', 'character', 'general', 'parenthetical', 'sceneHeading', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  transition:   ['sceneHeading', 'action', 'transition', 'general', 'character', 'dialogue', 'parenthetical', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  general:      ['general', 'action', 'character', 'dialogue', 'sceneHeading', 'transition', 'parenthetical', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  shot:         ['action', 'shot', 'character', 'general', 'sceneHeading', 'transition', 'dialogue', 'parenthetical', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  newAct:       ['sceneHeading', 'action', 'newAct', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  endOfAct:     ['newAct', 'sceneHeading', 'action', 'endOfAct', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'lyrics', 'showEpisode', 'castList'],
  lyrics:       ['lyrics', 'dialogue', 'action', 'character', 'general', 'sceneHeading', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'showEpisode', 'castList'],
  showEpisode:  ['action', 'sceneHeading', 'showEpisode', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'castList'],
  castList:     ['castList', 'action', 'character', 'general', 'sceneHeading', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode'],
  section:      ['action', 'sceneHeading', 'section', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  note:         ['action', 'note', 'sceneHeading', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
};
for (const [type, order] of Object.entries(ELEMENT_ORDER)) {
  ELEMENT_ORDER[type] = [...order, ...OUTLINE_TYPES.filter((t) => !order.includes(t))];
}

const DEFAULT_ORDER: ElementType[] = [
  'action', 'character', 'dialogue', 'general', 'sceneHeading', 'parenthetical',
  'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList',
  ...OUTLINE_TYPES,
];

interface ElementPickerProps {
  position: { top: number; left: number };
  defaultType: ElementType;
  /** When provided, overrides the template-derived element list (used inside AV cells). */
  availableTypes?: ElementType[];
  onSelect: (type: ElementType) => void;
  /**
   * "Never mind the type — just give me another blank line." (issue #100)
   * Absent when the menu was opened on a line that already has text, where a
   * blank line is not what any of these rows could mean: Enter then accepts
   * the highlighted row straight away, as an ordinary menu does.
   */
  onInsertBlankLine?: () => void;
  onDismiss: () => void;
}

const ElementPicker: React.FC<ElementPickerProps> = ({
  position, defaultType, availableTypes, onSelect, onInsertBlankLine, onDismiss,
}) => {
  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const orderedTypes = useMemo<ElementType[]>(
    () => {
      // Caller-supplied list (e.g. AV cell context) wins outright.
      if (availableTypes && availableTypes.length > 0) return availableTypes;
      const enabled = new Set(
        Object.values(activeTemplate.rules).filter((r) => r.enabled).map((r) => r.id),
      );
      return (ELEMENT_ORDER[defaultType] || DEFAULT_ORDER)
        .filter((t) => enabled.has(t));
    },
    [defaultType, activeTemplate, availableTypes],
  );

  // Resolve a display label: built-in label first, then template-rule label,
  // finally the raw id. Custom-element ids (avShot, sceneCharacters, etc.) only
  // have labels in the template rules.
  const labelFor = (type: ElementType): string =>
    ELEMENT_LABELS[type] || activeTemplate.rules[type]?.label || String(type);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Enter opened this menu, so Enter cannot also mean "accept the highlighted
  // row" — that left the writer no keystroke for "just another blank line"
  // (issue #100). Until an arrow key or the pointer picks a row, Enter still
  // means what it means everywhere else: insert a line.
  const [hasNavigated, setHasNavigated] = useState(!onInsertBlankLine);
  // Pointer hover is highlight only, never navigation: on iPad an Apple Pencil
  // hovering over the menu raises mouseenter without the writer choosing
  // anything, and that must not quietly turn Enter back into "accept".
  const [hoverIndex, setHoverIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  }, [position]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Only intercept keys when focus is in the editor (or body), not in other panels
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setHasNavigated(true);
        setHoverIndex(-1);
        setSelectedIndex(i => (hasNavigated ? Math.min(i + 1, orderedTypes.length - 1) : i));
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setHasNavigated(true);
        setHoverIndex(-1);
        setSelectedIndex(i => (hasNavigated ? Math.max(i - 1, 0) : i));
        break;
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        if (hasNavigated || !onInsertBlankLine) onSelect(orderedTypes[selectedIndex]);
        else onInsertBlankLine();
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
        break;
      default:
        // Any typing key dismisses the picker and passes through to editor
        onDismiss();
        break;
    }
  }, [selectedIndex, hasNavigated, orderedTypes, onSelect, onInsertBlankLine, onDismiss]);

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

  return (
    <div
      className="element-picker"
      ref={menuRef}
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
    >
      <div className="element-picker-header">Element Type</div>
      {orderedTypes.map((type, i) => {
        // The menu only opens on a blank line, so the row the line is already
        // on cannot mean "convert" — it means one more line of this element.
        // Say so, rather than leaving it to be discovered (issue #100).
        const hint = [
          type === defaultType && onInsertBlankLine ? 'blank line' : '',
          hasNavigated && i === selectedIndex ? '\u23CE' : '',
        ].filter(Boolean).join(' ');
        return (
        <div
          key={type}
          ref={el => { itemRefs.current[i] = el; }}
          className={`element-picker-item${(hasNavigated && i === selectedIndex) || i === hoverIndex ? ' selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(type); }}
          onMouseEnter={() => setHoverIndex(i)}
          onMouseLeave={() => setHoverIndex(h => (h === i ? -1 : h))}
          title={ELEMENT_DESCRIPTIONS[type]}
        >
          <span className="element-picker-label">{labelFor(type)}</span>
          {/* Always rendered, even empty: the hint column is reserved width, so
              a hint appearing or moving between rows never resizes the menu. */}
          <span className="element-picker-hint">{hint}</span>
        </div>
        );
      })}
      {onInsertBlankLine && (
        <div
          className="element-picker-blank"
          onMouseDown={(e) => { e.preventDefault(); onInsertBlankLine(); }}
          title="Add another blank line instead of changing the element type"
        >
          <span className="element-picker-label">Blank Line</span>
          <span className="element-picker-hint">{hasNavigated ? '' : '\u23CE'}</span>
        </div>
      )}
    </div>
  );
};

export default ElementPicker;

import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { ELEMENT_LABELS, NOTE_COLORS, type ElementType } from '../stores/editorStore';
import { useEditorStore } from '../stores/editorStore';

// Element types for the picker sheet
const ELEMENT_TYPES: ElementType[] = [
  'sceneHeading', 'action', 'character', 'dialogue', 'parenthetical',
  'transition', 'general', 'shot', 'newAct', 'endOfAct', 'lyrics',
  'showEpisode', 'castList',
];

// Context-aware ordering: most likely choices first
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
};

interface MobileAccessoryBarProps {
  editor: Editor;
  onOpenContextMenu: (position: { x: number; y: number }, savedSelection?: { from: number; to: number }) => void;
}

const MobileAccessoryBar: React.FC<MobileAccessoryBarProps> = ({ editor, onOpenContextMenu }) => {
  const [bottom, setBottom] = useState(0);
  const [visible, setVisible] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [currentElement, setCurrentElement] = useState<ElementType>('action');
  const barRef = useRef<HTMLDivElement>(null);

  const {
    scriptNotesOpen, toggleScriptNotes, addNote, setNoteFilter,
    tagsPanelOpen, toggleTagsPanel, setPendingTagSelection,
  } = useEditorStore();

  // Track current element type at cursor
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      try {
        const { $from } = editor.state.selection;
        const nodeType = $from.parent.type.name as ElementType;
        if (ELEMENT_LABELS[nodeType]) setCurrentElement(nodeType);
      } catch { /* ignore */ }
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  // Position bar above the virtual keyboard using visualViewport
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // When keyboard is up, visualViewport.height < window.innerHeight
      const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
      if (keyboardHeight > 100) {
        // Keyboard is visible
        setBottom(keyboardHeight);
        setVisible(true);
      } else {
        setVisible(false);
        setSheetOpen(false);
      }
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Also show when editor is focused (even if viewport hasn't caught up yet)
  useEffect(() => {
    if (!editor) return;
    const onFocus = () => {
      // Give the viewport a moment to adjust
      setTimeout(() => {
        const vv = window.visualViewport;
        if (vv) {
          const kbh = window.innerHeight - vv.height - vv.offsetTop;
          if (kbh > 100) { setBottom(kbh); setVisible(true); }
        }
      }, 300);
    };
    const onBlur = () => {
      // Delay to allow button taps in the bar to register
      setTimeout(() => {
        if (!barRef.current?.contains(document.activeElement)) {
          setVisible(false);
          setSheetOpen(false);
        }
      }, 200);
    };
    editor.on('focus', onFocus);
    editor.on('blur', onBlur);
    return () => { editor.off('focus', onFocus); editor.off('blur', onBlur); };
  }, [editor]);

  const handleElementSelect = useCallback((type: ElementType) => {
    editor.chain().focus().setNode(type).run();
    setSheetOpen(false);
  }, [editor]);

  const handleAddNote = useCallback(() => {
    const { from, to } = editor.state.selection;
    const $from = editor.state.doc.resolve(from);
    const hasSelection = from !== to;
    const anchorText = hasSelection
      ? editor.state.doc.textBetween(from, to, ' ')
      : editor.state.doc.textBetween($from.start(), $from.end(), ' ');

    const currentNodeType = $from.parent.type.name as ElementType;

    // Find scene
    let sceneId: string | null = null;
    let sceneIdx = 0;
    editor.state.doc.nodesBetween(0, from, (node) => {
      if (node.type.name === 'sceneHeading') { sceneId = `scene-${sceneIdx}`; sceneIdx++; }
      return true;
    });

    const contextLabel = $from.parent.textContent.trim().slice(0, 60);
    const defaultColor = NOTE_COLORS[0];
    const noteId = addNote({
      content: '',
      anchorText: anchorText.slice(0, 120),
      elementType: currentNodeType,
      contextLabel,
      color: defaultColor.name,
      sceneId,
    });

    const markFrom = hasSelection ? from : $from.start();
    const markTo = hasSelection ? to : $from.end();
    editor.chain().focus()
      .setTextSelection({ from: markFrom, to: markTo })
      .setMark('scriptNote', { noteId, color: defaultColor.hex })
      .run();

    setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId });
    if (!scriptNotesOpen) toggleScriptNotes();
  }, [editor, addNote, setNoteFilter, scriptNotesOpen, toggleScriptNotes]);

  const handleTag = useCallback(() => {
    const { from, to } = editor.state.selection;
    const $from = editor.state.doc.resolve(from);
    const hasSelection = from !== to;
    const selFrom = hasSelection ? from : $from.start();
    const selTo = hasSelection ? to : $from.end();
    const text = editor.state.doc.textBetween(selFrom, selTo, ' ');
    const currentNodeType = $from.parent.type.name as ElementType;

    let sceneId: string | null = null;
    let sceneIdx = 0;
    editor.state.doc.nodesBetween(0, selFrom, (node) => {
      if (node.type.name === 'sceneHeading') { sceneId = `scene-${sceneIdx}`; sceneIdx++; }
      return true;
    });

    setPendingTagSelection({ from: selFrom, to: selTo, text: text.slice(0, 80), elementType: currentNodeType, sceneId });
    if (!tagsPanelOpen) toggleTagsPanel();
  }, [editor, setPendingTagSelection, tagsPanelOpen, toggleTagsPanel]);

  const handleMore = useCallback(() => {
    const { from, to } = editor.state.selection;
    // Position the context menu at center-top of viewport
    const x = window.innerWidth / 2;
    const y = 80;
    const savedSel = from !== to ? { from, to } : undefined;
    onOpenContextMenu({ x, y }, savedSel);
  }, [editor, onOpenContextMenu]);

  if (!visible) return null;

  const orderedTypes = ELEMENT_ORDER[currentElement] || ELEMENT_TYPES;

  return (
    <>
      {/* Bottom sheet for element type picker */}
      {sheetOpen && (
        <div
          className="mob-acc-sheet-overlay"
          style={{ bottom: bottom + 44 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false);
          }}
        >
          <div className="mob-acc-sheet">
            <div className="mob-acc-sheet-header">Element Type</div>
            <div className="mob-acc-sheet-list">
              {orderedTypes.map((type) => (
                <button
                  key={type}
                  className={`mob-acc-sheet-item${currentElement === type ? ' active' : ''}`}
                  onPointerDown={(e) => { e.preventDefault(); handleElementSelect(type); }}
                >
                  {ELEMENT_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* The accessory bar */}
      <div
        ref={barRef}
        className="mob-acc-bar"
        style={{ bottom }}
      >
        {/* Element type — most prominent */}
        <button
          className="mob-acc-elem-btn"
          onPointerDown={(e) => { e.preventDefault(); setSheetOpen(!sheetOpen); }}
        >
          <span className="mob-acc-elem-label">{ELEMENT_LABELS[currentElement]}</span>
          <span className="mob-acc-elem-arrow">{sheetOpen ? '\u25BC' : '\u25B2'}</span>
        </button>

        <div className="mob-acc-sep" />

        {/* Script Note */}
        <button
          className="mob-acc-btn"
          onPointerDown={(e) => { e.preventDefault(); handleAddNote(); }}
          title="Add Script Note"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        </button>

        {/* Tag */}
        <button
          className="mob-acc-btn"
          onPointerDown={(e) => { e.preventDefault(); handleTag(); }}
          title="Tag"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
        </button>

        {/* More (...) — opens full context menu */}
        <button
          className="mob-acc-btn"
          onPointerDown={(e) => { e.preventDefault(); handleMore(); }}
          title="More"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      </div>
    </>
  );
};

export default MobileAccessoryBar;

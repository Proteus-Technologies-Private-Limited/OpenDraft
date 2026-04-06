import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';
import { ELEMENT_LABELS, NOTE_COLORS, type ElementType } from '../stores/editorStore';
import { useEditorStore } from '../stores/editorStore';
import { spellChecker } from '../editor/spellchecker';
import { spellCheckPluginKey } from '../editor/extensions/SpellCheck';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { getCurrentElementRule, getLockedFormatting } from '../utils/effectiveFormatting';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';
const shift = isMac ? '⇧' : 'Shift+';

// Element types shown in the submenu, with their shortcuts
const ELEMENT_MENU_ITEMS: { type: ElementType; shortcut: string }[] = [
  { type: 'sceneHeading', shortcut: `${mod}1` },
  { type: 'action', shortcut: `${mod}2` },
  { type: 'character', shortcut: `${mod}3` },
  { type: 'dialogue', shortcut: `${mod}4` },
  { type: 'parenthetical', shortcut: `${mod}5` },
  { type: 'transition', shortcut: `${mod}6` },
  { type: 'general', shortcut: `${mod}7` },
  { type: 'shot', shortcut: `${mod}8` },
  { type: 'newAct', shortcut: '' },
  { type: 'endOfAct', shortcut: '' },
  { type: 'lyrics', shortcut: '' },
  { type: 'showEpisode', shortcut: '' },
  { type: 'castList', shortcut: '' },
];

// Revision colors matching Final Draft production standard
const REVISION_COLORS = [
  'White', 'Blue', 'Pink', 'Yellow', 'Green',
  'Goldenrod', 'Buff', 'Salmon', 'Cherry',
  '2nd Blue', '2nd Pink', '2nd Yellow', '2nd Green',
];

interface SpellInfo {
  word: string;
  from: number;
  to: number;
  suggestions: string[];
}

interface ScriptContextMenuProps {
  editor: Editor;
  position: { x: number; y: number };
  spellInfo: SpellInfo | null;
  onClose: () => void;
  onOpenFormatPanel: () => void;
  /** Pre-captured selection from long-press (touch devices blur the editor before mounting). */
  overrideSelection?: { from: number; to: number };
}

const ScriptContextMenu: React.FC<ScriptContextMenuProps> = ({
  editor,
  position,
  spellInfo,
  onClose,
  onOpenFormatPanel,
  overrideSelection,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [elementSubOpen, setElementSubOpen] = useState(false);
  const [styleSubOpen, setStyleSubOpen] = useState(false);
  const [revisionSubOpen, setRevisionSubOpen] = useState(false);

  const {
    revisionMode, setRevisionMode, revisionColor, setRevisionColor,
    toggleScriptNotes, scriptNotesOpen, addNote, deleteNote, setNoteFilter,
    toggleCharacterProfiles, characterProfilesOpen,
    deleteTag, tagsPanelOpen, toggleTagsPanel, setPendingTagSelection, setEditingTagId,
  } = useEditorStore();

  // Per-attribute locking for the current element
  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const isEnforceMode = activeTemplate.mode === 'enforce';
  const rule = getCurrentElementRule(editor, activeTemplate);
  const locked = getLockedFormatting(rule, isEnforceMode);

  // Use overrideSelection (from long-press on touch) if available,
  // otherwise capture from editor state (desktop right-click).
  const selFrom = overrideSelection?.from ?? editor.state.selection.from;
  const selTo = overrideSelection?.to ?? editor.state.selection.to;
  const savedSelection = useRef({ from: selFrom, to: selTo, empty: selFrom === selTo });

  // Restore ProseMirror selection so editor commands work correctly.
  // Wrapped in try/catch — positions may be stale if the document changed.
  useEffect(() => {
    if (overrideSelection && overrideSelection.from !== overrideSelection.to) {
      try {
        const docSize = editor.state.doc.content.size;
        const from = Math.min(overrideSelection.from, docSize);
        const to = Math.min(overrideSelection.to, docSize);
        if (from < to) {
          const { TextSelection } = require('@tiptap/pm/state');
          const { tr } = editor.state;
          tr.setSelection(TextSelection.create(editor.state.doc, from, to));
          editor.view.dispatch(tr);
        }
      } catch (e) {
        console.warn('ScriptContextMenu: failed to restore selection', e);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safeSelFrom = Math.min(selFrom, editor.state.doc.content.size);
  const $from = editor.state.doc.resolve(safeSelFrom);
  const currentNodeType = $from.parent.type.name as ElementType;
  const hasSelection = !savedSelection.current.empty;

  // Context-sensitive: show dual dialogue for character/dialogue/parenthetical
  const showDualDialogue = ['character', 'dialogue', 'parenthetical'].includes(currentNodeType);
  // Context-sensitive: show scene properties for scene headings
  const showSceneProps = currentNodeType === 'sceneHeading';
  // Context-sensitive: show character profile for character/dialogue/parenthetical
  const showCharProfile = ['character', 'dialogue', 'parenthetical'].includes(currentNodeType);

  // Detect if cursor is on an existing script note
  const existingNoteId = (() => {
    const markType = editor.schema.marks.scriptNote;
    if (!markType) return null;
    const pos = editor.state.selection.$from;
    const storedMarks = pos.marks();
    let noteMark = storedMarks.find((m) => m.type === markType);
    if (!noteMark) {
      const node = pos.nodeAfter || pos.nodeBefore;
      if (node?.marks) {
        noteMark = node.marks.find((m) => m.type === markType);
      }
    }
    return noteMark ? (noteMark.attrs.noteId as string) : null;
  })();

  // Detect if cursor is on an existing production tag
  const existingTagInfo = (() => {
    const markType = editor.schema.marks.productionTag;
    if (!markType) return null;
    const pos = editor.state.selection.$from;
    // Check storedMarks first, then marks on the text node at this position
    const storedMarks = pos.marks();
    let tagMark = storedMarks.find((m) => m.type === markType);
    if (!tagMark) {
      // Check the text node at this position directly
      const node = pos.nodeAfter || pos.nodeBefore;
      if (node?.marks) {
        tagMark = node.marks.find((m) => m.type === markType);
      }
    }
    return tagMark ? { tagId: tagMark.attrs.tagId as string, categoryId: tagMark.attrs.categoryId as string } : null;
  })();

  // Close on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport
  const [adjustedPos, setAdjustedPos] = useState(position);
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    if (x + rect.width > window.innerWidth - 8) {
      x = window.innerWidth - rect.width - 8;
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = window.innerHeight - rect.height - 8;
    }
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    setAdjustedPos({ x, y });
  }, [position]);

  const triggerSpellRecheck = useCallback(() => {
    const { tr } = editor.state;
    tr.setMeta(spellCheckPluginKey, { toggle: false });
    editor.view.dispatch(tr);
    requestAnimationFrame(() => {
      const tr2 = editor.state.tr;
      tr2.setMeta(spellCheckPluginKey, { toggle: true });
      editor.view.dispatch(tr2);
    });
  }, [editor]);

  // ── Action handlers ──

  const handleUndo = () => { editor.chain().focus().undo().run(); onClose(); };
  const handleRedo = () => { editor.chain().focus().redo().run(); onClose(); };

  const handleCut = () => {
    editor.commands.focus();
    document.execCommand('cut');
    onClose();
  };
  const handleCopy = () => {
    editor.commands.focus();
    document.execCommand('copy');
    onClose();
  };
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(text).run();
    } catch {
      editor.commands.focus();
      document.execCommand('paste');
    }
    onClose();
  };
  const handlePasteWithoutFormatting = async () => {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(text).run();
    } catch {
      editor.commands.focus();
      document.execCommand('paste');
    }
    onClose();
  };

  const handleSelectAll = () => { editor.chain().focus().selectAll().run(); onClose(); };
  const handleDelete = () => {
    if (hasSelection) {
      editor.chain().focus().deleteSelection().run();
    }
    onClose();
  };

  const handleSetElement = (type: ElementType) => {
    editor.chain().focus().setNode(type).run();
    onClose();
  };

  const handleBold = () => { editor.chain().focus().toggleBold().run(); onClose(); };
  const handleItalic = () => { editor.chain().focus().toggleItalic().run(); onClose(); };
  const handleUnderline = () => { editor.chain().focus().toggleUnderline().run(); onClose(); };
  const handleStrike = () => { editor.chain().focus().toggleStrike().run(); onClose(); };
  const handleSubscript = () => { editor.chain().focus().toggleSubscript().run(); onClose(); };
  const handleSuperscript = () => { editor.chain().focus().toggleSuperscript().run(); onClose(); };
  const handleAllCaps = () => {
    // Toggle all caps on selection by transforming the text
    if (!hasSelection) { onClose(); return; }
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to);
    const isUpper = text === text.toUpperCase();
    const newText = isUpper ? text.toLowerCase() : text.toUpperCase();
    editor.chain().focus().command(({ tr }) => {
      tr.insertText(newText, from, to);
      return true;
    }).run();
    onClose();
  };

  /** Derive a meaningful context label from the element under cursor */
  const deriveContextLabel = (): string => {
    const text = $from.parent.textContent.trim();
    switch (currentNodeType) {
      case 'character':
        // Strip extensions like (CONT'D), (V.O.) etc.
        return text.replace(/\s*\([^)]*\)\s*/g, '').trim();
      case 'sceneHeading':
        return text;
      case 'dialogue':
      case 'parenthetical': {
        // Walk backwards to find the owning character name
        let charName = '';
        const doc = editor.state.doc;
        const pos = $from.before($from.depth);
        doc.nodesBetween(0, pos, (node) => {
          if (node.type.name === 'character') {
            charName = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').trim();
          }
          return true;
        });
        return charName || text.slice(0, 40);
      }
      default:
        return text.slice(0, 60);
    }
  };

  const handleAddScriptNote = () => {
    const { from, to } = savedSelection.current;
    const anchorText = hasSelection
      ? editor.state.doc.textBetween(from, to, ' ')
      : editor.state.doc.textBetween(
          $from.start(),
          $from.end(),
          ' ',
        );

    // Determine which scene this text belongs to (find nearest sceneHeading above)
    let sceneId: string | null = null;
    let sceneIdx = 0;
    editor.state.doc.nodesBetween(0, from, (node) => {
      if (node.type.name === 'sceneHeading') {
        sceneId = `scene-${sceneIdx}`;
        sceneIdx++;
      }
      return true;
    });

    const contextLabel = deriveContextLabel();
    const defaultColor = NOTE_COLORS[0];
    const noteId = addNote({
      content: '',
      anchorText: anchorText.slice(0, 120),
      elementType: currentNodeType,
      contextLabel,
      color: defaultColor.name,
      sceneId,
    });

    // Apply the note highlight mark using chain (editor should still have valid state
    // since context menu is open and editor hasn't been blurred by a panel)
    const markFrom = hasSelection ? from : $from.start();
    const markTo = hasSelection ? to : $from.end();
    editor.chain().focus()
      .setTextSelection({ from: markFrom, to: markTo })
      .setMark('scriptNote', { noteId, color: defaultColor.hex })
      .run();

    // Filter to the newly created note
    setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId });

    // Open the notes panel
    if (!scriptNotesOpen) toggleScriptNotes();
    onClose();
  };

  const handleEditScriptNote = () => {
    if (existingNoteId) {
      setNoteFilter({
        elementType: null,
        contextLabel: null,
        color: null,
        noteId: existingNoteId,
      });
    }
    if (!scriptNotesOpen) toggleScriptNotes();
    onClose();
  };

  const handleDeleteScriptNote = () => {
    if (!existingNoteId) return;
    // Remove the mark from the editor
    const { doc, schema } = editor.state;
    const markType = schema.marks.scriptNote;
    if (markType) {
      editor.chain().focus().command(({ tr }) => {
        doc.descendants((node, pos) => {
          if (!node.isText) return;
          const mark = node.marks.find(
            (m) => m.type === markType && m.attrs.noteId === existingNoteId,
          );
          if (mark) {
            tr.removeMark(pos, pos + node.nodeSize, mark);
          }
        });
        return true;
      }).run();
    }
    deleteNote(existingNoteId);
    onClose();
  };

  const handleSpellSuggestion = (suggestion: string) => {
    if (!spellInfo) return;
    editor.chain().focus().command(({ tr }) => {
      tr.insertText(suggestion, spellInfo.from, spellInfo.to);
      return true;
    }).run();
    onClose();
    setTimeout(triggerSpellRecheck, 200);
  };

  const handleSpellIgnore = () => {
    if (!spellInfo) return;
    spellChecker.ignoreWord(spellInfo.word);
    onClose();
    triggerSpellRecheck();
  };

  const handleSpellAddDict = () => {
    if (!spellInfo) return;
    spellChecker.addToCustomDictionary(spellInfo.word);
    onClose();
    triggerSpellRecheck();
  };

  // ── Tag handlers ──
  const handleTagAs = () => {
    const { from, to, empty } = savedSelection.current;
    const selFrom = empty ? $from.start() : from;
    const selTo = empty ? $from.end() : to;
    const text = editor.state.doc.textBetween(selFrom, selTo, ' ');

    let sceneId: string | null = null;
    let sceneIdx = 0;
    editor.state.doc.nodesBetween(0, selFrom, (node) => {
      if (node.type.name === 'sceneHeading') { sceneId = `scene-${sceneIdx}`; sceneIdx++; }
      return true;
    });

    setPendingTagSelection({ from: selFrom, to: selTo, text: text.slice(0, 80), elementType: currentNodeType, sceneId });
    if (!tagsPanelOpen) toggleTagsPanel();
    onClose();
  };



  const handleRemoveTag = () => {
    if (!existingTagInfo) return;
    const { doc, schema } = editor.state;
    const markType = schema.marks.productionTag;
    if (!markType) { onClose(); return; }

    // Find and remove only the mark at the cursor position
    const cursorPos = editor.state.selection.$from.pos;
    editor.chain().focus().command(({ tr }) => {
      doc.descendants((node, pos) => {
        if (!node.isText) return;
        const mark = node.marks.find(
          (m) => m.type === markType && m.attrs.tagId === existingTagInfo.tagId,
        );
        if (mark && pos <= cursorPos && pos + node.nodeSize >= cursorPos) {
          tr.removeMark(pos, pos + node.nodeSize, mark);
        }
      });
      return true;
    }).run();

    // Count remaining occurrences; if none left, delete the entity
    let remaining = 0;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      if (node.marks.some((m) => m.type === markType && m.attrs.tagId === existingTagInfo.tagId)) {
        remaining++;
      }
    });
    if (remaining === 0) {
      deleteTag(existingTagInfo.tagId);
    }
    onClose();
  };

  const handleRevisionColor = (color: string) => {
    setRevisionColor(color);
    setRevisionSubOpen(false);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="script-context-menu"
      style={{ top: adjustedPos.y, left: adjustedPos.x }}
    >
      {/* Spelling suggestions at top (if misspelled word) */}
      {spellInfo && (
        <>
          {spellInfo.suggestions.length > 0 ? (
            spellInfo.suggestions.slice(0, 5).map((s) => (
              <div
                key={s}
                className="ctx-item ctx-spell-suggestion"
                onClick={() => handleSpellSuggestion(s)}
              >
                {s}
              </div>
            ))
          ) : (
            <div className="ctx-item ctx-disabled">No suggestions</div>
          )}
          <div className="ctx-separator" />
        </>
      )}

      {/* Undo / Redo */}
      <div className="ctx-item" onClick={handleUndo}>
        <span>Undo</span>
        <span className="ctx-shortcut">{mod}Z</span>
      </div>
      <div className="ctx-item" onClick={handleRedo}>
        <span>Redo</span>
        <span className="ctx-shortcut">{shift}{mod}Z</span>
      </div>
      <div className="ctx-separator" />

      {/* Clipboard */}
      <div className={`ctx-item${!hasSelection ? ' ctx-disabled' : ''}`} onClick={handleCut}>
        <span>Cut</span>
        <span className="ctx-shortcut">{mod}X</span>
      </div>
      <div className={`ctx-item${!hasSelection ? ' ctx-disabled' : ''}`} onClick={handleCopy}>
        <span>Copy</span>
        <span className="ctx-shortcut">{mod}C</span>
      </div>
      <div className="ctx-item" onClick={handlePaste}>
        <span>Paste</span>
        <span className="ctx-shortcut">{mod}V</span>
      </div>
      <div className="ctx-item" onClick={handlePasteWithoutFormatting}>
        <span>Paste Without Formatting</span>
        <span className="ctx-shortcut">{shift}{mod}V</span>
      </div>
      <div className="ctx-separator" />

      {/* Selection */}
      <div className="ctx-item" onClick={handleSelectAll}>
        <span>Select All</span>
        <span className="ctx-shortcut">{mod}A</span>
      </div>
      <div className={`ctx-item${!hasSelection ? ' ctx-disabled' : ''}`} onClick={handleDelete}>
        <span>Delete</span>
      </div>
      <div className="ctx-separator" />

      {/* Element submenu */}
      <div
        className="ctx-has-sub-wrap"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setElementSubOpen(true); setStyleSubOpen(false); setRevisionSubOpen(false); } }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setElementSubOpen(false); }}
      >
        <div className="ctx-item ctx-has-sub" onClick={() => { setElementSubOpen(true); setStyleSubOpen(false); setRevisionSubOpen(false); }}>
          <span>Element</span>
          <span className="ctx-arrow">&#9656;</span>
        </div>
        {elementSubOpen && (
          <div className="ctx-submenu">
            {ELEMENT_MENU_ITEMS
              .filter(({ type }) => {
                const rule = activeTemplate.rules[type];
                return !rule || rule.enabled;
              })
              .map(({ type, shortcut }) => (
              <div
                key={type}
                className={`ctx-item${currentNodeType === type ? ' ctx-active' : ''}`}
                onClick={() => handleSetElement(type)}
              >
                <span>{ELEMENT_LABELS[type]}</span>
                {shortcut && <span className="ctx-shortcut">{shortcut}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Style submenu */}
      <div
        className="ctx-has-sub-wrap"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setStyleSubOpen(true); setElementSubOpen(false); setRevisionSubOpen(false); } }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setStyleSubOpen(false); }}
      >
        <div className="ctx-item ctx-has-sub" onClick={() => { setStyleSubOpen(true); setElementSubOpen(false); setRevisionSubOpen(false); }}>
          <span>Style</span>
          <span className="ctx-arrow">&#9656;</span>
        </div>
        {styleSubOpen && (
          <div className="ctx-submenu">
            <div className={`ctx-item${locked.bold ? ' ctx-disabled' : ''}${editor.isActive('bold') ? ' ctx-active' : ''}`} onClick={() => { if (!locked.bold) handleBold(); }}>
              <span>Bold</span>
              <span className="ctx-shortcut">{mod}B</span>
            </div>
            <div className={`ctx-item${locked.italic ? ' ctx-disabled' : ''}${editor.isActive('italic') ? ' ctx-active' : ''}`} onClick={() => { if (!locked.italic) handleItalic(); }}>
              <span>Italic</span>
              <span className="ctx-shortcut">{mod}I</span>
            </div>
            <div className={`ctx-item${locked.underline ? ' ctx-disabled' : ''}${editor.isActive('underline') ? ' ctx-active' : ''}`} onClick={() => { if (!locked.underline) handleUnderline(); }}>
              <span>Underline</span>
              <span className="ctx-shortcut">{mod}U</span>
            </div>
            <div className={`ctx-item${locked.strikethrough ? ' ctx-disabled' : ''}${editor.isActive('strike') ? ' ctx-active' : ''}`} onClick={() => { if (!locked.strikethrough) handleStrike(); }}>
              <span>Strikethrough</span>
            </div>
            <div className="ctx-separator" />
            <div className={`ctx-item${locked.subscript ? ' ctx-disabled' : ''}${editor.isActive('subscript') ? ' ctx-active' : ''}`} onClick={() => { if (!locked.subscript) handleSubscript(); }}>
              <span>Subscript</span>
            </div>
            <div className={`ctx-item${locked.superscript ? ' ctx-disabled' : ''}${editor.isActive('superscript') ? ' ctx-active' : ''}`} onClick={() => { if (!locked.superscript) handleSuperscript(); }}>
              <span>Superscript</span>
            </div>
            <div className="ctx-separator" />
            <div className={`ctx-item${locked.textTransform ? ' ctx-disabled' : ''}`} onClick={() => { if (!locked.textTransform) handleAllCaps(); }}>
              <span>ALL CAPS</span>
            </div>
          </div>
        )}
      </div>

      {/* Font & Formatting */}
      <div className={`ctx-item${locked.fontFamily ? ' ctx-disabled' : ''}`} onClick={() => { if (!locked.fontFamily) { onOpenFormatPanel(); onClose(); } }}>
        <span>Font...</span>
      </div>
      <div className="ctx-separator" />

      {/* Context-sensitive items */}
      {showSceneProps && (
        <div className="ctx-item ctx-disabled">
          <span>Scene Properties...</span>
        </div>
      )}
      {showCharProfile && (
        <div className="ctx-item" onClick={() => {
          if (!characterProfilesOpen) toggleCharacterProfiles();
          onClose();
        }}>
          <span>Character Profile...</span>
        </div>
      )}
      {showDualDialogue && (
        <div className="ctx-item" onClick={() => { console.log('[CtxMenu] Dual Dialogue clicked, commands:', Object.keys(editor.commands).filter(k => k.includes('dual') || k.includes('Dual'))); const result = (editor as any).commands.toggleDualDialogue(); console.log('[CtxMenu] result:', result); onClose(); }}>
          <span>Dual Dialogue</span>
          <span className="ctx-shortcut">{mod}D</span>
        </div>
      )}
      {(showSceneProps || showDualDialogue || showCharProfile) && <div className="ctx-separator" />}

      {/* Revision */}
      <div className="ctx-item" onClick={() => { setRevisionMode(!revisionMode); onClose(); }}>
        <span>{revisionMode ? '\u2713 ' : ''}Revision Mode</span>
      </div>
      <div
        className="ctx-has-sub-wrap"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') { setRevisionSubOpen(true); setElementSubOpen(false); setStyleSubOpen(false); } }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setRevisionSubOpen(false); }}
      >
        <div className="ctx-item ctx-has-sub" onClick={() => { setRevisionSubOpen(true); setElementSubOpen(false); setStyleSubOpen(false); }}>
          <span>Revision Color</span>
          <span className="ctx-arrow">&#9656;</span>
        </div>
        {revisionSubOpen && (
          <div className="ctx-submenu ctx-submenu-colors">
            {REVISION_COLORS.map((color) => (
              <div
                key={color}
                className={`ctx-item${revisionColor === color ? ' ctx-active' : ''}`}
                onClick={() => handleRevisionColor(color)}
              >
                <span className="ctx-color-swatch" data-color={color.toLowerCase().replace(/\s/g, '-')} />
                <span>{color}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="ctx-separator" />

      {/* Script Notes — context-sensitive */}
      {existingNoteId ? (
        <>
          <div className="ctx-item" onClick={handleEditScriptNote}>
            <span>Edit Script Note</span>
          </div>
          <div className="ctx-item" onClick={handleDeleteScriptNote}>
            <span>Delete Script Note</span>
          </div>
        </>
      ) : (
        <div className="ctx-item" onClick={handleAddScriptNote}>
          <span>Add Script Note</span>
          <span className="ctx-shortcut">{shift}{mod}N</span>
        </div>
      )}
      <div className="ctx-separator" />

      {/* Production Tags */}
      {existingTagInfo ? (
        <>
          <div className="ctx-item" onClick={() => {
            if (existingTagInfo) {
              setEditingTagId(existingTagInfo.tagId);
            }
            if (!tagsPanelOpen) toggleTagsPanel();
            onClose();
          }}>
            <span>Edit Tag...</span>
          </div>
          <div className="ctx-item" onClick={handleRemoveTag}>
            <span>Remove Tag</span>
          </div>
        </>
      ) : (
        <div className="ctx-item" onClick={handleTagAs}>
          <span>Tag as...</span>
        </div>
      )}
      <div className="ctx-separator" />

      {/* Spelling tools */}
      {spellInfo && (
        <>
          <div className="ctx-item" onClick={handleSpellIgnore}>
            <span>Ignore Spelling</span>
          </div>
          <div className="ctx-item" onClick={handleSpellAddDict}>
            <span>Add to Dictionary</span>
          </div>
        </>
      )}
    </div>
  );
};

export default ScriptContextMenu;

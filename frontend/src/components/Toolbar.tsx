import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Editor } from '@tiptap/react';
import {
  FaBold,
  FaItalic,
  FaUnderline,
  FaStrikethrough,
  FaSubscript,
  FaSuperscript,
  FaAlignLeft,
  FaAlignCenter,
  FaAlignRight,
  FaAlignJustify,
  FaUndo,
  FaRedo,
  FaSearchPlus,
  FaSearchMinus,
  FaSearch,
  FaStickyNote,
  FaTags,
  FaPaintBrush,
  FaHighlighter,
  FaEllipsisV,
  FaHashtag,
} from 'react-icons/fa';
import { useEditorStore, NOTE_COLORS } from '../stores/editorStore';
import type { ElementType } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { BUILT_IN_ELEMENT_IDS } from '../stores/formattingTypes';
import {
  getCurrentElementRule,
  getLockedFormatting,
  toggleBoldOverride,
  toggleItalicOverride,
  toggleUnderlineOverride,
} from '../utils/effectiveFormatting';
import type { LockedFormatting } from '../utils/effectiveFormatting';
import FontPicker from './FontPicker';
import ColorPicker from './ColorPicker';
import LanguageSelector from './LanguageSelector';
import { FONT_REGISTRY, loadFont } from '../utils/fonts';

interface ToolbarProps {
  editor: Editor | null;
}

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24];

// Priority groups — higher number = hidden first when toolbar shrinks.
// Priority 1 = zoom-out (just the minus button area)
// Priority 2 = zoom/goto/search
// Priority 3 = alignment buttons
// Priority 4 = font style & colors (bold/italic/underline/strike/sub/super + colors + language)
// Priority 5 = font face & size
const Toolbar: React.FC<ToolbarProps> = ({ editor }) => {
  const {
    activeElement,
    setActiveElement,
    zoomLevel,
    setZoomLevel,
    zoomPanelOpen,
    setZoomPanelOpen,
    fontFamily,
    setFontFamily,
    fontSize,
    setFontSize,
    setSearchOpen,
    setGoToPageOpen,
    scriptNotesOpen,
    toggleScriptNotes,
    addNote,
    setNoteFilter,
    tagsPanelOpen,
    toggleTagsPanel,
    setPendingTagSelection,
    setEditingTagId,
    toolbarMode,
  } = useEditorStore();

  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const isEnforceMode = activeTemplate.mode === 'enforce';
  const isOverrideMode = activeTemplate.mode === 'override';

  // Per-attribute locking state — updates reactively when cursor moves between elements
  const [locked, setLocked] = useState<LockedFormatting>({
    bold: false, italic: false, underline: false, strikethrough: false,
    textAlign: false, textColor: false, backgroundColor: false, textTransform: false,
    fontFamily: false, fontSize: false, subscript: false, superscript: false,
  });

  // Color picker state
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [bgColorOpen, setBgColorOpen] = useState(false);
  const [currentTextColor, setCurrentTextColor] = useState<string>('#000000');
  const [currentBgColor, setCurrentBgColor] = useState<string>('#ffff00');

  // Track the font/size of the text at current cursor position
  const [cursorFont, setCursorFont] = useState(fontFamily);
  const [cursorSize, setCursorSize] = useState(fontSize);
  // Fonts found in document that aren't in the registry
  const [extraFonts, setExtraFonts] = useState<string[]>([]);

  const detectFormatting = useCallback(() => {
    if (!editor) return;

    // Update locked formatting for current element
    const rule = getCurrentElementRule(editor, activeTemplate);
    setLocked(getLockedFormatting(rule, isEnforceMode));

    const attrs = editor.getAttributes('textStyle');
    const detectedFont = (attrs.fontFamily as string | undefined) || '';
    const detectedSize = (attrs.fontSize as string | undefined) || '';

    // Font: use detected mark value, or template rule, or page-level font
    const effectiveFont = detectedFont || rule?.fontFamily || fontFamily;
    setCursorFont(effectiveFont);

    // If this font isn't in the registry, add it to extras so the dropdown shows it
    if (effectiveFont && !FONT_REGISTRY.find(f => f.name === effectiveFont)) {
      setExtraFonts(prev => prev.includes(effectiveFont) ? prev : [...prev, effectiveFont]);
    }

    // Size: parse "14pt" -> 14, or use template rule, or page-level size
    if (detectedSize) {
      const parsed = parseInt(detectedSize, 10);
      setCursorSize(!isNaN(parsed) ? parsed : (rule?.fontSize ?? fontSize));
    } else {
      setCursorSize(rule?.fontSize ?? fontSize);
    }
  }, [editor, fontFamily, fontSize, activeTemplate, isEnforceMode]);

  useEffect(() => {
    if (!editor) return;
    editor.on('selectionUpdate', detectFormatting);
    editor.on('transaction', detectFormatting);
    // Run once on mount / editor ready
    detectFormatting();
    return () => {
      editor.off('selectionUpdate', detectFormatting);
      editor.off('transaction', detectFormatting);
    };
  }, [editor, detectFormatting]);

  // Collect all unique fonts used in the document (for extra fonts display)
  useEffect(() => {
    if (!editor) return;
    const collectFonts = () => {
      const found = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (node.isText && node.marks) {
          for (const mark of node.marks) {
            if (mark.type.name === 'textStyle' && mark.attrs.fontFamily) {
              const f = mark.attrs.fontFamily as string;
              if (!FONT_REGISTRY.find(r => r.name === f)) {
                found.add(f);
              }
            }
          }
        }
      });
      if (found.size > 0) {
        setExtraFonts(prev => {
          const merged = new Set([...prev, ...found]);
          return merged.size !== prev.length ? [...merged] : prev;
        });
      }
    };
    collectFonts();
    editor.on('update', collectFonts);
    return () => { editor.off('update', collectFonts); };
  }, [editor]);

  const handleElementChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value;
    if (!editor) return;
    setActiveElement(type as ElementType);
    // Check if it's a built-in element or a custom element
    if (BUILT_IN_ELEMENT_IDS.includes(type)) {
      editor.chain().focus().setNode(type).run();
    } else {
      // Custom element
      const rule = activeTemplate.rules[type];
      if (rule) {
        editor.chain().focus().setNode('customElement', {
          customTypeId: type,
          customLabel: rule.label,
        }).run();
      }
    }
  };

  const isActive = (format: string) => {
    if (!editor) return false;
    return editor.isActive(format);
  };

  // Editable zoom input
  const [zoomInput, setZoomInput] = useState(String(zoomLevel));
  const [zoomEditing, setZoomEditing] = useState(false);
  const zoomInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!zoomEditing) setZoomInput(String(zoomLevel)); }, [zoomLevel, zoomEditing]);
  const commitZoom = () => {
    const val = parseInt(zoomInput, 10);
    if (!isNaN(val) && val >= 50 && val <= 200) setZoomLevel(val);
    else setZoomInput(String(zoomLevel));
    setZoomEditing(false);
  };

  // ── Responsive overflow ──────────────────────────────────────────────
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [hiddenPriorities, setHiddenPriorities] = useState<Set<string>>(new Set());
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [overflowOpen]);

  // Hide order: "1" first, then "2" (matches "2" and "2b"), "3", "4", "5" last
  const HIDE_ORDER = ['1', '2', '3', '4', '5'];

  // Measure toolbar overflow and determine which priority groups to hide
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const measure = () => {
      const containerWidth = toolbar.clientWidth;
      const groups = toolbar.querySelectorAll<HTMLElement>('[data-priority]');
      if (groups.length === 0) return;

      // Show all groups to measure natural widths
      groups.forEach(g => g.style.display = '');

      const OVERFLOW_BTN_WIDTH = 36;
      const allItems: { el: HTMLElement; key: string }[] = [];
      const newHidden = new Set<string>();

      let totalWidth = 0;
      for (const child of toolbar.children) {
        const el = child as HTMLElement;
        const w = el.offsetWidth;
        if (el.dataset.priority) {
          // CSS-hidden items (e.g. toolbar-desktop-only on mobile) have 0 width —
          // mark them as hidden so they appear in the overflow menu.
          if (w === 0) {
            newHidden.add(el.dataset.priority);
          } else {
            allItems.push({ el, key: el.dataset.priority });
          }
        }
        totalWidth += w + 2;
      }

      if (totalWidth > containerWidth) {
        let currentTotal = totalWidth + OVERFLOW_BTN_WIDTH;

        for (const prefix of HIDE_ORDER) {
          if (currentTotal <= containerWidth) break;
          const matching = allItems.filter(p => p.key.startsWith(prefix));
          for (const { el, key } of matching) {
            newHidden.add(key);
            currentTotal -= el.offsetWidth + 2;
            el.style.display = 'none';
          }
        }
      }

      setHiddenPriorities(prev => {
        if (prev.size !== newHidden.size) return newHidden;
        for (const p of newHidden) { if (!prev.has(p)) return newHidden; }
        return prev;
      });
    };

    let rafId = 0;
    let lastWidth = 0;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      // Only re-measure if container width actually changed (not just internal reflow)
      if (w === lastWidth) return;
      lastWidth = w;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    ro.observe(toolbar);
    requestAnimationFrame(measure);
    return () => { ro.disconnect(); cancelAnimationFrame(rafId); };
  }, []);

  const hasOverflow = hiddenPriorities.size > 0;

  // ── Notes handler (shared between inline and overflow) ──
  const handleNotesClick = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!editor) { toggleScriptNotes(); return; }

    // Detect if cursor is on an existing note
    const noteMarkType = editor.schema.marks.scriptNote;
    if (noteMarkType) {
      const $from = editor.state.selection.$from;
      let noteMark = $from.marks().find((m) => m.type === noteMarkType);
      if (!noteMark) {
        const node = $from.nodeAfter || $from.nodeBefore;
        if (node?.marks) noteMark = node.marks.find((m) => m.type === noteMarkType);
      }
      if (noteMark) {
        setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId: noteMark.attrs.noteId as string });
        if (!scriptNotesOpen) toggleScriptNotes();
        return;
      }
    }

    const { from, to, empty } = editor.state.selection;
    const $from = editor.state.selection.$from;
    const selFrom = empty ? $from.start() : from;
    const selTo = empty ? $from.end() : to;
    const text = editor.state.doc.textBetween(selFrom, selTo, ' ');

    if (text.trim()) {
      const currentNodeType = $from.parent.type.name;
      const nodeText = $from.parent.textContent.trim();
      let contextLabel = nodeText.slice(0, 60);
      if (currentNodeType === 'character') {
        contextLabel = nodeText.replace(/\s*\([^)]*\)\s*/g, '').trim();
      } else if (currentNodeType === 'sceneHeading') {
        contextLabel = nodeText;
      } else if (currentNodeType === 'dialogue' || currentNodeType === 'parenthetical') {
        let charName = '';
        editor.state.doc.nodesBetween(0, selFrom, (node) => {
          if (node.type.name === 'character') {
            charName = node.textContent.trim().replace(/\s*\([^)]*\)\s*/g, '').trim();
          }
          return true;
        });
        if (charName) contextLabel = charName;
      }

      let sceneId: string | null = null;
      let sceneIdx = 0;
      editor.state.doc.nodesBetween(0, selFrom, (node) => {
        if (node.type.name === 'sceneHeading') { sceneId = `scene-${sceneIdx}`; sceneIdx++; }
        return true;
      });

      const defaultColor = NOTE_COLORS[0];
      const noteId = addNote({
        content: '',
        anchorText: text.slice(0, 120),
        elementType: currentNodeType,
        contextLabel,
        color: defaultColor.name,
        sceneId,
      });

      const { tr } = editor.state;
      const markType = editor.schema.marks.scriptNote;
      if (markType) {
        tr.addMark(selFrom, selTo, markType.create({ noteId, color: defaultColor.hex }));
        editor.view.dispatch(tr);
        editor.emit('update', { editor, transaction: tr });
      }

      setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId });
      if (!scriptNotesOpen) toggleScriptNotes();
    } else {
      toggleScriptNotes();
    }
  }, [editor, scriptNotesOpen, toggleScriptNotes, addNote, setNoteFilter]);

  // ── Tags handler (shared between inline and overflow) ──
  const handleTagsClick = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!editor) { toggleTagsPanel(); return; }

    const markType = editor.schema.marks.productionTag;
    if (markType) {
      const $from = editor.state.selection.$from;
      const storedMarks = $from.marks();
      let tagMark = storedMarks.find((m) => m.type === markType);
      if (!tagMark) {
        const node = $from.nodeAfter || $from.nodeBefore;
        if (node?.marks) tagMark = node.marks.find((m) => m.type === markType);
      }

      if (tagMark) {
        setEditingTagId(tagMark.attrs.tagId as string);
        if (!tagsPanelOpen) toggleTagsPanel();
        return;
      }
    }

    const { from, to, empty } = editor.state.selection;
    const $from = editor.state.selection.$from;
    const selFrom = empty ? $from.start() : from;
    const selTo = empty ? $from.end() : to;
    const text = editor.state.doc.textBetween(selFrom, selTo, ' ');

    if (text.trim()) {
      const currentNodeType = $from.parent.type.name;
      let sceneId: string | null = null;
      let sceneIdx = 0;
      editor.state.doc.nodesBetween(0, selFrom, (node) => {
        if (node.type.name === 'sceneHeading') { sceneId = `scene-${sceneIdx}`; sceneIdx++; }
        return true;
      });
      setPendingTagSelection({ from: selFrom, to: selTo, text: text.slice(0, 80), elementType: currentNodeType, sceneId });
      if (!tagsPanelOpen) toggleTagsPanel();
    } else {
      toggleTagsPanel();
    }
  }, [editor, tagsPanelOpen, toggleTagsPanel, setPendingTagSelection, setEditingTagId]);

  // ── Shared renderers for toolbar groups (used both inline and in overflow) ──

  const renderFontFaceSize = useCallback((inOverflow = false) => (
    <React.Fragment key="font-face-size">
      <div className="toolbar-group" style={locked.fontFamily ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
        <FontPicker
          value={cursorFont}
          extraFonts={extraFonts}
          onChange={(val) => {
            if (locked.fontFamily) return;
            setFontFamily(val);
            const entry = FONT_REGISTRY.find(f => f.name === val);
            if (entry) loadFont(entry);
            const DEFAULT_FONTS = ['Courier Final Draft', 'Courier Prime', 'Courier New', 'Courier'];
            if (DEFAULT_FONTS.includes(val)) {
              editor?.chain().focus().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run();
            } else {
              editor?.chain().focus().setMark('textStyle', { fontFamily: val }).run();
            }
            if (inOverflow) setOverflowOpen(false);
          }}
        />
      </div>
      <div className="toolbar-group">
        <select
          className="font-size-selector"
          value={cursorSize}
          disabled={locked.fontSize}
          onChange={(e) => {
            if (locked.fontSize) return;
            const val = Number(e.target.value);
            setFontSize(val);
            if (val === 12) {
              editor?.chain().focus().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
            } else {
              editor?.chain().focus().setFontSize(`${val}pt`).run();
            }
            if (inOverflow) setOverflowOpen(false);
          }}
          title="Font Size"
        >
          {(FONT_SIZES.includes(cursorSize) ? FONT_SIZES : [...FONT_SIZES, cursorSize].sort((a, b) => a - b)).map((s) => (
            <option key={s} value={s}>
              {s}pt
            </option>
          ))}
        </select>
      </div>
    </React.Fragment>
  ), [cursorFont, cursorSize, extraFonts, editor, setFontFamily, setFontSize, locked]);

  // showPopups: when false, only render buttons (no ColorPicker popups).
  // This prevents the hidden inline copy from stealing popup state from the overflow copy.
  const renderFontStyleColors = useCallback((inOverflow = false, showPopups = true) => (
    <React.Fragment key="font-style-colors">
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${isActive('bold') ? 'active' : ''}`}
          title="Bold (⌘B)"
          disabled={locked.bold}
          onClick={() => {
            if (!editor || locked.bold) return;
            if (isOverrideMode) {
              toggleBoldOverride(editor, getCurrentElementRule(editor, activeTemplate));
            } else {
              editor.chain().focus().toggleBold().run();
            }
          }}
        >
          <FaBold />
        </button>
        <button
          className={`toolbar-btn ${isActive('italic') ? 'active' : ''}`}
          title="Italic (⌘I)"
          disabled={locked.italic}
          onClick={() => {
            if (!editor || locked.italic) return;
            if (isOverrideMode) {
              toggleItalicOverride(editor, getCurrentElementRule(editor, activeTemplate));
            } else {
              editor.chain().focus().toggleItalic().run();
            }
          }}
        >
          <FaItalic />
        </button>
        <button
          className={`toolbar-btn ${isActive('underline') ? 'active' : ''}`}
          title="Underline (⌘U)"
          disabled={locked.underline}
          onClick={() => {
            if (!editor || locked.underline) return;
            if (isOverrideMode) {
              toggleUnderlineOverride(editor, getCurrentElementRule(editor, activeTemplate));
            } else {
              editor.chain().focus().toggleUnderline().run();
            }
          }}
        >
          <FaUnderline />
        </button>
        <button
          className={`toolbar-btn ${isActive('strike') ? 'active' : ''}`}
          title="Strikethrough"
          disabled={locked.strikethrough}
          onClick={() => { if (!locked.strikethrough) editor?.chain().focus().toggleStrike().run(); }}
        >
          <FaStrikethrough />
        </button>
        <button
          className={`toolbar-btn ${isActive('subscript') ? 'active' : ''}`}
          title="Subscript"
          disabled={locked.subscript}
          onClick={() => { if (!locked.subscript) editor?.chain().focus().toggleSubscript().run(); }}
        >
          <FaSubscript />
        </button>
        <button
          className={`toolbar-btn ${isActive('superscript') ? 'active' : ''}`}
          title="Superscript"
          disabled={locked.superscript}
          onClick={() => { if (!locked.superscript) editor?.chain().focus().toggleSuperscript().run(); }}
        >
          <FaSuperscript />
        </button>
      </div>

      <div className={inOverflow ? 'toolbar-overflow-sep' : 'toolbar-separator'} />

      <div className="toolbar-group" style={{ position: 'relative' }}>
        <button
          className="toolbar-btn"
          title="Text Color"
          disabled={locked.textColor}
          onClick={() => { if (!locked.textColor) { setTextColorOpen(!textColorOpen); setBgColorOpen(false); } }}
        >
          <FaPaintBrush style={{ color: currentTextColor }} />
        </button>
        {showPopups && textColorOpen && (
          <ColorPicker
            value={currentTextColor}
            onChange={(color) => {
              setCurrentTextColor(color || '#000000');
              if (color) {
                editor?.chain().focus().setColor(color).run();
              } else {
                editor?.chain().focus().unsetColor().run();
              }
              setTextColorOpen(false);
            }}
            onClose={() => setTextColorOpen(false)}
          />
        )}

        <button
          className="toolbar-btn"
          title="Highlight Color"
          disabled={locked.backgroundColor}
          onClick={() => { if (!locked.backgroundColor) { setBgColorOpen(!bgColorOpen); setTextColorOpen(false); } }}
        >
          <FaHighlighter style={{ color: currentBgColor }} />
        </button>
        {showPopups && bgColorOpen && (
          <ColorPicker
            value={currentBgColor}
            onChange={(color) => {
              setCurrentBgColor(color || '#ffff00');
              if (color) {
                editor?.chain().focus().toggleHighlight({ color }).run();
              } else {
                editor?.chain().focus().unsetHighlight().run();
              }
              setBgColorOpen(false);
            }}
            onClose={() => setBgColorOpen(false)}
          />
        )}
      </div>

      <div className={inOverflow ? 'toolbar-overflow-sep' : 'toolbar-separator'} />

      <LanguageSelector editor={editor} activeElement={activeElement} />
    </React.Fragment>
  ), [editor, isOverrideMode, activeTemplate, activeElement, textColorOpen, bgColorOpen, currentTextColor, currentBgColor, locked]);

  const renderAlignment = useCallback((_inOverflow = false) => (
    <div className="toolbar-group" key="alignment">
      <button
        className={`toolbar-btn ${editor?.isActive({ textAlign: 'left' }) ? 'active' : ''}`}
        title="Align Left"
        onClick={() => editor?.chain().focus().setTextAlign('left').run()}
        disabled={locked.textAlign}
      >
        <FaAlignLeft />
      </button>
      <button
        className={`toolbar-btn ${editor?.isActive({ textAlign: 'center' }) ? 'active' : ''}`}
        title="Align Center"
        onClick={() => editor?.chain().focus().setTextAlign('center').run()}
        disabled={locked.textAlign}
      >
        <FaAlignCenter />
      </button>
      <button
        className={`toolbar-btn ${editor?.isActive({ textAlign: 'right' }) ? 'active' : ''}`}
        title="Align Right"
        onClick={() => editor?.chain().focus().setTextAlign('right').run()}
        disabled={locked.textAlign}
      >
        <FaAlignRight />
      </button>
      <button
        className={`toolbar-btn ${editor?.isActive({ textAlign: 'justify' }) ? 'active' : ''}`}
        title="Justify"
        onClick={() => editor?.chain().focus().setTextAlign('justify').run()}
        disabled={locked.textAlign}
      >
        <FaAlignJustify />
      </button>
    </div>
  ), [editor, locked]);

  const renderSearchGoto = useCallback((inOverflow = false) => (
    <div className="toolbar-group" key="search-goto">
      <button
        className="toolbar-btn"
        title="Find & Replace (⌘F)"
        onClick={() => { setSearchOpen(true); if (inOverflow) setOverflowOpen(false); }}
      >
        <FaSearch />
      </button>
      <button
        className="toolbar-btn"
        title="Go to Page (⌘G)"
        onClick={() => { setGoToPageOpen(true); if (inOverflow) setOverflowOpen(false); }}
      >
        <FaHashtag />
      </button>
    </div>
  ), [setSearchOpen, setGoToPageOpen]);

  const renderZoom = useCallback((_inOverflow = false) => (
    <div className="toolbar-group zoom-group" key="zoom">
      <button
        className="toolbar-btn"
        title="Zoom Out"
        onClick={() => setZoomLevel(zoomLevel - 10)}
        disabled={zoomLevel <= 50}
      >
        <FaSearchMinus />
      </button>
      {zoomEditing ? (
        <input
          ref={zoomInputRef}
          className="zoom-input"
          type="number"
          min={50}
          max={200}
          step={10}
          value={zoomInput}
          onChange={(e) => setZoomInput(e.target.value)}
          onBlur={commitZoom}
          onKeyDown={(e) => { if (e.key === 'Enter') commitZoom(); if (e.key === 'Escape') { setZoomInput(String(zoomLevel)); setZoomEditing(false); } }}
          autoFocus
        />
      ) : (
        <span
          className="zoom-label"
          onClick={() => { setZoomEditing(true); setTimeout(() => zoomInputRef.current?.select(), 0); }}
          title="Click to edit zoom"
        >
          {zoomLevel}%
        </span>
      )}
      <button
        className="toolbar-btn"
        title="Zoom In"
        onClick={() => setZoomLevel(zoomLevel + 10)}
        disabled={zoomLevel >= 200}
      >
        <FaSearchPlus />
      </button>
    </div>
  ), [zoomLevel, zoomEditing, zoomInput, setZoomLevel, commitZoom]);

  const renderZoomMin = useCallback((_inOverflow = false) => (
    <div className="toolbar-group zoom-group" key="zoom-min">
      <button
        className="toolbar-btn"
        title="Zoom Out"
        onClick={() => setZoomLevel(zoomLevel - 10)}
        disabled={zoomLevel <= 50}
      >
        <FaSearchMinus />
      </button>
    </div>
  ), [zoomLevel, setZoomLevel]);

  // Check if a given prefix has any hidden items
  const isHidden = useCallback((prefix: string) => {
    for (const k of hiddenPriorities) { if (k.startsWith(prefix)) return true; }
    return false;
  }, [hiddenPriorities]);

  // Build overflow menu content from hidden priorities
  const overflowContent = useMemo(() => {
    if (hiddenPriorities.size === 0) return null;
    const items: React.ReactNode[] = [];
    const addSep = () => { if (items.length > 0) items.push(<div className="toolbar-overflow-sep" key={`sep-${items.length}`} />); };

    // Show items in logical order (most important first within overflow)
    if (isHidden('5')) { addSep(); items.push(renderFontFaceSize(true)); }
    if (isHidden('4')) { addSep(); items.push(renderFontStyleColors(true)); }
    if (isHidden('3')) { addSep(); items.push(renderAlignment(true)); }
    if (isHidden('2')) { addSep(); items.push(renderSearchGoto(true)); items.push(renderZoom(true)); }
    if (isHidden('1') && !isHidden('2')) { addSep(); items.push(renderZoomMin(true)); }

    return items;
  }, [hiddenPriorities, isHidden, renderZoomMin, renderZoom, renderSearchGoto, renderAlignment, renderFontStyleColors, renderFontFaceSize]);

  if (toolbarMode === 'hidden') return null;

  return (
    <div className={`toolbar${toolbarMode === 'comfortable' ? ' toolbar-comfortable' : ''}`} ref={toolbarRef}>
      {/* Undo / Redo — always visible */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          title="Undo (⌘Z)"
          onClick={() => { try { editor?.chain().focus().undo().run(); } catch {} }}
          disabled={!editor || typeof (editor.can() as any).undo !== 'function' || !(editor.can() as any).undo()}
        >
          <FaUndo />
        </button>
        <button
          className="toolbar-btn"
          title="Redo (⇧⌘Z)"
          onClick={() => { try { editor?.chain().focus().redo().run(); } catch {} }}
          disabled={!editor || typeof (editor.can() as any).redo !== 'function' || !(editor.can() as any).redo()}
        >
          <FaRedo />
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* Element type selector — always visible */}
      <div className="toolbar-group">
        <select
          className="element-selector"
          value={activeElement}
          onChange={handleElementChange}
        >
          {Object.values(activeTemplate.rules)
            .filter((r) => r.enabled)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
        </select>
      </div>

      <div className="toolbar-separator" />

      {/* Priority 5: Font face & size — hidden on mobile, collapsible on desktop */}
      <div className="toolbar-desktop-only toolbar-priority-block" data-priority="5">
        {renderFontFaceSize()}
        <div className="toolbar-separator" />
      </div>

      {/* Priority 4: Font style & colors — hidden on mobile, collapsible on desktop.
          Suppress ColorPicker popups when hidden so they only render in the overflow copy. */}
      <div className="toolbar-desktop-only toolbar-priority-block" data-priority="4">
        {renderFontStyleColors(false, !isHidden('4'))}
        <div className="toolbar-separator" />
      </div>

      {/* Priority 3: Alignment — hidden on mobile, collapsible on desktop */}
      <div className="toolbar-desktop-only toolbar-priority-block" data-priority="3">
        {renderAlignment()}
        <div className="toolbar-separator" />
      </div>

      {/* Priority 2: Search & Go to — collapsible on desktop */}
      <div className="toolbar-priority-block" data-priority="2">
        {renderSearchGoto()}
      </div>

      <div className="toolbar-separator" />

      {/* Notes & Tags — always visible */}
      <div className="toolbar-group">
        <button
          className={`toolbar-btn${scriptNotesOpen ? ' active' : ''}`}
          title="Script Notes"
          onPointerDown={handleNotesClick}
        >
          <FaStickyNote />
        </button>
        <button
          className={`toolbar-btn${tagsPanelOpen ? ' active' : ''}`}
          title="Production Tags"
          onPointerDown={handleTagsClick}
        >
          <FaTags />
        </button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Overflow 3-dot menu */}
      {hasOverflow && (
        <div className="toolbar-group toolbar-overflow-wrap" ref={overflowRef}>
          <button
            className={`toolbar-btn toolbar-overflow-btn${overflowOpen ? ' active' : ''}`}
            title="More formatting options"
            onClick={() => setOverflowOpen(!overflowOpen)}
          >
            <FaEllipsisV />
          </button>
          {overflowOpen && (
            <div className="toolbar-overflow-menu">
              {overflowContent}
            </div>
          )}
        </div>
      )}

      {/* Zoom — desktop: P1 hides zoom-out, P2 hides zoom label/in */}
      <div className="toolbar-priority-block zoom-group" data-priority="1">
        <button
          className="toolbar-btn"
          title="Zoom Out"
          onClick={() => setZoomLevel(zoomLevel - 10)}
          disabled={zoomLevel <= 50}
        >
          <FaSearchMinus />
        </button>
      </div>
      <div className="toolbar-priority-block zoom-group" data-priority="2b">
        {zoomEditing ? (
          <input
            ref={zoomInputRef}
            className="zoom-input"
            type="number"
            min={50}
            max={200}
            step={10}
            value={zoomInput}
            onChange={(e) => setZoomInput(e.target.value)}
            onBlur={commitZoom}
            onKeyDown={(e) => { if (e.key === 'Enter') commitZoom(); if (e.key === 'Escape') { setZoomInput(String(zoomLevel)); setZoomEditing(false); } }}
            autoFocus
          />
        ) : (
          <span
            className="zoom-label"
            onClick={() => { setZoomEditing(true); setTimeout(() => zoomInputRef.current?.select(), 0); }}
            title="Click to edit zoom"
          >
            {zoomLevel}%
          </span>
        )}
        <button
          className="toolbar-btn"
          title="Zoom In"
          onClick={() => setZoomLevel(zoomLevel + 10)}
          disabled={zoomLevel >= 200}
        >
          <FaSearchPlus />
        </button>
      </div>

      {/* Zoom — mobile: single button */}
      <div className="toolbar-group zoom-mobile-group">
        <button
          className="toolbar-btn"
          title="Zoom"
          onClick={() => setZoomPanelOpen(!zoomPanelOpen)}
        >
          <FaSearchPlus />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;

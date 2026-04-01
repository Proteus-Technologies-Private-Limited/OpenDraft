import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from '@tiptap/react';
import {
  FaBold,
  FaItalic,
  FaUnderline,
  FaUndo,
  FaRedo,
  FaSearchPlus,
  FaSearchMinus,
  FaSearch,
} from 'react-icons/fa';
import { useEditorStore, ELEMENT_LABELS } from '../stores/editorStore';
import type { ElementType } from '../stores/editorStore';
import FontPicker from './FontPicker';
import LanguageSelector from './LanguageSelector';
import { FONT_REGISTRY, loadFont } from '../utils/fonts';

interface ToolbarProps {
  editor: Editor | null;
}

const ELEMENT_TYPES: ElementType[] = [
  'sceneHeading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'general',
  'shot',
  'newAct',
  'endOfAct',
  'lyrics',
  'showEpisode',
  'castList',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24];

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
  } = useEditorStore();

  // Track the font/size of the text at current cursor position
  const [cursorFont, setCursorFont] = useState(fontFamily);
  const [cursorSize, setCursorSize] = useState(fontSize);
  // Fonts found in document that aren't in the registry
  const [extraFonts, setExtraFonts] = useState<string[]>([]);

  const detectFormatting = useCallback(() => {
    if (!editor) return;
    const attrs = editor.getAttributes('textStyle');
    const detectedFont = (attrs.fontFamily as string | undefined) || '';
    const detectedSize = (attrs.fontSize as string | undefined) || '';

    // Font: use detected mark value, or fall back to page-level font
    const effectiveFont = detectedFont || fontFamily;
    setCursorFont(effectiveFont);

    // If this font isn't in the registry, add it to extras so the dropdown shows it
    if (effectiveFont && !FONT_REGISTRY.find(f => f.name === effectiveFont)) {
      setExtraFonts(prev => prev.includes(effectiveFont) ? prev : [...prev, effectiveFont]);
    }

    // Size: parse "14pt" -> 14, or fall back to page-level size
    if (detectedSize) {
      const parsed = parseInt(detectedSize, 10);
      setCursorSize(!isNaN(parsed) ? parsed : fontSize);
    } else {
      setCursorSize(fontSize);
    }
  }, [editor, fontFamily, fontSize]);

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
    const type = e.target.value as ElementType;
    if (!editor) return;
    setActiveElement(type);
    editor.chain().focus().setNode(type).run();
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

  return (
    <div className="toolbar">
      {/* Undo / Redo */}
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

      {/* Element type selector */}
      <div className="toolbar-group">
        <select
          className="element-selector"
          value={activeElement}
          onChange={handleElementChange}
        >
          {ELEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ELEMENT_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-separator" />

      {/* Font, size, style, language — hidden on mobile (available via context menu) */}
      <div className="toolbar-desktop-only">
        <div className="toolbar-group">
          <FontPicker
            value={cursorFont}
            extraFonts={extraFonts}
            onChange={(val) => {
              setFontFamily(val);
              const entry = FONT_REGISTRY.find(f => f.name === val);
              if (entry) loadFont(entry);
              const DEFAULT_FONTS = ['Courier Final Draft', 'Courier Prime', 'Courier New', 'Courier'];
              if (DEFAULT_FONTS.includes(val)) {
                editor?.chain().focus().setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run();
              } else {
                editor?.chain().focus().setMark('textStyle', { fontFamily: val }).run();
              }
            }}
          />
        </div>

        <div className="toolbar-group">
          <select
            className="font-size-selector"
            value={cursorSize}
            onChange={(e) => {
              const val = Number(e.target.value);
              setFontSize(val);
              if (val === 12) {
                editor?.chain().focus().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
              } else {
                editor?.chain().focus().setFontSize(`${val}pt`).run();
              }
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

        <div className="toolbar-separator" />

        <div className="toolbar-group">
          <button
            className={`toolbar-btn ${isActive('bold') ? 'active' : ''}`}
            title="Bold (⌘B)"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <FaBold />
          </button>
          <button
            className={`toolbar-btn ${isActive('italic') ? 'active' : ''}`}
            title="Italic (⌘I)"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <FaItalic />
          </button>
          <button
            className={`toolbar-btn ${isActive('underline') ? 'active' : ''}`}
            title="Underline (⌘U)"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <FaUnderline />
          </button>
        </div>

        <div className="toolbar-separator" />

        <LanguageSelector editor={editor} activeElement={activeElement} />

        <div className="toolbar-separator" />
      </div>

      {/* Search */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          title="Find & Replace (⌘F)"
          onClick={() => setSearchOpen(true)}
        >
          <FaSearch />
        </button>
        <button
          className="toolbar-btn toolbar-btn-text"
          title="Go to Page (⌘G)"
          onClick={() => setGoToPageOpen(true)}
        >
          Go to
        </button>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Zoom — desktop: inline +/- with editable percentage */}
      <div className="toolbar-group zoom-group">
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

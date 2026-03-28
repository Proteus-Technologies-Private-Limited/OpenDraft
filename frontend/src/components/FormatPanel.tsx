import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import FontPicker from './FontPicker';
import { FONT_REGISTRY, loadFont } from '../utils/fonts';
import { useEditorStore } from '../stores/editorStore';

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

interface FormatPanelProps {
  editor: Editor;
  onClose: () => void;
}

const FormatPanel: React.FC<FormatPanelProps> = ({ editor, onClose }) => {
  const { fontFamily: pageFont, fontSize: pageFontSize } = useEditorStore();

  // Snapshot the current state so we can restore on Cancel
  const snapshotRef = useRef<string | null>(null);
  const selectionRef = useRef({ from: editor.state.selection.from, to: editor.state.selection.to });

  // Detect current formatting at cursor
  const attrs = editor.getAttributes('textStyle');
  const initialFont = (attrs.fontFamily as string) || pageFont;
  const initialSizeStr = (attrs.fontSize as string) || '';
  const initialSize = initialSizeStr ? parseInt(initialSizeStr, 10) || pageFontSize : pageFontSize;
  const initialBold = editor.isActive('bold');
  const initialItalic = editor.isActive('italic');
  const initialUnderline = editor.isActive('underline');

  const [font, setFont] = useState(initialFont);
  const [size, setSize] = useState(initialSize);
  const [bold, setBold] = useState(initialBold);
  const [italic, setItalic] = useState(initialItalic);
  const [underline, setUnderline] = useState(initialUnderline);
  const [extraFonts, setExtraFonts] = useState<string[]>([]);

  // Save editor state snapshot on mount for cancel
  useEffect(() => {
    snapshotRef.current = JSON.stringify(editor.getJSON());
    // Collect extra fonts
    const found = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks) {
        for (const mark of node.marks) {
          if (mark.type.name === 'textStyle' && mark.attrs.fontFamily) {
            const f = mark.attrs.fontFamily as string;
            if (!FONT_REGISTRY.find((r) => r.name === f)) found.add(f);
          }
        }
      }
    });
    if (found.size > 0) setExtraFonts([...found]);
  }, [editor]);

  // Apply preview in real-time
  const applyPreview = useCallback(
    (f: string, s: number, b: boolean, i: boolean, u: boolean) => {
      const { from, to } = selectionRef.current;
      const chain = editor.chain().focus().setTextSelection({ from, to });

      // Font
      const DEFAULT_FONTS = ['Courier Final Draft', 'Courier New', 'Courier', 'Courier Prime'];
      if (DEFAULT_FONTS.includes(f)) {
        chain.setMark('textStyle', { fontFamily: null });
      } else {
        chain.setMark('textStyle', { fontFamily: f });
      }
      chain.run();

      // Size
      const sizeChain = editor.chain().focus().setTextSelection({ from, to });
      if (s === 12) {
        sizeChain.setMark('textStyle', { fontSize: null });
      } else {
        sizeChain.setFontSize(`${s}pt`);
      }
      sizeChain.run();

      // Bold
      if (b !== editor.isActive('bold')) {
        editor.chain().focus().setTextSelection({ from, to }).toggleBold().run();
      }
      // Italic
      if (i !== editor.isActive('italic')) {
        editor.chain().focus().setTextSelection({ from, to }).toggleItalic().run();
      }
      // Underline
      if (u !== editor.isActive('underline')) {
        editor.chain().focus().setTextSelection({ from, to }).toggleUnderline().run();
      }
    },
    [editor],
  );

  const handleFontChange = (f: string) => {
    setFont(f);
    const entry = FONT_REGISTRY.find((e) => e.name === f);
    if (entry) loadFont(entry);
    applyPreview(f, size, bold, italic, underline);
  };

  const handleSizeChange = (s: number) => {
    setSize(s);
    applyPreview(font, s, bold, italic, underline);
  };

  const handleBoldToggle = () => {
    const next = !bold;
    setBold(next);
    applyPreview(font, size, next, italic, underline);
  };

  const handleItalicToggle = () => {
    const next = !italic;
    setItalic(next);
    applyPreview(font, size, bold, next, underline);
  };

  const handleUnderlineToggle = () => {
    const next = !underline;
    setUnderline(next);
    applyPreview(font, size, bold, italic, next);
  };

  const handleOk = () => {
    // Changes are already applied as preview — just close
    onClose();
  };

  const handleCancel = () => {
    // Restore the snapshot
    if (snapshotRef.current) {
      try {
        editor.commands.setContent(JSON.parse(snapshotRef.current));
      } catch {
        // ignore parse errors
      }
    }
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="format-panel-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}>
      <div className="format-panel">
        <div className="format-panel-header">
          <span>Font & Formatting</span>
          <button className="format-panel-close" onClick={handleCancel}>&times;</button>
        </div>

        <div className="format-panel-body">
          {/* Font family */}
          <div className="format-row">
            <label className="format-label">Font</label>
            <FontPicker value={font} extraFonts={extraFonts} onChange={handleFontChange} />
          </div>

          {/* Font size */}
          <div className="format-row">
            <label className="format-label">Size</label>
            <select
              className="format-size-select"
              value={size}
              onChange={(e) => handleSizeChange(Number(e.target.value))}
            >
              {(FONT_SIZES.includes(size) ? FONT_SIZES : [...FONT_SIZES, size].sort((a, b) => a - b)).map((s) => (
                <option key={s} value={s}>{s}pt</option>
              ))}
            </select>
          </div>

          {/* Style toggles */}
          <div className="format-row">
            <label className="format-label">Style</label>
            <div className="format-style-btns">
              <button
                className={`format-style-btn${bold ? ' active' : ''}`}
                onClick={handleBoldToggle}
                title="Bold"
              >
                <strong>B</strong>
              </button>
              <button
                className={`format-style-btn${italic ? ' active' : ''}`}
                onClick={handleItalicToggle}
                title="Italic"
              >
                <em>I</em>
              </button>
              <button
                className={`format-style-btn${underline ? ' active' : ''}`}
                onClick={handleUnderlineToggle}
                title="Underline"
              >
                <u>U</u>
              </button>
            </div>
          </div>
        </div>

        <div className="format-panel-actions">
          <button className="format-btn format-btn-cancel" onClick={handleCancel}>Cancel</button>
          <button className="format-btn format-btn-ok" onClick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  );
};

export default FormatPanel;

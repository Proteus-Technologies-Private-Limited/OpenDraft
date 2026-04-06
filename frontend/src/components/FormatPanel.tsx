import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import FontPicker from './FontPicker';
import { FONT_REGISTRY, loadFont } from '../utils/fonts';
import { useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { getCurrentElementRule, getLockedFormatting } from '../utils/effectiveFormatting';

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

interface FormatPanelProps {
  editor: Editor;
  onClose: () => void;
}

const FormatPanel: React.FC<FormatPanelProps> = ({ editor, onClose }) => {
  const { fontFamily: pageFont, fontSize: pageFontSize } = useEditorStore();

  // Per-attribute locking from active template
  const activeTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate());
  const isEnforceMode = activeTemplate.mode === 'enforce';
  const rule = getCurrentElementRule(editor, activeTemplate);
  const locked = getLockedFormatting(rule, isEnforceMode);

  // Snapshot the current state so we can restore on Cancel
  const snapshotRef = useRef<string | null>(null);
  const selectionRef = useRef({ from: editor.state.selection.from, to: editor.state.selection.to });

  // Detect current formatting at cursor
  const attrs = editor.getAttributes('textStyle');
  const initialFont = (attrs.fontFamily as string) || rule?.fontFamily || pageFont;
  const initialSizeStr = (attrs.fontSize as string) || '';
  const initialSize = initialSizeStr ? parseInt(initialSizeStr, 10) || (rule?.fontSize ?? pageFontSize) : (rule?.fontSize ?? pageFontSize);
  const initialBold = editor.isActive('bold');
  const initialItalic = editor.isActive('italic');
  const initialUnderline = editor.isActive('underline');
  const initialStrike = editor.isActive('strike');
  const initialSubscript = editor.isActive('subscript');
  const initialSuperscript = editor.isActive('superscript');
  const initialColor = (editor.getAttributes('textStyle').color as string) || '';
  const initialHighlight = (editor.getAttributes('highlight').color as string) || '';

  const [font, setFont] = useState(initialFont);
  const [size, setSize] = useState(initialSize);
  const [bold, setBold] = useState(initialBold);
  const [italic, setItalic] = useState(initialItalic);
  const [underline, setUnderline] = useState(initialUnderline);
  const [strike, setStrike] = useState(initialStrike);
  const [subscript, setSubscript] = useState(initialSubscript);
  const [superscript, setSuperscript] = useState(initialSuperscript);
  const [textColor, setTextColor] = useState(initialColor);
  const [highlightColor, setHighlightColor] = useState(initialHighlight);
  const [extraFonts, setExtraFonts] = useState<string[]>([]);

  // ── Drag support ──
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag via header, not close button
    if ((e.target as HTMLElement).closest('.format-panel-close')) return;
    dragging.current = true;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (!panelPos) setPanelPos({ x: rect.left, y: rect.top });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelPos]);

  const onHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !dragOffset) return;
    setPanelPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
  }, [dragOffset]);

  const onHeaderPointerUp = useCallback(() => {
    dragging.current = false;
    setDragOffset(null);
  }, []);

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
    (opts: {
      f: string; s: number; b: boolean; i: boolean; u: boolean;
      st: boolean; sub: boolean; sup: boolean; col: string; hl: string;
    }) => {
      const { from, to } = selectionRef.current;
      const sel = { from, to };

      // Font
      const DEFAULT_FONTS = ['Courier Final Draft', 'Courier Prime', 'Courier New', 'Courier'];
      if (DEFAULT_FONTS.includes(opts.f)) {
        editor.chain().focus().setTextSelection(sel).setMark('textStyle', { fontFamily: null }).run();
      } else {
        editor.chain().focus().setTextSelection(sel).setMark('textStyle', { fontFamily: opts.f }).run();
      }

      // Size
      if (opts.s === 12) {
        editor.chain().focus().setTextSelection(sel).setMark('textStyle', { fontSize: null }).run();
      } else {
        editor.chain().focus().setTextSelection(sel).setFontSize(`${opts.s}pt`).run();
      }

      // Toggle marks
      if (opts.b !== editor.isActive('bold'))
        editor.chain().focus().setTextSelection(sel).toggleBold().run();
      if (opts.i !== editor.isActive('italic'))
        editor.chain().focus().setTextSelection(sel).toggleItalic().run();
      if (opts.u !== editor.isActive('underline'))
        editor.chain().focus().setTextSelection(sel).toggleUnderline().run();
      if (opts.st !== editor.isActive('strike'))
        editor.chain().focus().setTextSelection(sel).toggleStrike().run();
      if (opts.sub !== editor.isActive('subscript'))
        editor.chain().focus().setTextSelection(sel).toggleSubscript().run();
      if (opts.sup !== editor.isActive('superscript'))
        editor.chain().focus().setTextSelection(sel).toggleSuperscript().run();

      // Text color
      if (opts.col) {
        editor.chain().focus().setTextSelection(sel).setColor(opts.col).run();
      } else {
        editor.chain().focus().setTextSelection(sel).unsetColor().run();
      }

      // Highlight
      if (opts.hl) {
        editor.chain().focus().setTextSelection(sel).toggleHighlight({ color: opts.hl }).run();
      } else {
        editor.chain().focus().setTextSelection(sel).unsetHighlight().run();
      }
    },
    [editor],
  );

  const preview = (overrides: Partial<{
    f: string; s: number; b: boolean; i: boolean; u: boolean;
    st: boolean; sub: boolean; sup: boolean; col: string; hl: string;
  }> = {}) => {
    applyPreview({
      f: overrides.f ?? font, s: overrides.s ?? size,
      b: overrides.b ?? bold, i: overrides.i ?? italic, u: overrides.u ?? underline,
      st: overrides.st ?? strike, sub: overrides.sub ?? subscript, sup: overrides.sup ?? superscript,
      col: overrides.col ?? textColor, hl: overrides.hl ?? highlightColor,
    });
  };

  const handleFontChange = (f: string) => {
    setFont(f);
    const entry = FONT_REGISTRY.find((e) => e.name === f);
    if (entry) loadFont(entry);
    preview({ f });
  };

  const handleSizeChange = (s: number) => {
    setSize(s);
    preview({ s });
  };

  const handleBoldToggle = () => { const v = !bold; setBold(v); preview({ b: v }); };
  const handleItalicToggle = () => { const v = !italic; setItalic(v); preview({ i: v }); };
  const handleUnderlineToggle = () => { const v = !underline; setUnderline(v); preview({ u: v }); };
  const handleStrikeToggle = () => { const v = !strike; setStrike(v); preview({ st: v }); };
  const handleSubscriptToggle = () => { const v = !subscript; setSubscript(v); preview({ sub: v }); };
  const handleSuperscriptToggle = () => { const v = !superscript; setSuperscript(v); preview({ sup: v }); };
  const handleTextColorChange = (c: string) => { setTextColor(c); preview({ col: c }); };
  const handleHighlightChange = (c: string) => { setHighlightColor(c); preview({ hl: c }); };

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
      <div
        className="format-panel"
        ref={panelRef}
        style={panelPos ? { position: 'fixed', left: panelPos.x, top: panelPos.y, margin: 0 } : undefined}
      >
        <div
          className="format-panel-header"
          style={{ cursor: 'move' }}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
        >
          <span>Font & Formatting</span>
          <button
            className="format-panel-close"
            onClick={handleCancel}
            aria-label="Close formatting panel"
          >
            &times;
          </button>
        </div>

        <div className="format-panel-body">
          {/* Font family */}
          <div className="format-row" style={locked.fontFamily ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
            <label className="format-label">Font</label>
            <FontPicker value={font} extraFonts={extraFonts} onChange={handleFontChange} />
          </div>

          {/* Font size */}
          <div className="format-row">
            <label className="format-label">Size</label>
            <select
              className="format-size-select"
              value={size}
              disabled={locked.fontSize}
              onChange={(e) => handleSizeChange(Number(e.target.value))}
              aria-label="Font size"
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
              <button className={`format-style-btn${bold ? ' active' : ''}`} onClick={handleBoldToggle} disabled={locked.bold} title="Bold"><strong>B</strong></button>
              <button className={`format-style-btn${italic ? ' active' : ''}`} onClick={handleItalicToggle} disabled={locked.italic} title="Italic"><em>I</em></button>
              <button className={`format-style-btn${underline ? ' active' : ''}`} onClick={handleUnderlineToggle} disabled={locked.underline} title="Underline"><u>U</u></button>
              <button className={`format-style-btn${strike ? ' active' : ''}`} onClick={handleStrikeToggle} disabled={locked.strikethrough} title="Strikethrough"><s>S</s></button>
              <button className={`format-style-btn${subscript ? ' active' : ''}`} onClick={handleSubscriptToggle} disabled={locked.subscript} title="Subscript" style={{ fontSize: '0.75em' }}>X<sub>2</sub></button>
              <button className={`format-style-btn${superscript ? ' active' : ''}`} onClick={handleSuperscriptToggle} disabled={locked.superscript} title="Superscript" style={{ fontSize: '0.75em' }}>X<sup>2</sup></button>
            </div>
          </div>

          {/* Text color */}
          <div className="format-row" style={locked.textColor ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
            <label className="format-label">Color</label>
            <div className="format-color-row">
              <input
                type="color"
                value={textColor || '#000000'}
                onChange={(e) => handleTextColorChange(e.target.value)}
                className="format-color-input"
                title="Text color"
              />
              <span className="format-color-hex">{textColor || 'Default'}</span>
              {textColor && <button className="format-color-reset" onClick={() => handleTextColorChange('')}>Reset</button>}
            </div>
          </div>

          {/* Highlight color */}
          <div className="format-row" style={locked.backgroundColor ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
            <label className="format-label">Highlight</label>
            <div className="format-color-row">
              <input
                type="color"
                value={highlightColor || '#ffff00'}
                onChange={(e) => handleHighlightChange(e.target.value)}
                className="format-color-input"
                title="Highlight color"
              />
              <span className="format-color-hex">{highlightColor || 'None'}</span>
              {highlightColor && <button className="format-color-reset" onClick={() => handleHighlightChange('')}>Reset</button>}
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

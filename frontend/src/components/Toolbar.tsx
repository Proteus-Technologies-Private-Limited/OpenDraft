import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor } from '@tiptap/react';
import type { Mark } from '@tiptap/pm/model';
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
  FaSearch,
  FaStickyNote,
  FaTags,
  FaPaintBrush,
  FaHighlighter,
  FaEllipsisV,
  FaHashtag,
  FaPlus,
  FaTrashAlt,
  FaFile,
  FaFolderOpen,
  FaSave,
  FaFilePdf,
  FaFileAlt,
  FaListOl,
  FaTable,
  FaSun,
  FaMoon,
  FaCompass,
  FaSlidersH,
  FaParagraph,
  FaFont,
  FaTextHeight,
} from 'react-icons/fa';
import { useEditorStore, useEditorFields } from '../stores/editorStore';
import { useEditorSelector } from '../hooks/useEditorTransactions';
import type { ElementType } from '../stores/editorStore';
import { addScriptNoteAtSelection, scriptNoteAtSelection } from '../utils/addScriptNote';
import { panelButtonAction } from '../utils/panelButton';
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
import { findFont, loadFontByName } from '../utils/fonts';
import { isTitlePageRuleId, AV_BLOCK_RULE_ID } from '../stores/formattingTypes';
import { isInAvCell, isInAvRow, avCellSideAt } from '../editor/extensions/AvBlock';
import { avCellElementRules, scriptBodyElementRules } from '../utils/avCellElements';
import Select from './Select';
import { useFoldState } from '../hooks/useFoldState';
import { PHONE_DEVICE_CHANGE_EVENT } from '../utils/phoneDevice';
import { FOLD_CHANGE_EVENT } from '../utils/foldPosture';
import { formatShortcut } from '../utils/shortcuts';
import { elementShortcutSpec } from '../utils/elementShortcuts';
import { elementLabel, elementDescription } from '../editor/elementLabels';
import { pluginRegistry } from '../plugins/registry';
import { requestAppCommand } from '../utils/appCommands';
import {
  TOOLBAR_PANEL_PREFIX,
  TOOLBAR_PLUGIN_PREFIX,
  effectiveLabel,
  splitBySide,
  toolbarItemDefinition,
  type ToolbarBar,
  type ToolbarLabelMode,
  type ToolbarSide,
} from '../utils/toolbarLayout';
import { togglePanel, usePanelOpen } from '../utils/panelActions';
import { panelIcon, usePanelLabel } from './toolbar/toolbarMeta';
import ZoomControl from './toolbar/ZoomControl';
import LayoutSwitcher from './toolbar/LayoutSwitcher';
import ViewsMenu from './toolbar/ViewsMenu';
import StatusZoom from './StatusZoom';

interface ToolbarProps {
  editor: Editor | null;
}

/** The shortcut that reaches an element, for the dropdown's right-hand column. */
const shortcutFor = (id: string): string | undefined => {
  const spec = elementShortcutSpec(id);
  return spec ? formatShortcut(spec) : undefined;
};

/** Whether the selection is the whole script — Select All, or every position. */
function selectionCoversScript(state: import('@tiptap/pm/state').EditorState): boolean {
  const { from, to } = state.selection;
  return from <= 1 && to >= state.doc.content.size - 1;
}

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

const CARET_MARKS = ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript'] as const;
type CaretMark = typeof CARET_MARKS[number];
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

const orFalse = (read: () => boolean) => { try { return read(); } catch { return false; } };

/** What the toolbar shows of the caret's place in the script. */
function selectCaret(ed: Editor | null) {
  if (!ed) return null;
  const { state } = ed;
  const can = ed.can() as unknown as { undo?: () => boolean; redo?: () => boolean };
  let avCellSide: 'video' | 'audio' = 'video';
  try { avCellSide = avCellSideAt(state) || 'video'; } catch { /* ignore */ }
  return {
    marks: Object.fromEntries(CARET_MARKS.map((m) => [m, ed.isActive(m)])) as Record<CaretMark, boolean>,
    align: ALIGNMENTS.find((a) => ed.isActive({ textAlign: a })) ?? null,
    canUndo: orFalse(() => typeof can.undo === 'function' && can.undo()),
    canRedo: orFalse(() => typeof can.redo === 'function' && can.redo()),
    inAvCell: orFalse(() => isInAvCell(state)),
    avCellSide,
    // A storyboard frame is an atom, so clicking one leaves a NodeSelection on
    // the frame and no avCell in its ancestry; the row controls test the row.
    inAvRow: orFalse(() => isInAvRow(state)),
  };
}

/** A button's face: its icon, its name, or both, as the writer chose. */
function face(mode: ToolbarLabelMode, icon: React.ReactNode, text: string): React.ReactNode {
  return (
    <>
      {mode !== 'text' && icon}
      {(mode === 'text' || mode === 'both') && <span className="toolbar-btn-label">{text}</span>}
    </>
  );
}

/** The heading before a drop-down; drop-downs alone may show none. */
function heading(mode: ToolbarLabelMode, icon: React.ReactNode, text: string): React.ReactNode {
  if (mode === 'none') return null;
  return <span className="toolbar-heading" aria-hidden="true">{face(mode, icon, text)}</span>;
}

/** A button that opens one workspace panel wherever the layout puts it. */
function PanelButton({ panel, mode, onDone }: { panel: string; mode: ToolbarLabelMode; onDone?: () => void }) {
  const open = usePanelOpen(panel);
  const panelLabel = usePanelLabel();
  const label = panelLabel(panel);
  return (
    <div className="toolbar-group">
      <button
        type="button"
        className={`toolbar-btn${open ? ' active' : ''}`}
        aria-pressed={open}
        title={label}
        aria-label={mode === 'icon' ? label : undefined}
        onClick={() => { togglePanel(panel); onDone?.(); }}
      >
        {face(mode, panelIcon(panel), label)}
      </button>
    </div>
  );
}

/** Right-click on either bar: customise it. */
function BarContextMenu({ at, onClose }: { at: { x: number; y: number }; onClose: () => void }) {
  const { t } = useTranslation('toolbar');
  const setLayoutDialog = useEditorStore((s) => s.setLayoutDialog);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div ref={ref} className="toolbar-context-menu" style={{ left: at.x, top: at.y }} role="menu" aria-label={t('layout.customiseBars')}
      onContextMenu={(e) => e.stopPropagation()}>
      <button type="button" className="toolbar-context-item" role="menuitem" onClick={() => { onClose(); setLayoutDialog('toolbar'); }}>
        <FaSlidersH /> {t('layout.customiseBars')}
      </button>
      <button type="button" className="toolbar-context-item" role="menuitem" onClick={() => { onClose(); setLayoutDialog('panels'); }}>
        <FaCompass /> {t('layout.editLayouts')}
      </button>
    </div>
  );
}

/**
 * Right-click a bar for Customise. Inputs and drop-downs keep their own menu
 * (paste into the zoom box, for instance).
 */
function useBarContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 100) });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  const element = menu ? <BarContextMenu at={menu} onClose={close} /> : null;
  return { onContextMenu, element };
}

interface ControlBarProps {
  editor: Editor | null;
  bar: ToolbarBar;
  /** The footer draws its two sides in two places; the toolbar draws both. */
  side?: ToolbarSide;
  /** The script pane, for the zoom slider's Fit width. */
  editorMain?: HTMLElement | null;
}

/**
 * The controls of one bar, in the writer's order (toolbarLayout.ts). The
 * toolbar folds what does not fit into its "…" menu; the footer shows what it
 * has been given.
 */
const ControlBar: React.FC<ControlBarProps> = ({ editor, bar, side, editorMain = null }) => {
  const foldState = useFoldState();
  const { t } = useTranslation(['toolbar', 'common']);
  const {
    activeElement,
    setActiveElement,
    zoomPanelOpen,
    setZoomPanelOpen,
    fontFamily,
    fontSize,
    setSearchOpen,
    setGoToPageOpen,
    scriptNotesOpen,
    toggleScriptNotes,
    tagsPanelOpen,
    toggleTagsPanel,
    setPendingTagSelection,
    setEditingTagId,
    toolbarMode: savedToolbarMode,
    focusMode,
    toolbarLayout,
    setLayoutDialog,
    navigatorOpen,
    toggleNavigator,
    appearance,
    setAppearance,
    sceneNumbersVisible,
    setSceneNumbersVisible,
    pageLayout,
  } = useEditorFields(
    'activeElement',
    'setActiveElement',
    'zoomPanelOpen',
    'setZoomPanelOpen',
    'fontFamily',
    'fontSize',
    'setSearchOpen',
    'setGoToPageOpen',
    'scriptNotesOpen',
    'toggleScriptNotes',
    'tagsPanelOpen',
    'toggleTagsPanel',
    'setPendingTagSelection',
    'setEditingTagId',
    'toolbarMode',
    'focusMode',
    'toolbarLayout',
    'setLayoutDialog',
    'navigatorOpen',
    'toggleNavigator',
    'appearance',
    'setAppearance',
    'sceneNumbersVisible',
    'setSceneNumbersVisible',
    'pageLayout',
  );
  const isTop = bar === 'top';
  // Focus Mode hides the toolbar like Hidden does, keeping the saved choice.
  const toolbarMode = focusMode ? 'hidden' : savedToolbarMode;

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

  // Track the font/size of the text at current cursor position. Empty string
  // / null indicates the selection spans more than one value ("mixed").
  const [cursorFont, setCursorFont] = useState<string>(fontFamily);
  // The size the whole script is set at: the layout's, saved with the script,
  // else the page default. Text without its own size mark is drawn at it.
  const scriptSize = pageLayout.fontSize ?? fontSize;
  const [cursorSize, setCursorSize] = useState<number | null>(scriptSize);
  // Fonts found in document that aren't in the registry
  const [extraFonts, setExtraFonts] = useState<string[]>([]);

  // The controls this bar draws. Formatting detection below is only needed
  // when one of them shows the caret's font or locks.
  const { start: startItems, end: endItems } = useMemo(() => {
    const split = splitBySide(toolbarLayout.bars[bar], toolbarLayout.options);
    if (side === 'start') return { start: split.start, end: [] };
    if (side === 'end') return { start: [], end: split.end };
    return split;
  }, [toolbarLayout, bar, side]);
  const allItems = useMemo(() => [...startItems, ...endItems], [startItems, endItems]);
  const needsFormatting = allItems.some((id) => id === 'font' || id === 'font-size' || id === 'format' || id === 'align');

  const detectFormatting = useCallback(() => {
    if (!editor) return;

    // Update locked formatting for current element
    const rule = getCurrentElementRule(editor, activeTemplate);
    setLocked(getLockedFormatting(rule, isEnforceMode));

    const { from, to, empty } = editor.state.selection;

    // For an empty cursor, fall back to the textStyle mark at that position.
    if (empty) {
      const attrs = editor.getAttributes('textStyle');
      const detectedFont = (attrs.fontFamily as string | undefined) || '';
      const detectedSize = (attrs.fontSize as string | undefined) || '';
      const effectiveFont = detectedFont || rule?.fontFamily || fontFamily;
      setCursorFont(effectiveFont);
      if (effectiveFont && !findFont(effectiveFont)) {
        setExtraFonts((prev) => (prev.includes(effectiveFont) ? prev : [...prev, effectiveFont]));
      }
      if (detectedSize) {
        const parsed = parseInt(detectedSize, 10);
        setCursorSize(!isNaN(parsed) ? parsed : (rule?.fontSize ?? scriptSize));
      } else {
        setCursorSize(rule?.fontSize ?? scriptSize);
      }
      return;
    }

    // For a real selection, walk the text nodes within [from, to]. If every
    // text node carries the same fontFamily / fontSize, show that value;
    // otherwise show the picker as blank to indicate "mixed".
    const fonts = new Set<string>();
    const sizes = new Set<string>();
    let sawText = false;
    editor.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText || !node.text) return;
      const start = Math.max(pos, from);
      const end = Math.min(pos + node.nodeSize, to);
      if (end <= start) return;
      sawText = true;
      const ts = node.marks.find((m) => m.type.name === 'textStyle');
      const ff = (ts?.attrs.fontFamily as string | undefined) || '';
      const fs = (ts?.attrs.fontSize as string | undefined) || '';
      fonts.add(ff);
      sizes.add(fs);
    });

    if (!sawText) {
      // Selection contains only block boundaries / no text — fall back to cursor attrs.
      const attrs = editor.getAttributes('textStyle');
      const detectedFont = (attrs.fontFamily as string | undefined) || '';
      const detectedSize = (attrs.fontSize as string | undefined) || '';
      const effectiveFont = detectedFont || rule?.fontFamily || fontFamily;
      setCursorFont(effectiveFont);
      if (detectedSize) {
        const parsed = parseInt(detectedSize, 10);
        setCursorSize(!isNaN(parsed) ? parsed : (rule?.fontSize ?? scriptSize));
      } else {
        setCursorSize(rule?.fontSize ?? scriptSize);
      }
      return;
    }

    if (fonts.size > 1) {
      setCursorFont('');
    } else {
      const single = [...fonts][0] || '';
      const effective = single || rule?.fontFamily || fontFamily;
      setCursorFont(effective);
      if (effective && !findFont(effective)) {
        setExtraFonts((prev) => (prev.includes(effective) ? prev : [...prev, effective]));
      }
    }

    if (sizes.size > 1) {
      setCursorSize(null);
    } else {
      const single = [...sizes][0] || '';
      if (single) {
        const parsed = parseInt(single, 10);
        setCursorSize(!isNaN(parsed) ? parsed : (rule?.fontSize ?? scriptSize));
      } else {
        setCursorSize(rule?.fontSize ?? scriptSize);
      }
    }
  }, [editor, fontFamily, scriptSize, activeTemplate, isEnforceMode]);

  useEffect(() => {
    if (!editor || !needsFormatting) return;
    editor.on('selectionUpdate', detectFormatting);
    editor.on('transaction', detectFormatting);
    // Run once on mount / editor ready
    detectFormatting();
    return () => {
      editor.off('selectionUpdate', detectFormatting);
      editor.off('transaction', detectFormatting);
    };
  }, [editor, detectFormatting, needsFormatting]);

  // Collect all unique fonts used in the document (for extra fonts display).
  // One bar does this: the font picker is on at most one of them.
  const collectsFonts = allItems.includes('font');
  useEffect(() => {
    if (!editor || !collectsFonts) return;
    const collectFonts = () => {
      const found = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (node.isText && node.marks) {
          for (const mark of node.marks) {
            if (mark.type.name === 'textStyle' && mark.attrs.fontFamily) {
              const f = mark.attrs.fontFamily as string;
              if (findFont(f)) {
                // A font the app knows: make sure it is actually loaded, so a
                // script written elsewhere renders in the face it names rather
                // than only once someone opens the picker.
                loadFontByName(f);
              } else {
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
  }, [editor, collectsFonts]);

  const handleElementChange = (e: { target: { value: string } }) => {
    const type = e.target.value;
    if (!editor) return;
    setActiveElement(type as ElementType);
    // Three cases:
    //   1. Built-in screenplay element (sceneHeading, action, etc.) — direct setNode
    //   2. Real schema node not in BUILT_IN list (avPara, avShot, avDirection) — also direct setNode
    //   3. Template-declared custom id (sceneCharacters, soundEffect, etc.) — wrap as customElement
    // "AV Columns" inserts a two-column body rather than restyling the line.
    if (type === AV_BLOCK_RULE_ID) {
      editor.chain().focus().insertAvRow('below').run();
      return;
    }
    if (BUILT_IN_ELEMENT_IDS.includes(type)) {
      editor.chain().focus().setNode(type).run();
      return;
    }
    if (editor.schema.nodes[type]) {
      editor.chain().focus().setNode(type).run();
      return;
    }
    const rule = activeTemplate.rules[type];
    if (rule) {
      editor.chain().focus().setNode('customElement', {
        customTypeId: type,
        customLabel: rule.label,
      }).run();
    }
  };

  /** True when the selection is inside an AV cell — used to scope the element dropdown. */
  const isInTitlePage = isTitlePageRuleId(String(activeElement));

  // Selected rather than read while rendering, so the toolbar re-renders when
  // one of these changes and not on every keystroke (#229). Read off the live
  // state on each transaction: a wholesale content replacement — restoring a
  // session, opening a file — need not fire a selection update, and anything
  // keyed on `activeElement` answered for a document that no longer existed.
  const caret = useEditorSelector(editor, selectCaret, null, 'the toolbar state');
  const isInsideAvCell = caret?.inAvCell ?? false;
  /** Which column the caret is in — the element list differs between them. */
  const avCellSide = caret?.avCellSide ?? 'video';
  /** The same question one level out, for the row controls. */
  const isInsideAvRow = (caret?.inAvRow ?? false) && isTop;
  const isActive = (format: CaretMark) => caret?.marks[format] ?? false;

  // ── Responsive overflow (toolbar only) ──────────────────────────────
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set());
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

  const zoomOnBar = isTop && allItems.includes('zoom');

  /**
   * Which controls give way first when the bar runs out of room: zoom first
   * (the narrow layout has its own zoom button), then the start side from its
   * far end back, then the end side, and Notes & Tags last of all. Undo/redo
   * and the element picker never fold.
   */
  const hideOrder = useMemo(() => {
    const folds = (id: string) => id !== 'zoom' && id !== 'notes' && !toolbarItemDefinition(id)?.fixed;
    const order: string[] = [];
    if (zoomOnBar) order.push('zoom');
    order.push(...[...startItems].reverse().filter(folds));
    order.push(...[...endItems].reverse().filter(folds));
    if (allItems.includes('notes')) order.push('notes');
    return order;
  }, [startItems, endItems, allItems, zoomOnBar]);

  /**
   * True while the narrow-layout single zoom button is on screen.  Below the
   * mobile breakpoint the CSS swaps the desktop zoom controls for that button,
   * so repeating zoom inside the overflow menu would offer the same control
   * twice.
   */
  const [mobileZoomVisible, setMobileZoomVisible] = useState(false);

  /** Set by the measuring effect below; lets other state changes re-run it. */
  const remeasureRef = useRef<() => void>(() => {});

  // The AV row group is the one toolbar content that comes and goes with the
  // cursor rather than with the window, so it is the one the ResizeObserver
  // below cannot see. A plugin registering a control changes it too.
  useEffect(() => { remeasureRef.current(); }, [isInsideAvRow]);
  useEffect(() => pluginRegistry.subscribe(() => remeasureRef.current()), []);

  // Measure toolbar overflow and decide which controls fold into the menu
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !isTop) return;

    const measure = () => {
      const containerWidth = toolbar.clientWidth;
      const blocks = toolbar.querySelectorAll<HTMLElement>('[data-priority]');
      if (blocks.length === 0) { setHiddenItems(prev => (prev.size ? new Set() : prev)); return; }

      const mobileZoom = toolbar.querySelector<HTMLElement>('.zoom-mobile-group');
      setMobileZoomVisible(!!mobileZoom && mobileZoom.offsetWidth > 0);

      // Show all blocks to measure natural widths
      blocks.forEach(g => g.style.display = '');

      const OVERFLOW_BTN_WIDTH = 36;
      const gap = parseFloat(getComputedStyle(toolbar).columnGap) || 2;
      const placed: { el: HTMLElement; key: string }[] = [];
      const newHidden = new Set<string>();

      // Width as the flex row spends it: offsetWidth leaves out margins and
      // the bar's gap, which made the estimate too small (PR #217).
      const outerWidth = (el: HTMLElement) => {
        const cs = getComputedStyle(el);
        return el.offsetWidth + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0) + gap;
      };

      let totalWidth = 0;
      for (const child of toolbar.children) {
        const el = child as HTMLElement;
        // The flexible spacer takes whatever room is left; it is not content.
        if (el.classList.contains('toolbar-spacer')) continue;
        const w = el.offsetWidth;
        if (el.dataset.priority) {
          // CSS-hidden items (e.g. toolbar-desktop-only on mobile) have 0 width —
          // mark them as hidden so they appear in the overflow menu.
          if (w === 0) newHidden.add(el.dataset.priority);
          else placed.push({ el, key: el.dataset.priority });
        }
        totalWidth += outerWidth(el);
      }

      // A foldable held as a book wraps the toolbar onto two rows on the
      // right half (screenplay.css, #231). Width sums cannot say how groups
      // pack into rows, so measure the wrapped layout itself, hiding groups in
      // the usual order until both rows hold what is left, with room for the
      // "…" button that then appears.
      const twoRows = document.documentElement.classList.contains('fold-book');
      if (twoRows) {
        const visible = () => Array.from(toolbar.children).filter((c): c is HTMLElement => (c as HTMLElement).offsetWidth > 0);
        const roomForOverflow = () => {
          if (toolbar.querySelector('.toolbar-overflow-wrap')) return true;
          const kids = visible();
          if (kids.length === 0) return true;
          const firstTop = Math.min(...kids.map(k => k.offsetTop));
          const lastTop = Math.max(...kids.map(k => k.offsetTop));
          if (lastTop - firstTop < 10) return true; // one row used: the second is free
          const lastRight = Math.max(...kids.filter(k => k.offsetTop >= lastTop - 2).map(k => k.offsetLeft + k.offsetWidth));
          const padRight = parseFloat(getComputedStyle(toolbar).paddingRight) || 0;
          return toolbar.clientWidth - padRight - lastRight >= OVERFLOW_BTN_WIDTH + 4;
        };
        const fits = () => toolbar.scrollHeight <= toolbar.clientHeight + 1 && roomForOverflow();
        for (const id of hideOrder) {
          if (fits()) break;
          for (const { el, key } of placed.filter(p => p.key === id)) {
            newHidden.add(key);
            el.style.display = 'none';
          }
        }
      } else if (totalWidth > containerWidth) {
        let currentTotal = totalWidth + OVERFLOW_BTN_WIDTH;
        for (const id of hideOrder) {
          if (currentTotal <= containerWidth) break;
          // Notes & Tags go only when the bar really does not fit: the
          // estimate is generous, and a 402px iPhone lost them where they fit.
          // The controls hidden so far are already display:none, so the bar's
          // own overflow is the truth — plus the "…" if it has yet to appear.
          if (id === 'notes') {
            const reserve = toolbar.querySelector('.toolbar-overflow-wrap') ? 0 : OVERFLOW_BTN_WIDTH;
            if (toolbar.scrollWidth + reserve <= toolbar.clientWidth) break;
          }
          for (const { el, key } of placed.filter(p => p.key === id)) {
            newHidden.add(key);
            currentTotal -= outerWidth(el);
            el.style.display = 'none';
          }
        }
      }

      setHiddenItems(prev => {
        if (prev.size !== newHidden.size) return newHidden;
        for (const p of newHidden) { if (!prev.has(p)) return newHidden; }
        return prev;
      });
    };

    let rafId = 0;
    let lastWidth = 0;
    const remeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };
    remeasureRef.current = remeasure;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      // Only re-measure if container width actually changed (not just internal reflow)
      if (w === lastWidth) return;
      lastWidth = w;
      remeasure();
    });
    ro.observe(toolbar);
    // Phone chrome switched on or off (main.tsx): every button changed size.
    window.addEventListener(PHONE_DEVICE_CHANGE_EVENT, remeasure);
    // A fold changes the chrome (Compact on the open screen, two rows held as
    // a book) after the width the observer saw, and on the iPhone Duo the
    // settled layout came a beat later still. So measure again after a fold,
    // and once more when it has settled.
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const remeasureAfterFold = () => {
      remeasure();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(remeasure, 300);
    };
    window.addEventListener(FOLD_CHANGE_EVENT, remeasureAfterFold);

    // Crossing the mobile breakpoint changes which groups the stylesheet hides,
    // and on iPad that can happen without the toolbar's own width changing.
    // Legacy WebKit (Safari < 14) ships a MediaQueryList without
    // addEventListener — only addListener/removeListener — so detect both.
    const breakpoint = window.matchMedia?.('(max-width: 768px)');
    if (breakpoint) {
      if (typeof breakpoint.addEventListener === 'function') {
        breakpoint.addEventListener('change', remeasure);
      } else if (typeof breakpoint.addListener === 'function') {
        breakpoint.addListener(remeasure);
      }
    }

    requestAnimationFrame(measure);
    return () => {
      ro.disconnect();
      window.removeEventListener(PHONE_DEVICE_CHANGE_EVENT, remeasure);
      window.removeEventListener(FOLD_CHANGE_EVENT, remeasureAfterFold);
      clearTimeout(settleTimer);
      if (breakpoint) {
        if (typeof breakpoint.removeEventListener === 'function') {
          breakpoint.removeEventListener('change', remeasure);
        } else if (typeof breakpoint.removeListener === 'function') {
          breakpoint.removeListener(remeasure);
        }
      }
      cancelAnimationFrame(rafId);
    };
    // The layout's labels change widths without changing the item list.
  }, [isTop, hideOrder, toolbarLayout, toolbarMode, foldState.foldable, foldState.size, foldState.fold]);

  // ── Notes handler (shared between inline and overflow) ──
  const handleNotesClick = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!editor) { toggleScriptNotes(); return; }
    // A second click closes the panel, but only when it would otherwise add a
    // note to the whole current element or focus a note under the caret. With
    // a selection it must still add the note the writer selected.
    if (panelButtonAction(
      scriptNotesOpen,
      editor.state.selection.empty,
      scriptNoteAtSelection(editor) !== null,
    ) === 'close') {
      toggleScriptNotes();
      return;
    }
    addScriptNoteAtSelection(editor);
  }, [editor, scriptNotesOpen, toggleScriptNotes]);

  // ── Tags handler (shared between inline and overflow) ──
  const handleTagsClick = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    if (!editor) { toggleTagsPanel(); return; }

    const markType = editor.schema.marks.productionTag;
    const $from = editor.state.selection.$from;
    let tagMark: Mark | null = null;
    if (markType) {
      tagMark = $from.marks().find((m) => m.type === markType) ?? null;
      if (!tagMark) {
        const node = $from.nodeAfter || $from.nodeBefore;
        if (node?.marks) tagMark = node.marks.find((m) => m.type === markType) ?? null;
      }
    }

    // As with Notes: close on a plain second click, but a selection or a tag
    // under the caret keeps the add/focus action.
    if (panelButtonAction(tagsPanelOpen, editor.state.selection.empty, tagMark !== null) === 'close') {
      toggleTagsPanel();
      return;
    }

    if (tagMark) {
      setEditingTagId(tagMark.attrs.tagId as string);
      if (!tagsPanelOpen) toggleTagsPanel();
      return;
    }

    const { from, to, empty } = editor.state.selection;
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

  // ── One renderer per control. `mode` is the label the writer chose. ──

  const closeOverflow = (inOverflow: boolean) => { if (inOverflow) setOverflowOpen(false); };

  const renderUndoRedo = (mode: ToolbarLabelMode) => (
    <div className="toolbar-group" key="undo-redo">
      <button
        className="toolbar-btn"
        title={t('toolbar.undo', { shortcut: '⌘Z' })}
        aria-label={mode === 'icon' ? t('layout.labels.undo') : undefined}
        onClick={() => { try { editor?.chain().focus().undo().run(); } catch { /* nothing to undo */ } }}
        disabled={!caret?.canUndo}
      >
        {face(mode, <FaUndo />, t('layout.labels.undo'))}
      </button>
      <button
        className="toolbar-btn"
        title={t('toolbar.redo', { shortcut: '⇧⌘Z' })}
        aria-label={mode === 'icon' ? t('layout.labels.redo') : undefined}
        onClick={() => { try { editor?.chain().focus().redo().run(); } catch { /* nothing to redo */ } }}
        disabled={!caret?.canRedo}
      >
        {face(mode, <FaRedo />, t('layout.labels.redo'))}
      </button>
    </div>
  );

  const renderElement = (mode: ToolbarLabelMode) => (
    <div className="toolbar-group" key="element">
      {heading(mode, <FaParagraph />, t('layout.labels.element'))}
      <Select
        className="element-selector"
        value={activeElement}
        onChange={handleElementChange}
        disabled={isInTitlePage}
        title={isInTitlePage
          ? t('toolbar.elementTypeTitlePage')
          : t('toolbar.elementType')}
      >
        {/* The title page's fields have template rules but are not things a
            paragraph converts into, so they never appear here — only as the
            read-only label below when the cursor is actually in one. */}
        {isInTitlePage && (
          <option value={activeElement}>
            {activeTemplate.rules[activeElement]?.label || t('toolbar.titlePage')}
          </option>
        )}
        {/* Inside an AV cell the list is resolved by utils/avCellElements.ts;
            outside a cell, the template is the authority. */}
        {(isInsideAvCell
          ? avCellElementRules(activeTemplate, avCellSide, String(activeElement))
          : scriptBodyElementRules(activeTemplate, isTitlePageRuleId)
        ).map((r) => (
          <option key={r.id} value={r.id} title={elementDescription(r.id)} data-shortcut={shortcutFor(r.id)}>
            {elementLabel(r.id, r.label)}
          </option>
        ))}
      </Select>
    </div>
  );

  const renderFont = (mode: ToolbarLabelMode, inOverflow: boolean) => (
    <div className="toolbar-group" key="font" style={locked.fontFamily ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      {heading(mode, <FaFont />, t('layout.labels.font'))}
      <FontPicker
        value={cursorFont}
        extraFonts={extraFonts}
        onManageFonts={() => useEditorStore.getState().setFontsDialogOpen(true)}
        onChange={(val) => {
          if (locked.fontFamily) return;
          loadFontByName(val);
          // Picking a font styles the selection — it must not rewrite the
          // document's own font. Choosing the document font clears the mark
          // instead, so the text goes back to following the page.
          if (val === fontFamily) {
            editor?.chain().focus(undefined, { scrollIntoView: false }).setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run();
          } else {
            editor?.chain().focus(undefined, { scrollIntoView: false }).setMark('textStyle', { fontFamily: val }).run();
          }
          closeOverflow(inOverflow);
        }}
      />
    </div>
  );

  const renderFontSize = (mode: ToolbarLabelMode, inOverflow: boolean) => (
    <div className="toolbar-group" key="font-size">
      {heading(mode, <FaTextHeight />, t('layout.labels.fontSize'))}
      <Select
        className="font-size-selector"
        value={cursorSize ?? ''}
        disabled={locked.fontSize}
        onChange={(e) => {
          if (locked.fontSize) return;
          if (e.target.value === '') return; // user clicked the mixed placeholder — no-op
          const val = Number(e.target.value);
          // The whole script chosen: set the script's size, which the page
          // count and the PDF follow (#270). The per-run marks it replaces
          // are cleared, so the one setting says what size the script is.
          if (editor && selectionCoversScript(editor.state)) {
            const next = { ...useEditorStore.getState().pageLayout };
            if (val === 12) delete next.fontSize;
            else next.fontSize = val;
            useEditorStore.getState().setPageLayout(next);
            editor.chain().focus(undefined, { scrollIntoView: false })
              .setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
            closeOverflow(inOverflow);
            return;
          }
          // Otherwise selection-scoped, like the font picker.
          if (val === scriptSize) {
            editor?.chain().focus(undefined, { scrollIntoView: false }).setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
          } else {
            editor?.chain().focus(undefined, { scrollIntoView: false }).setFontSize(`${val}pt`).run();
          }
          closeOverflow(inOverflow);
        }}
        title={t('toolbar.fontSize')}
      >
        {/* Mixed-selection placeholder. */}
        {cursorSize === null && (
          <option value="" disabled hidden>—</option>
        )}
        {(cursorSize !== null && !FONT_SIZES.includes(cursorSize)
          ? [...FONT_SIZES, cursorSize].sort((a, b) => a - b)
          : FONT_SIZES
        ).map((s) => (
          <option key={s} value={s}>
            {t('toolbar.pt', { size: s })}
          </option>
        ))}
      </Select>
    </div>
  );

  const markButton = (
    mode: ToolbarLabelMode, mark: CaretMark, icon: React.ReactNode, title: string, name: string,
    disabled: boolean, run: () => void,
  ) => (
    <button
      className={`toolbar-btn ${isActive(mark) ? 'active' : ''}`}
      aria-pressed={isActive(mark)}
      title={title}
      aria-label={mode === 'icon' ? name : undefined}
      disabled={disabled}
      onClick={() => { if (editor && !disabled) run(); }}
    >
      {face(mode, icon, name)}
    </button>
  );

  // showPopups: when false, only render buttons (no ColorPicker popups), so a
  // folded-away inline copy cannot steal the overflow copy's popup state.
  const renderFormat = (mode: ToolbarLabelMode, inOverflow: boolean, showPopups: boolean) => (
    <React.Fragment key="format">
      <div className="toolbar-group">
        {markButton(mode, 'bold', <FaBold />, t('toolbar.bold', { shortcut: '⌘B' }), t('layout.labels.bold'), locked.bold, () => {
          if (isOverrideMode) toggleBoldOverride(editor!, getCurrentElementRule(editor!, activeTemplate));
          else editor!.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run();
        })}
        {markButton(mode, 'italic', <FaItalic />, t('toolbar.italic', { shortcut: '⌘I' }), t('layout.labels.italic'), locked.italic, () => {
          if (isOverrideMode) toggleItalicOverride(editor!, getCurrentElementRule(editor!, activeTemplate));
          else editor!.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run();
        })}
        {markButton(mode, 'underline', <FaUnderline />, t('toolbar.underline', { shortcut: '⌘U' }), t('layout.labels.underline'), locked.underline, () => {
          if (isOverrideMode) toggleUnderlineOverride(editor!, getCurrentElementRule(editor!, activeTemplate));
          else editor!.chain().focus(undefined, { scrollIntoView: false }).toggleUnderline().run();
        })}
        {markButton(mode, 'strike', <FaStrikethrough />, t('toolbar.strikethrough'), t('layout.labels.strikethrough'), locked.strikethrough,
          () => { editor!.chain().focus(undefined, { scrollIntoView: false }).toggleStrike().run(); })}
        {markButton(mode, 'subscript', <FaSubscript />, t('toolbar.subscript'), t('layout.labels.subscript'), locked.subscript,
          () => { editor!.chain().focus(undefined, { scrollIntoView: false }).toggleSubscript().run(); })}
        {markButton(mode, 'superscript', <FaSuperscript />, t('toolbar.superscript'), t('layout.labels.superscript'), locked.superscript,
          () => { editor!.chain().focus(undefined, { scrollIntoView: false }).toggleSuperscript().run(); })}
      </div>

      <div className={inOverflow ? 'toolbar-overflow-sep' : 'toolbar-separator'} />

      <div className="toolbar-group" style={{ position: 'relative' }}>
        <button
          className="toolbar-btn"
          title={t('toolbar.textColor')}
          aria-label={mode === 'icon' ? t('toolbar.textColor') : undefined}
          aria-haspopup="dialog" aria-expanded={textColorOpen}
          disabled={locked.textColor}
          onClick={() => { if (!locked.textColor) { setTextColorOpen(!textColorOpen); setBgColorOpen(false); } }}
        >
          {face(mode, <FaPaintBrush style={{ color: currentTextColor }} />, t('layout.labels.textColor'))}
        </button>
        {showPopups && textColorOpen && (
          <ColorPicker
            label={t('toolbar.textColor')}
            value={currentTextColor}
            onChange={(color) => {
              setCurrentTextColor(color || '#000000');
              if (color) {
                editor?.chain().focus(undefined, { scrollIntoView: false }).setColor(color).run();
              } else {
                editor?.chain().focus(undefined, { scrollIntoView: false }).unsetColor().run();
              }
              setTextColorOpen(false);
            }}
            onClose={() => setTextColorOpen(false)}
          />
        )}

        <button
          className="toolbar-btn"
          title={t('toolbar.highlightColor')}
          aria-label={mode === 'icon' ? t('toolbar.highlightColor') : undefined}
          aria-haspopup="dialog" aria-expanded={bgColorOpen}
          disabled={locked.backgroundColor}
          onClick={() => { if (!locked.backgroundColor) { setBgColorOpen(!bgColorOpen); setTextColorOpen(false); } }}
        >
          {face(mode, <FaHighlighter style={{ color: currentBgColor }} />, t('layout.labels.highlight'))}
        </button>
        {showPopups && bgColorOpen && (
          <ColorPicker
            label={t('toolbar.highlightColor')}
            value={currentBgColor}
            onChange={(color) => {
              setCurrentBgColor(color || '#ffff00');
              if (color) {
                editor?.chain().focus(undefined, { scrollIntoView: false }).toggleHighlight({ color }).run();
              } else {
                editor?.chain().focus(undefined, { scrollIntoView: false }).unsetHighlight().run();
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
  );

  const alignButton = (mode: ToolbarLabelMode, align: typeof ALIGNMENTS[number], icon: React.ReactNode, title: string, name: string) => (
    <button
      className={`toolbar-btn ${caret?.align === align ? 'active' : ''}`}
      aria-pressed={caret?.align === align}
      title={title}
      aria-label={mode === 'icon' ? name : undefined}
      onClick={() => editor?.chain().focus().setTextAlign(align).run()}
      disabled={locked.textAlign}
    >
      {face(mode, icon, name)}
    </button>
  );

  const renderAlignment = (mode: ToolbarLabelMode) => (
    <div className="toolbar-group" key="align">
      {alignButton(mode, 'left', <FaAlignLeft />, t('toolbar.alignLeft'), t('layout.labels.alignLeft'))}
      {alignButton(mode, 'center', <FaAlignCenter />, t('toolbar.alignCenter'), t('layout.labels.alignCenter'))}
      {alignButton(mode, 'right', <FaAlignRight />, t('toolbar.alignRight'), t('layout.labels.alignRight'))}
      {alignButton(mode, 'justify', <FaAlignJustify />, t('toolbar.justify'), t('layout.labels.justify'))}
    </div>
  );

  const plainButton = (
    key: string, mode: ToolbarLabelMode, icon: React.ReactNode, name: string, title: string,
    onClick: () => void, extra: { active?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      key={key}
      type="button"
      className={`toolbar-btn${extra.active ? ' active' : ''}`}
      aria-pressed={extra.active === undefined ? undefined : extra.active}
      title={title}
      aria-label={mode === 'icon' ? name : undefined}
      disabled={extra.disabled}
      onClick={onClick}
    >
      {face(mode, icon, name)}
    </button>
  );

  const renderSearch = (mode: ToolbarLabelMode, inOverflow: boolean) => (
    <div className="toolbar-group" key="search">
      {plainButton('find', mode, <FaSearch />, t('layout.labels.find'), t('toolbar.findReplace', { shortcut: '⌘F' }),
        () => { setSearchOpen(true); closeOverflow(inOverflow); })}
      {plainButton('goto', mode, <FaHashtag />, t('layout.labels.goToPage'), t('toolbar.goToPage', { shortcut: '⌘G' }),
        () => { setGoToPageOpen(true); closeOverflow(inOverflow); })}
    </div>
  );

  const renderNotes = (mode: ToolbarLabelMode, inOverflow: boolean) => (
    <div className="toolbar-group" key="notes">
      <button
        className={`toolbar-btn${scriptNotesOpen ? ' active' : ''}`}
        aria-pressed={scriptNotesOpen}
        title={t('toolbar.scriptNotes')}
        aria-label={mode === 'icon' ? t('layout.labels.notes') : undefined}
        onPointerDown={(e) => { handleNotesClick(e); closeOverflow(inOverflow); }}
        onClick={e => { if (e.detail === 0) { handleNotesClick(e); closeOverflow(inOverflow); } }}
      >
        {face(mode, <FaStickyNote />, t('layout.labels.notes'))}
      </button>
      <button
        className={`toolbar-btn${tagsPanelOpen ? ' active' : ''}`}
        aria-pressed={tagsPanelOpen}
        title={t('toolbar.productionTags')}
        aria-label={mode === 'icon' ? t('layout.labels.tags') : undefined}
        onPointerDown={(e) => { handleTagsClick(e); closeOverflow(inOverflow); }}
        onClick={e => { if (e.detail === 0) { handleTagsClick(e); closeOverflow(inOverflow); } }}
      >
        {face(mode, <FaTags />, t('layout.labels.tags'))}
      </button>
    </div>
  );

  const renderDocument = (mode: ToolbarLabelMode, inOverflow: boolean) => (
    <div className="toolbar-group" key="document">
      {plainButton('new', mode, <FaFile />, t('layout.labels.new'), t('layout.labels.new'),
        () => { requestAppCommand('new-script'); closeOverflow(inOverflow); })}
      {plainButton('import', mode, <FaFolderOpen />, t('layout.labels.import'), t('layout.labels.import'),
        () => { requestAppCommand('import-script'); closeOverflow(inOverflow); })}
      {plainButton('save', mode, <FaSave />, t('layout.labels.save'), t('layout.labels.save'),
        () => { requestAppCommand('save-script'); closeOverflow(inOverflow); })}
      {plainButton('pdf', mode, <FaFilePdf />, t('layout.labels.exportPdf'), t('layout.labels.exportPdf'),
        () => { requestAppCommand('export-pdf'); closeOverflow(inOverflow); })}
    </div>
  );

  const renderItem = (id: string, inOverflow = false): React.ReactNode => {
    const mode = effectiveLabel(id, bar, toolbarLayout);
    const options = toolbarLayout.options[id] ?? {};
    switch (id) {
      case 'undo-redo': return renderUndoRedo(mode);
      case 'element': return renderElement(mode);
      case 'font': return renderFont(mode, inOverflow);
      case 'font-size': return renderFontSize(mode, inOverflow);
      // When the inline copy is folded away its colour popups must not stay
      // mounted, or a hidden button would own the open picker.
      case 'format': return renderFormat(mode, inOverflow, inOverflow || !hiddenItems.has('format'));
      case 'align': return renderAlignment(mode);
      case 'search': return renderSearch(mode, inOverflow);
      case 'notes': return renderNotes(mode, inOverflow);
      case 'document': return renderDocument(mode, inOverflow);
      case 'title-page':
        return <div className="toolbar-group" key="title-page">
          {plainButton('title-page', mode, <FaFileAlt />, t('layout.labels.titlePage'), t('layout.labels.titlePage'),
            () => { requestAppCommand('title-page'); closeOverflow(inOverflow); })}
        </div>;
      case 'production':
        return <div className="toolbar-group" key="production">
          {plainButton('scene-numbers', mode, <FaListOl />, t('layout.labels.sceneNumbers'), t('layout.labels.sceneNumbers'),
            () => { setSceneNumbersVisible(!sceneNumbersVisible); closeOverflow(inOverflow); }, { active: sceneNumbersVisible })}
          {plainButton('reports', mode, <FaTable />, t('layout.labels.reports'), t('layout.labels.reports'),
            () => { requestAppCommand('reports'); closeOverflow(inOverflow); })}
        </div>;
      case 'views': return <ViewsMenu key="views" label={mode} inOverflow={inOverflow} />;
      case 'layout': return <LayoutSwitcher key="layout" label={mode} options={options} />;
      case 'theme': {
        const dark = appearance !== 'light';
        return <div className="toolbar-group" key="theme">
          {plainButton('theme', mode, dark ? <FaSun /> : <FaMoon />,
            dark ? t('layout.labels.light') : t('layout.labels.dark'),
            dark ? t('layout.labels.switchToLight') : t('layout.labels.switchToDark'),
            () => setAppearance(dark ? 'light' : 'dark'))}
        </div>;
      }
      case 'zoom':
        return <ZoomControl key="zoom" zoomStyle={options.zoomStyle ?? 'buttons'} label={mode}
          className={isTop && !inOverflow ? 'zoom-group' : 'footer-zoom'} />;
      case 'status-zoom':
        return <StatusZoom key="status-zoom" editorMain={editorMain} pageWidthIn={pageLayout.pageWidth} label={mode} />;
      case 'navigator':
        return <div className="toolbar-group" key="navigator">
          {plainButton('navigator', mode, <FaCompass />, t('layout.labels.navigator'), t('layout.labels.navigator'),
            () => { toggleNavigator(); closeOverflow(inOverflow); }, { active: navigatorOpen })}
        </div>;
      default: break;
    }
    if (id.startsWith(TOOLBAR_PANEL_PREFIX)) {
      return <PanelButton key={id} panel={id.slice(TOOLBAR_PANEL_PREFIX.length)} mode={mode} onDone={() => closeOverflow(inOverflow)} />;
    }
    if (id.startsWith(TOOLBAR_PLUGIN_PREFIX)) {
      const entry = pluginRegistry.getPanels('toolbar').find((p) => `${TOOLBAR_PLUGIN_PREFIX}${p.id}` === id);
      if (!entry) return null; // the add-on is off; its place is kept
      const Component = entry.component;
      return <div className="toolbar-group toolbar-plugin-item" key={id}><Component editor={editor} /></div>;
    }
    return null;
  };

  // Build the overflow menu from the controls the measurement folded away, in
  // the order the writer arranged them.
  const overflowContent = (() => {
    if (!isTop || hiddenItems.size === 0) return null;
    const nodes: React.ReactNode[] = [];
    const addSep = () => { if (nodes.length > 0) nodes.push(<div className="toolbar-overflow-sep" key={`sep-${nodes.length}`} />); };
    for (const id of allItems) {
      if (!hiddenItems.has(id)) continue;
      // Zoom: skip when the narrow layout's own zoom button is on screen.
      if (id === 'zoom' && mobileZoomVisible) continue;
      const node = renderItem(id, true);
      if (node === null) continue;
      addSep();
      nodes.push(node);
    }
    if (nodes.length === 0) return null;
    addSep();
    nodes.push(
      <button key="customise" type="button" className="toolbar-overflow-customise"
        onClick={() => { setLayoutDialog('toolbar'); setOverflowOpen(false); }}>
        <FaSlidersH /> {t('layout.customiseBars')}
      </button>,
    );
    return nodes;
  })();
  // Derived from the menu's contents, not from the hidden set: a "…" that
  // opens an empty popup is worse than no "…" at all.
  const hasOverflow = overflowContent !== null;

  const contextMenu = useBarContextMenu();

  const avRowControls = (
    <>
      <div className="toolbar-separator" />
      <div className="toolbar-group av-row-group">
        <button
          className="toolbar-btn av-row-btn av-row-btn-add"
          title={t('toolbar.addAvRow', { shortcut: '⌘↵' })}
          onClick={() => editor?.chain().focus().insertAvRow('below').run()}
          disabled={!editor}
        >
          <FaPlus />
          <span className="toolbar-btn-label">{t('toolbar.row')}</span>
        </button>
        <button
          className="toolbar-btn av-row-btn av-row-btn-delete"
          title={t('toolbar.deleteAvRow')}
          onClick={() => editor?.chain().focus().deleteAvRow().run()}
          disabled={!editor}
        >
          <FaTrashAlt />
        </button>
      </div>
    </>
  );

  /** One control in its block, with the separator that folds with it. */
  const block = (id: string, index: number, list: string[]) => {
    const def = toolbarItemDefinition(id);
    const node = renderItem(id);
    if (node === null) return null;
    const classes = ['toolbar-priority-block'];
    const mode = effectiveLabel(id, bar, toolbarLayout);
    if (mode === 'text' || mode === 'both') classes.push('has-labels');
    if (isTop && def?.desktopOnly) classes.push('toolbar-desktop-only');
    if (isTop && id === 'zoom') classes.push('zoom-group');
    if (def?.fixed) classes.push('toolbar-fixed-item');
    return (
      <React.Fragment key={id}>
        <div className={classes.join(' ')} data-priority={isTop && !def?.fixed ? id : undefined} data-item={id}>
          {/* Inside the block so it folds with the control it separates. */}
          {/* Font and its size read as one control, as they always have. */}
          {index > 0 && !(id === 'font-size' && list[index - 1] === 'font') && <div className="toolbar-separator" />}
          {node}
        </div>
        {/* AV row controls — the only route to a new row without a hardware
            keyboard (issue #116), so they are never folded away or hidden on
            mobile. Shown only inside an AV cell. */}
        {id === 'element' && isInsideAvRow && avRowControls}
      </React.Fragment>
    );
  };

  if (!isTop) {
    if (allItems.length === 0) return null;
    return (
      <div className={`footer-controls footer-controls-${side ?? 'start'}`} onContextMenu={contextMenu.onContextMenu}>
        {allItems.map((id, index, list) => block(id, index, list))}
        {contextMenu.element}
      </div>
    );
  }

  if (toolbarMode === 'hidden' && (focusMode || !foldState.foldable || foldState.size !== 'phone')) return null;

  return (
    <div
      className={`toolbar${(toolbarMode === 'comfortable' || (foldState.foldable && foldState.size === 'phone' && toolbarMode === 'hidden')) ? ' toolbar-comfortable' : ''}${isInsideAvRow ? ' toolbar-av' : ''}`}
      ref={toolbarRef}
      role="group" aria-label={t('common:accessibility.formattingControls')}
      onContextMenu={contextMenu.onContextMenu}
    >
      {startItems.map((id, index, list) => block(id, index, list))}

      {/* The element picker can be removed; the AV row buttons still have to
          be reachable while the caret is in a row. */}
      {isInsideAvRow && !allItems.includes('element') && avRowControls}

      {/* Spacer between the two sides */}
      <div className="toolbar-spacer" style={{ flex: 1 }} />

      {/* Overflow 3-dot menu */}
      {hasOverflow && (
        <div className="toolbar-group toolbar-overflow-wrap" ref={overflowRef}
          onKeyDown={event => {
            if (event.key === 'Escape' && !event.defaultPrevented && overflowOpen) {
              event.preventDefault(); setOverflowOpen(false);
              overflowRef.current?.querySelector<HTMLButtonElement>('.toolbar-overflow-btn')?.focus();
            }
          }}>
          <button
            className={`toolbar-btn toolbar-overflow-btn${overflowOpen ? ' active' : ''}`}
            title={t('toolbar.moreFormatting')}
            aria-expanded={overflowOpen}
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

      {endItems.map((id, index, list) => block(id, index, list))}

      {/* Zoom — mobile: single button, when zoom lives on the toolbar */}
      {zoomOnBar && (
        <div className="toolbar-group zoom-mobile-group">
          <button
            className="toolbar-btn"
            title={t('toolbar.zoom')}
            aria-expanded={zoomPanelOpen} aria-controls={zoomPanelOpen ? 'zoom-panel' : undefined}
            onClick={() => setZoomPanelOpen(!zoomPanelOpen)}
          >
            <FaSearchPlus />
          </button>
        </div>
      )}
      {contextMenu.element}
    </div>
  );
};

const MemoControlBar = React.memo(ControlBar);

/** The toolbar under the menu bar. */
const Toolbar: React.FC<ToolbarProps> = ({ editor }) => <MemoControlBar editor={editor} bar="top" />;

/**
 * Controls the writer placed on the footer, one side of it. Renders nothing
 * (and runs nothing) when that side is empty, which it is by default.
 */
export const FooterControls: React.FC<ToolbarProps & { side: ToolbarSide; editorMain?: HTMLElement | null }> = React.memo(({ editor, side, editorMain }) => {
  const layout = useEditorStore((s) => s.toolbarLayout);
  const has = useMemo(() => splitBySide(layout.bars.bottom, layout.options)[side].length > 0, [layout, side]);
  if (!has) return null;
  return <MemoControlBar editor={editor} bar="bottom" side={side} editorMain={editorMain} />;
});
FooterControls.displayName = 'FooterControls';

export default React.memo(Toolbar);

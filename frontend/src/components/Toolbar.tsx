import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
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
  FaSearchMinus,
  FaSearch,
  FaStickyNote,
  FaTags,
  FaPaintBrush,
  FaHighlighter,
  FaEllipsisV,
  FaHashtag,
  FaPlus,
  FaTrashAlt,
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

interface ToolbarProps {
  editor: Editor | null;
}

/** The shortcut that reaches an element, for the dropdown's right-hand column. */
const shortcutFor = (id: string): string | undefined => {
  const spec = elementShortcutSpec(id);
  return spec ? formatShortcut(spec) : undefined;
};

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

// Priority groups — higher number = hidden first when toolbar shrinks.
// Priority 1 = zoom-out (just the minus button area)
// Priority 2 = zoom/goto/search
// Priority 3 = alignment buttons
// Priority 4 = font style & colors (bold/italic/underline/strike/sub/super + colors + language)
// Priority 5 = font face & size
const Toolbar: React.FC<ToolbarProps> = ({ editor }) => {
  const foldState = useFoldState();
  const { t } = useTranslation(['toolbar', 'common']);
  const {
    activeElement,
    setActiveElement,
    zoomLevel,
    setZoomLevel,
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
  } = useEditorFields(
    'activeElement',
    'setActiveElement',
    'zoomLevel',
    'setZoomLevel',
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
  );
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
  const [cursorSize, setCursorSize] = useState<number | null>(fontSize);
  // Fonts found in document that aren't in the registry
  const [extraFonts, setExtraFonts] = useState<string[]>([]);

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
        setCursorSize(!isNaN(parsed) ? parsed : (rule?.fontSize ?? fontSize));
      } else {
        setCursorSize(rule?.fontSize ?? fontSize);
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
        setCursorSize(!isNaN(parsed) ? parsed : (rule?.fontSize ?? fontSize));
      } else {
        setCursorSize(rule?.fontSize ?? fontSize);
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
        setCursorSize(!isNaN(parsed) ? parsed : (rule?.fontSize ?? fontSize));
      } else {
        setCursorSize(rule?.fontSize ?? fontSize);
      }
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
  }, [editor]);

  const handleElementChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
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
  const isInsideAvRow = caret?.inAvRow ?? false;
  const isActive = (format: CaretMark) => caret?.marks[format] ?? false;

  // Editable zoom input
  const [zoomInput, setZoomInput] = useState(String(zoomLevel));
  const [zoomEditing, setZoomEditing] = useState(false);
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const zoomReturnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (zoomEditing || !zoomReturnTo.current) return;
    const parent = zoomReturnTo.current;
    zoomReturnTo.current = null;
    const target = parent.querySelector<HTMLButtonElement>('.zoom-label');
    if (document.activeElement === document.body && target?.getClientRects().length) target.focus();
  }, [zoomEditing]);
  useEffect(() => { if (!zoomEditing) setZoomInput(String(zoomLevel)); }, [zoomLevel, zoomEditing]);
  const commitZoom = useCallback(() => {
    const val = parseInt(zoomInput, 10);
    if (!isNaN(val) && val >= 50 && val <= 300) setZoomLevel(val);
    else setZoomInput(String(zoomLevel));
    setZoomEditing(false);
  }, [zoomInput, zoomLevel, setZoomLevel]);
  const onZoomKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
    event.preventDefault();
    zoomReturnTo.current = event.currentTarget.parentElement;
    if (event.key === 'Enter') commitZoom();
    else { setZoomInput(String(zoomLevel)); setZoomEditing(false); }
  }, [commitZoom, zoomLevel]);

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

  // Hide order: "1" first, then "2" (matches "2" and "2b"), "3", "4", "5",
  // and "6" (Notes & Tags) last of all. On a phone 3–5 are already off the bar,
  // so 6 follows Search & Go To: a 375px iPhone (Display Zoom, SE, mini) has
  // no room for them beside the element picker, and the zoom button they
  // pushed off the edge is the one control with nowhere else to go.
  const HIDE_ORDER = ['1', '2', '3', '4', '5', '6'];

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
  // below cannot see.
  useEffect(() => { remeasureRef.current(); }, [isInsideAvRow]);

  // Measure toolbar overflow and determine which priority groups to hide
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const measure = () => {
      const containerWidth = toolbar.clientWidth;
      const groups = toolbar.querySelectorAll<HTMLElement>('[data-priority]');
      if (groups.length === 0) return;

      const mobileZoom = toolbar.querySelector<HTMLElement>('.zoom-mobile-group');
      setMobileZoomVisible(!!mobileZoom && mobileZoom.offsetWidth > 0);

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
        for (const prefix of HIDE_ORDER) {
          if (fits()) break;
          for (const { el, key } of allItems.filter(p => p.key.startsWith(prefix))) {
            newHidden.add(key);
            el.style.display = 'none';
          }
        }
      } else if (totalWidth > containerWidth) {
        let currentTotal = totalWidth + OVERFLOW_BTN_WIDTH;

        for (const prefix of HIDE_ORDER) {
          if (currentTotal <= containerWidth) break;
          // Notes & Tags go only when the bar really does not fit. The estimate
          // above is generous (2px per item, room for a "…" that may already be
          // counted), which costs nothing for the groups before this one but
          // folded these away on a 402px iPhone where they fit. The groups
          // hidden so far are already display:none, so the bar's own overflow
          // is the truth — plus the "…" button if it has yet to appear.
          if (prefix === '6') {
            const reserve = toolbar.querySelector('.toolbar-overflow-wrap') ? 0 : OVERFLOW_BTN_WIDTH;
            if (toolbar.scrollWidth + reserve <= toolbar.clientWidth) break;
          }
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
    const remeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };
    // The AV row group appears and disappears with the cursor, which changes
    // the toolbar's contents without changing its width — the ResizeObserver
    // below would never hear about it, leaving the overflow menu sized for the
    // other layout.
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
    // settled layout came a beat later still: the toolbar was left measured
    // for the previous posture, its last items under the status column. So
    // measure again after a fold, and once more when it has settled.
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const remeasureAfterFold = () => {
      remeasure();
      clearTimeout(settleTimer);
      settleTimer = setTimeout(remeasure, 300);
    };
    window.addEventListener(FOLD_CHANGE_EVENT, remeasureAfterFold);

    // Crossing the mobile breakpoint changes which groups the stylesheet hides,
    // and on iPad that can happen without the toolbar's own width changing —
    // rotating the device, or a Split View divider drag that lands on the same
    // pane width the toolbar already had.  The width-guard above would swallow
    // those, leaving the overflow menu describing the previous layout.
    // Legacy WebKit (Safari < 14, i.e. macOS 10.15 and earlier) ships a
    // MediaQueryList without addEventListener — only the deprecated
    // addListener/removeListener pair.  Calling the modern API there throws
    // during mount and takes the whole app down, so feature-detect both.
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
  }, [toolbarMode, foldState.foldable, foldState.size, foldState.fold]);

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

  // ── Shared renderers for toolbar groups (used both inline and in overflow) ──

  const renderFontFaceSize = useCallback((inOverflow = false) => (
    <React.Fragment key="font-face-size">
      <div className="toolbar-group" style={locked.fontFamily ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
        <FontPicker
          value={cursorFont}
          extraFonts={extraFonts}
          onManageFonts={() => useEditorStore.getState().setFontsDialogOpen(true)}
          onChange={(val) => {
            if (locked.fontFamily) return;
            loadFontByName(val);
            // Picking a font styles the selection — it must not rewrite the
            // document's own font, or every local change would redefine what
            // unstyled text elsewhere renders as (and what this picker reports
            // for it).  Choosing the document font clears the mark instead, so
            // the text goes back to following the page.
            if (val === fontFamily) {
              editor?.chain().focus(undefined, { scrollIntoView: false }).setMark('textStyle', { fontFamily: null }).removeEmptyTextStyle().run();
            } else {
              editor?.chain().focus(undefined, { scrollIntoView: false }).setMark('textStyle', { fontFamily: val }).run();
            }
            if (inOverflow) setOverflowOpen(false);
          }}
        />
      </div>
      <div className="toolbar-group">
        <Select
          className="font-size-selector"
          value={cursorSize ?? ''}
          disabled={locked.fontSize}
          onChange={(e) => {
            if (locked.fontSize) return;
            if (e.target.value === '') return; // user clicked the mixed placeholder — no-op
            const val = Number(e.target.value);
            // Selection-scoped, like the font picker above.
            if (val === fontSize) {
              editor?.chain().focus(undefined, { scrollIntoView: false }).setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
            } else {
              editor?.chain().focus(undefined, { scrollIntoView: false }).setFontSize(`${val}pt`).run();
            }
            if (inOverflow) setOverflowOpen(false);
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
    </React.Fragment>
  ), [cursorFont, cursorSize, extraFonts, editor, fontFamily, fontSize, locked, t]);

  // showPopups: when false, only render buttons (no ColorPicker popups).
  // This prevents the hidden inline copy from stealing popup state from the overflow copy.
  const renderFontStyleColors = useCallback((inOverflow = false, showPopups = true) => (
    <React.Fragment key="font-style-colors">
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${isActive('bold') ? 'active' : ''}`}
          aria-pressed={isActive('bold')}
          title={t('toolbar.bold', { shortcut: '⌘B' })}
          disabled={locked.bold}
          onClick={() => {
            if (!editor || locked.bold) return;
            if (isOverrideMode) {
              toggleBoldOverride(editor, getCurrentElementRule(editor, activeTemplate));
            } else {
              editor.chain().focus(undefined, { scrollIntoView: false }).toggleBold().run();
            }
          }}
        >
          <FaBold />
        </button>
        <button
          className={`toolbar-btn ${isActive('italic') ? 'active' : ''}`}
          aria-pressed={isActive('italic')}
          title={t('toolbar.italic', { shortcut: '⌘I' })}
          disabled={locked.italic}
          onClick={() => {
            if (!editor || locked.italic) return;
            if (isOverrideMode) {
              toggleItalicOverride(editor, getCurrentElementRule(editor, activeTemplate));
            } else {
              editor.chain().focus(undefined, { scrollIntoView: false }).toggleItalic().run();
            }
          }}
        >
          <FaItalic />
        </button>
        <button
          className={`toolbar-btn ${isActive('underline') ? 'active' : ''}`}
          aria-pressed={isActive('underline')}
          title={t('toolbar.underline', { shortcut: '⌘U' })}
          disabled={locked.underline}
          onClick={() => {
            if (!editor || locked.underline) return;
            if (isOverrideMode) {
              toggleUnderlineOverride(editor, getCurrentElementRule(editor, activeTemplate));
            } else {
              editor.chain().focus(undefined, { scrollIntoView: false }).toggleUnderline().run();
            }
          }}
        >
          <FaUnderline />
        </button>
        <button
          className={`toolbar-btn ${isActive('strike') ? 'active' : ''}`}
          aria-pressed={isActive('strike')}
          title={t('toolbar.strikethrough')}
          disabled={locked.strikethrough}
          onClick={() => { if (!locked.strikethrough) editor?.chain().focus(undefined, { scrollIntoView: false }).toggleStrike().run(); }}
        >
          <FaStrikethrough />
        </button>
        <button
          className={`toolbar-btn ${isActive('subscript') ? 'active' : ''}`}
          aria-pressed={isActive('subscript')}
          title={t('toolbar.subscript')}
          disabled={locked.subscript}
          onClick={() => { if (!locked.subscript) editor?.chain().focus(undefined, { scrollIntoView: false }).toggleSubscript().run(); }}
        >
          <FaSubscript />
        </button>
        <button
          className={`toolbar-btn ${isActive('superscript') ? 'active' : ''}`}
          aria-pressed={isActive('superscript')}
          title={t('toolbar.superscript')}
          disabled={locked.superscript}
          onClick={() => { if (!locked.superscript) editor?.chain().focus(undefined, { scrollIntoView: false }).toggleSuperscript().run(); }}
        >
          <FaSuperscript />
        </button>
      </div>

      <div className={inOverflow ? 'toolbar-overflow-sep' : 'toolbar-separator'} />

      <div className="toolbar-group" style={{ position: 'relative' }}>
        <button
          className="toolbar-btn"
          title={t('toolbar.textColor')}
          aria-haspopup="dialog" aria-expanded={textColorOpen}
          disabled={locked.textColor}
          onClick={() => { if (!locked.textColor) { setTextColorOpen(!textColorOpen); setBgColorOpen(false); } }}
        >
          <FaPaintBrush style={{ color: currentTextColor }} />
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
          aria-haspopup="dialog" aria-expanded={bgColorOpen}
          disabled={locked.backgroundColor}
          onClick={() => { if (!locked.backgroundColor) { setBgColorOpen(!bgColorOpen); setTextColorOpen(false); } }}
        >
          <FaHighlighter style={{ color: currentBgColor }} />
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
  ), [editor, caret, isOverrideMode, activeTemplate, activeElement, textColorOpen, bgColorOpen, currentTextColor, currentBgColor, locked, t]);

  const renderAlignment = useCallback((_inOverflow = false) => (
    <div className="toolbar-group" key="alignment">
      <button
        className={`toolbar-btn ${caret?.align === 'left' ? 'active' : ''}`}
        aria-pressed={caret?.align === 'left'}
        title={t('toolbar.alignLeft')}
        onClick={() => editor?.chain().focus().setTextAlign('left').run()}
        disabled={locked.textAlign}
      >
        <FaAlignLeft />
      </button>
      <button
        className={`toolbar-btn ${caret?.align === 'center' ? 'active' : ''}`}
        aria-pressed={caret?.align === 'center'}
        title={t('toolbar.alignCenter')}
        onClick={() => editor?.chain().focus().setTextAlign('center').run()}
        disabled={locked.textAlign}
      >
        <FaAlignCenter />
      </button>
      <button
        className={`toolbar-btn ${caret?.align === 'right' ? 'active' : ''}`}
        aria-pressed={caret?.align === 'right'}
        title={t('toolbar.alignRight')}
        onClick={() => editor?.chain().focus().setTextAlign('right').run()}
        disabled={locked.textAlign}
      >
        <FaAlignRight />
      </button>
      <button
        className={`toolbar-btn ${caret?.align === 'justify' ? 'active' : ''}`}
        aria-pressed={caret?.align === 'justify'}
        title={t('toolbar.justify')}
        onClick={() => editor?.chain().focus().setTextAlign('justify').run()}
        disabled={locked.textAlign}
      >
        <FaAlignJustify />
      </button>
    </div>
  ), [editor, caret, locked, t]);

  const renderSearchGoto = useCallback((inOverflow = false) => (
    <div className="toolbar-group" key="search-goto">
      <button
        className="toolbar-btn"
        title={t('toolbar.findReplace', { shortcut: '⌘F' })}
        onClick={() => { setSearchOpen(true); if (inOverflow) setOverflowOpen(false); }}
      >
        <FaSearch />
      </button>
      <button
        className="toolbar-btn"
        title={t('toolbar.goToPage', { shortcut: '⌘G' })}
        onClick={() => { setGoToPageOpen(true); if (inOverflow) setOverflowOpen(false); }}
      >
        <FaHashtag />
      </button>
    </div>
  ), [setSearchOpen, setGoToPageOpen, t]);

  const renderNotesTags = useCallback((inOverflow = false) => (
    <div className="toolbar-group" key="notes-tags">
      <button
        className={`toolbar-btn${scriptNotesOpen ? ' active' : ''}`}
        aria-pressed={scriptNotesOpen}
        title={t('toolbar.scriptNotes')}
        onPointerDown={(e) => { handleNotesClick(e); if (inOverflow) setOverflowOpen(false); }}
        onClick={e => { if (e.detail === 0) { handleNotesClick(e); if (inOverflow) setOverflowOpen(false); } }}
      >
        <FaStickyNote />
      </button>
      <button
        className={`toolbar-btn${tagsPanelOpen ? ' active' : ''}`}
        aria-pressed={tagsPanelOpen}
        title={t('toolbar.productionTags')}
        onPointerDown={(e) => { handleTagsClick(e); if (inOverflow) setOverflowOpen(false); }}
        onClick={e => { if (e.detail === 0) { handleTagsClick(e); if (inOverflow) setOverflowOpen(false); } }}
      >
        <FaTags />
      </button>
    </div>
  ), [scriptNotesOpen, tagsPanelOpen, handleNotesClick, handleTagsClick, t]);

  const renderZoom = useCallback((_inOverflow = false) => (
    <div className="toolbar-group zoom-group" key="zoom">
      <button
        className="toolbar-btn"
        title={t('toolbar.zoomOut')}
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
          max={300}
          step={10}
          value={zoomInput}
          onChange={(e) => setZoomInput(e.target.value)}
          onBlur={commitZoom}
          aria-label={t('toolbar.zoom')}
          onKeyDown={onZoomKeyDown}
          autoFocus
        />
      ) : (
        <button type="button" aria-label={`${t('toolbar.zoom')}: ${zoomLevel}%`}
          className="zoom-label"
          onClick={() => { setZoomEditing(true); setTimeout(() => zoomInputRef.current?.select(), 0); }}
          title={t('toolbar.editZoom')}
        >
          {zoomLevel}%
        </button>
      )}
      <button
        className="toolbar-btn"
        title={t('toolbar.zoomIn')}
        onClick={() => setZoomLevel(zoomLevel + 10)}
        disabled={zoomLevel >= 300}
      >
        <FaSearchPlus />
      </button>
    </div>
  ), [zoomLevel, zoomEditing, zoomInput, setZoomLevel, commitZoom, onZoomKeyDown, t]);

  const renderZoomMin = useCallback((_inOverflow = false) => (
    <div className="toolbar-group zoom-group" key="zoom-min">
      <button
        className="toolbar-btn"
        title={t('toolbar.zoomOut')}
        onClick={() => setZoomLevel(zoomLevel - 10)}
        disabled={zoomLevel <= 50}
      >
        <FaSearchMinus />
      </button>
    </div>
  ), [zoomLevel, setZoomLevel, t]);

  // Check if a given prefix has any hidden items
  const isHidden = useCallback((prefix: string) => {
    for (const k of hiddenPriorities) { if (k.startsWith(prefix)) return true; }
    return false;
  }, [hiddenPriorities]);

  /**
   * Exact-key test, as against {@link isHidden}'s prefix test.
   *
   * The zoom controls carry priorities "1" and "2b", so a prefix test for "2"
   * also matches "2b" — which made the narrow layout report Search & Go to as
   * hidden (it is not; only the desktop zoom group is) and offer a second copy
   * of it in the overflow menu.
   */
  const isHiddenExact = useCallback(
    (key: string) => hiddenPriorities.has(key),
    [hiddenPriorities],
  );

  // Build overflow menu content from hidden priorities
  const overflowContent = useMemo(() => {
    if (hiddenPriorities.size === 0) return null;
    const items: React.ReactNode[] = [];
    const addSep = () => { if (items.length > 0) items.push(<div className="toolbar-overflow-sep" key={`sep-${items.length}`} />); };

    // Show items in logical order (most important first within overflow)
    if (isHiddenExact('5')) { addSep(); items.push(renderFontFaceSize(true)); }
    if (isHiddenExact('4')) { addSep(); items.push(renderFontStyleColors(true)); }
    if (isHiddenExact('3')) { addSep(); items.push(renderAlignment(true)); }
    if (isHiddenExact('2')) { addSep(); items.push(renderSearchGoto(true)); }
    if (isHiddenExact('6')) { addSep(); items.push(renderNotesTags(true)); }

    // Zoom: skip entirely when the narrow layout's own zoom button is on screen.
    if (!mobileZoomVisible) {
      if (isHiddenExact('2b')) { addSep(); items.push(renderZoom(true)); }
      else if (isHiddenExact('1')) { addSep(); items.push(renderZoomMin(true)); }
    }

    return items.length > 0 ? items : null;
  }, [hiddenPriorities, isHiddenExact, mobileZoomVisible, renderZoomMin, renderZoom, renderSearchGoto, renderNotesTags, renderAlignment, renderFontStyleColors, renderFontFaceSize]);

  // Derived from the menu's contents, not from the hidden set: a group can be
  // hidden and still have nothing to offer here (zoom, when the narrow layout
  // shows its own zoom button), and a "…" that opens an empty popup is worse
  // than no "…" at all.
  const hasOverflow = overflowContent !== null;

  if (toolbarMode === 'hidden' && (focusMode || !foldState.foldable || foldState.size !== 'phone')) return null;

  return (
    <div
      className={`toolbar${(toolbarMode === 'comfortable' || (foldState.foldable && foldState.size === 'phone' && toolbarMode === 'hidden')) ? ' toolbar-comfortable' : ''}${isInsideAvRow ? ' toolbar-av' : ''}`}
      ref={toolbarRef}
      role="group" aria-label={t('common:accessibility.formattingControls')}
    >
      {/* Undo / Redo — always visible */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          title={t('toolbar.undo', { shortcut: '⌘Z' })}
          onClick={() => { try { editor?.chain().focus().undo().run(); } catch {} }}
          disabled={!caret?.canUndo}
        >
          <FaUndo />
        </button>
        <button
          className="toolbar-btn"
          title={t('toolbar.redo', { shortcut: '⇧⌘Z' })}
          onClick={() => { try { editor?.chain().focus().redo().run(); } catch {} }}
          disabled={!caret?.canRedo}
        >
          <FaRedo />
        </button>
      </div>

      <div className="toolbar-separator" />

      {/* Element type selector — always visible */}
      <div className="toolbar-group">
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
          {/*
            Inside an AV cell the list is resolved by utils/avCellElements.ts:
            the four AV paragraph types always, plus whatever the template
            admits to THIS column. The four are unconditional on purpose —
            `avCell` holds them in every document whatever template is active,
            and reading the list off the template alone left the dropdown empty
            (and the body uneditable) for an AV body under a screenplay template
            and for an AV document whose template did not come back with it,
            such as a restored session. Outside a cell, the template is the
            authority as before.
          */}
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

      {/* AV row controls — the only route to a new row without a hardware
          keyboard (issue #116), so they are never collapsed into the overflow
          menu and never hidden on mobile. Shown only inside an AV cell, where
          they are the actions the writer actually needs. */}
      {isInsideAvRow && (
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
      )}

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

      {/* Priority 6: Notes & Tags — the last to fold into the overflow menu,
          only when nothing else is left to give way (see HIDE_ORDER) */}
      <div className="toolbar-priority-block" data-priority="6">
        {renderNotesTags()}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

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

      {/* Zoom — desktop: P1 hides zoom-out, P2 hides zoom label/in */}
      <div className="toolbar-priority-block zoom-group" data-priority="1">
        <button
          className="toolbar-btn"
          title={t('toolbar.zoomOut')}
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
            max={300}
            step={10}
            value={zoomInput}
            onChange={(e) => setZoomInput(e.target.value)}
            onBlur={commitZoom}
            aria-label={t('toolbar.zoom')}
            onKeyDown={onZoomKeyDown}
            autoFocus
          />
        ) : (
          <button type="button" aria-label={`${t('toolbar.zoom')}: ${zoomLevel}%`}
            className="zoom-label"
            onClick={() => { setZoomEditing(true); setTimeout(() => zoomInputRef.current?.select(), 0); }}
            title={t('toolbar.editZoom')}
          >
            {zoomLevel}%
          </button>
        )}
        <button
          className="toolbar-btn"
          title={t('toolbar.zoomIn')}
          onClick={() => setZoomLevel(zoomLevel + 10)}
          disabled={zoomLevel >= 300}
        >
          <FaSearchPlus />
        </button>
      </div>

      {/* Zoom — mobile: single button */}
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
    </div>
  );
};

export default React.memo(Toolbar);

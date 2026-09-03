/**
 * Handwriting input — a safe place to write with an Apple Pencil.
 *
 * Scribble converts handwriting inline, in whatever field the Pencil touches.
 * In the screenplay editor that field is the page itself, and iPadOS sizes the
 * writable area from the blank space it can find around the insertion point.
 * Mid-script there is almost none: a line that is already long leaves a gap of
 * a word or two, and handwriting past it does not push the page open — it
 * starts replacing the text after the caret. Writers lost whole sentences that
 * way, and the area that was safe to write in was about one character tall
 * (issue #90).
 *
 * The fix is not to make the page a better Scribble target — the space simply
 * is not there — but to hand the Pencil somewhere that has nothing to destroy.
 * This is a single empty text field, large enough to write at a natural hand
 * size. Nothing follows the caret inside it, so nothing can be overwritten.
 * What it converts is inserted into the script at the writer's own position.
 *
 * It is a floating panel rather than a modal sheet, and that is the whole shape
 * of it: a modal one had to be closed before the script could be touched, so
 * every edit cost a reopen, and revising a scene meant the same four taps over
 * and over. This one stays up. Tapping a line in the script behind it moves
 * where the next insert lands — the panel follows the editor's own selection
 * rather than a position captured when it opened — so one panel serves a whole
 * pass over a script. Insert leaves it open and empty, ready for the next one.
 *
 * Above the field is a preview of the script either side of that position,
 * drawn with the editor's own element classes and page metrics so a Character
 * cue sits where a Character cue sits. The panel covers part of the page, and
 * the writer's eye is in the panel; this says what is about to happen without
 * asking them to look away and find their place again.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  FaArrowLeft, FaChevronDown, FaChevronUp, FaCog, FaCopy, FaCut, FaKeyboard,
  FaLevelDownAlt, FaPaste, FaTextWidth, FaTimes,
} from 'react-icons/fa';
import { ELEMENT_LABELS } from '../stores/editorStore';
import { readClipboardText, writeClipboard } from '../utils/clipboardCommands';
import {
  clampPanelPosition, defaultPanelPosition, joinHandwriting, splitHandwriting,
  type PanelPos, type PanelSize,
} from '../utils/handwriting';
import { showToast } from './Toast';
import TextareaCaret from './TextareaCaret';

/**
 * Whether tapping the field should raise the on-screen keyboard.
 *
 * Off by default: this panel exists for the Pencil, and a keyboard covering
 * two thirds of the iPad is the opposite of what it is for. The preference is
 * remembered because which one a writer wants is a habit, not a per-use choice.
 */
const KEYBOARD_PREF_KEY = 'opendraft:handwritingKeyboard';
/** Where the writer last dragged the panel, and whether they kept the preview. */
const POSITION_PREF_KEY = 'opendraft:handwritingPos';
const PREVIEW_PREF_KEY = 'opendraft:handwritingPreview';
/** The size the writer last dragged the panel to. */
const SIZE_PREF_KEY = 'opendraft:handwritingSize';
/** How much of the script shows through the panel, and through the field. */
const PANEL_ALPHA_KEY = 'opendraft:handwritingPanelAlpha';
const AREA_ALPHA_KEY = 'opendraft:handwritingAreaAlpha';
/** What colour the handwriting comes out in. */
const INK_KEY = 'opendraft:handwritingInk';

/**
 * Smallest the panel is any use at: narrower and a line of dialogue wraps
 * twice, shorter and there is no room to write at hand size.
 */
const MIN_PANEL: PanelSize = { width: 300, height: 240 };

/**
 * Below this the tool buttons drop their words and keep their icons. Measured
 * on the panel rather than the window: it is the panel the buttons have to fit
 * across, and the writer can now make that any width they like.
 */
const COMPACT_WIDTH = 470;

/**
 * Ink the writer can pick from.
 *
 * The panel is see-through now, so what is behind the field is the script —
 * and handwriting in the same colour as the text underneath is unreadable
 * against it. These are chosen to stay legible over black text on white paper.
 */
const INKS: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Blue', value: '#1d4ed8' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Green', value: '#15803d' },
  { label: 'Purple', value: '#7c3aed' },
];

function loadNumber(key: string, fallback: number, lo: number, hi: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  } catch {
    return fallback;
  }
}

function saveValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the panel still works, the choice just will not stick */
  }
}

function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSize(): PanelSize | null {
  try {
    const raw = localStorage.getItem(SIZE_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelSize>;
    if (typeof parsed?.width !== 'number' || typeof parsed?.height !== 'number') return null;
    return { width: parsed.width, height: parsed.height };
  } catch {
    return null;
  }
}

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* private mode — the panel still works, the choice just will not stick */
  }
}

function loadPosition(): PanelPos | null {
  try {
    const raw = localStorage.getItem(POSITION_PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelPos>;
    if (typeof parsed?.left !== 'number' || typeof parsed?.top !== 'number') return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

function savePosition(pos: PanelPos): void {
  try {
    localStorage.setItem(POSITION_PREF_KEY, JSON.stringify(pos));
  } catch {
    /* as above */
  }
}

/** The visible area, which the software keyboard shrinks from the bottom. */
function viewportSize() {
  const vv = window.visualViewport;
  return {
    width: Math.round(vv?.width ?? window.innerWidth),
    height: Math.round(vv?.height ?? window.innerHeight),
  };
}

/** How many blocks of script to show either side of the insertion point. */
const CONTEXT_BLOCKS = 3;

/** Node type name to the class the editor draws it with (`sceneHeading` → `scene-heading`). */
function elementClass(typeName: string): string {
  return typeName.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface PreviewBlock {
  key: number;
  typeName: string;
  label: string;
  text: string;
  /** Character offset the caret sits at, when this is the block being written into. */
  caretAt: number | null;
  /** Text the insert will replace, when there was a selection. */
  replacing: string | null;
}

interface ScribbleInputProps {
  editor: Editor;
  onClose: () => void;
}

const ScribbleInput: React.FC<ScribbleInputProps> = ({ editor, onClose }) => {
  const [text, setText] = useState('');
  const [keyboardOn, setKeyboardOn] = useState(() => loadFlag(KEYBOARD_PREF_KEY, false));
  const [previewOn, setPreviewOn] = useState(() => loadFlag(PREVIEW_PREF_KEY, true));
  const [hasSelection, setHasSelection] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Where the converted text goes. Read from the editor rather than captured on
   * open, because the panel stays up while the writer taps around the script:
   * the insertion point is wherever they last put it, and the preview has to
   * agree with the caret they can see on the page.
   */
  const [target, setTarget] = useState(() => {
    const { from, to } = editor.state.selection;
    return { from, to };
  });
  /**
   * The document the preview was drawn from. Held as state rather than read
   * through `editor.state` so that an edit made elsewhere — a collaborator, an
   * undo, the writer's own last insert — redraws it.
   */
  const [doc, setDoc] = useState(() => editor.state.doc);

  useEffect(() => {
    const syncTarget = () => {
      const { from, to } = editor.state.selection;
      setTarget((prev) => (prev.from === from && prev.to === to ? prev : { from, to }));
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      // Positions are remapped by ProseMirror, so re-reading the live selection
      // is all it takes to stay pointed at the same place in the text.
      syncTarget();
      if (transaction.docChanged) setDoc(editor.state.doc);
    };
    editor.on('selectionUpdate', syncTarget);
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('selectionUpdate', syncTarget);
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  /** The script around the insertion point, as it stands now. */
  const { blocks, elementLabel } = useMemo(() => {
    const out: PreviewBlock[] = [];
    let label = '';
    try {
      const from = Math.min(target.from, doc.content.size);
      const $from = doc.resolve(from);
      // Depth 1 is the top-level block; a nested position (a dual-dialogue
      // column) still has one, which is the row the writer is actually in.
      const depth = Math.max(1, $from.depth);
      const index = $from.index(depth - 1);
      const parent = $from.node(depth - 1);
      label = ELEMENT_LABELS[$from.parent.type.name] ?? $from.parent.type.name;

      const first = Math.max(0, index - CONTEXT_BLOCKS);
      const last = Math.min(parent.childCount - 1, index + CONTEXT_BLOCKS);

      for (let i = first; i <= last; i++) {
        const node = parent.child(i);
        // Position just before this child; its text begins one further in.
        const start = posOfChild(parent, i, $from.start(depth - 1));
        const isCaretBlock = i === index;
        const blockText = node.textContent;
        out.push({
          key: i,
          typeName: node.type.name,
          label: ELEMENT_LABELS[node.type.name] ?? node.type.name,
          text: blockText,
          caretAt: isCaretBlock ? clamp(from - start - 1, 0, blockText.length) : null,
          replacing: isCaretBlock && target.to > from
            ? doc.textBetween(from, Math.min(target.to, start + 1 + blockText.length), ' ')
            : null,
        });
      }
    } catch {
      /* a preview is a courtesy; never let it stop the writer writing */
    }
    return { blocks: out, elementLabel: label };
  }, [doc, target]);

  /**
   * The page's own metrics. Element indents are absolute inches offset against
   * `--pl`/`--pr`/`--pw`, so the preview has to inherit the live page's values
   * or a Character cue lands in the wrong column.
   */
  const pageStyle = useMemo(() => {
    const page = document.querySelector('.page') as HTMLElement | null;
    if (!page) return {} as React.CSSProperties;
    const cs = getComputedStyle(page);
    const pick = (name: string) => cs.getPropertyValue(name).trim();
    return {
      width: cs.width,
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
      ...{
        '--pl': pick('--pl'),
        '--pr': pick('--pr'),
        '--pw': pick('--pw'),
        '--screenplay-font': pick('--screenplay-font'),
        '--screenplay-font-size': pick('--screenplay-font-size'),
      } as React.CSSProperties,
      fontFamily: pick('--screenplay-font') || cs.fontFamily,
      fontSize: pick('--screenplay-font-size') || cs.fontSize,
    } as React.CSSProperties;
  }, []);

  // The preview shows blocks either side of the target, so the target itself
  // can start out scrolled past. Put it in view before the writer looks — and
  // again whenever they move the insertion point, which they now can without
  // closing anything.
  useEffect(() => {
    const box = previewRef.current;
    const line = box?.querySelector('.is-target') as HTMLElement | null;
    if (!box || !line) return;
    // Its own scrollTop rather than scrollIntoView: that walks every scrollable
    // ancestor, and the panel is rendered inside the editor's tree, so it can
    // jog the page behind it while centring a line in front.
    box.scrollTop = Math.max(
      0,
      line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2,
    );
  }, [blocks, previewOn]);

  // ── Where the panel sits ────────────────────────────────────────────────
  // Free-floating and dragged by its header, because what it must not cover is
  // the part of the script the writer is working on, and only they know which
  // part that is.
  const [pos, setPos] = useState<PanelPos | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);



  const panelSize = useCallback((): PanelSize => {
    const el = panelRef.current;
    const rect = el?.getBoundingClientRect();
    return { width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0) };
  }, []);

  // ── Size, and what shows through ────────────────────────────────────────
  const [size, setSize] = useState<PanelSize | null>(loadSize);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [compact, setCompact] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelAlpha, setPanelAlpha] = useState(() => loadNumber(PANEL_ALPHA_KEY, 1, 0.2, 1));
  const [areaAlpha, setAreaAlpha] = useState(() => loadNumber(AREA_ALPHA_KEY, 1, 0, 1));
  const [ink, setInk] = useState(() => loadString(INK_KEY, ''));

  /**
   * The words on the tool buttons come and go with the width of the panel, not
   * the width of the window: the writer sets the panel's width now, and six
   * labelled buttons in a 320px panel wrap into an unusable stack.
   */
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Held within the viewport as well as the minimum, so a corner dragged far
   *  past the edge cannot leave the panel bigger than the screen it is on. */
  const clampSize = useCallback((want: PanelSize): PanelSize => {
    const view = viewportSize();
    return {
      width: Math.round(Math.min(Math.max(want.width, MIN_PANEL.width), view.width - 16)),
      height: Math.round(Math.min(Math.max(want.height, MIN_PANEL.height), view.height - 16)),
    };
  }, []);

  const onResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    e.preventDefault();
    setSize(clampSize({ width: r.w + (e.clientX - r.x), height: r.h + (e.clientY - r.y) }));
  }, [clampSize]);

  const onResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setSize((current) => {
      if (current) saveValue(SIZE_PREF_KEY, JSON.stringify(current));
      return current;
    });
    // A panel grown from the bottom-right can push its own header off screen.
    setPos((prev) => (prev ? clampPanelPosition(prev, panelSize(), viewportSize()) : prev));
  }, [panelSize]);

  // Measured before paint, so the panel never shows in one place and jumps to
  // another. A saved position is honoured; a first-ever open goes to the foot.
  useLayoutEffect(() => {
    const size = panelSize();
    if (size.width === 0) return;
    const view = viewportSize();
    const saved = loadPosition();
    setPos(saved ? clampPanelPosition(saved, size, view) : defaultPanelPosition(size, view));
  }, [panelSize]);

  // A rotation, a window resize, or the keyboard coming up can leave the panel
  // hanging off the edge with its controls out of reach.
  useEffect(() => {
    const reclamp = () => {
      setPos((prev) => (prev ? clampPanelPosition(prev, panelSize(), viewportSize()) : prev));
    };
    window.addEventListener('resize', reclamp);
    window.visualViewport?.addEventListener('resize', reclamp);
    return () => {
      window.removeEventListener('resize', reclamp);
      window.visualViewport?.removeEventListener('resize', reclamp);
    };
  }, [panelSize]);

  const onDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // The header carries buttons; a tap on one of those is not a drag.
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    setPos(clampPanelPosition(
      { left: e.clientX - drag.dx, top: e.clientY - drag.dy },
      panelSize(),
      viewportSize(),
    ));
  }, [panelSize]);

  const onDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    setPos((prev) => {
      if (prev) savePosition(prev);
      return prev;
    });
  }, []);

  // Focus on open so the Pencil has a live field to write into straight away,
  // rather than the writer having to tap the box first.
  useEffect(() => {
    const id = window.setTimeout(() => areaRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  const trackSelection = useCallback(() => {
    const el = areaRef.current;
    setHasSelection(!!el && el.selectionEnd > el.selectionStart);
  }, []);

  /** Replace whatever is selected in the field, then put the caret after it. */
  const replaceSelection = useCallback((replacement: string, deleteBackIfEmpty = false) => {
    const el = areaRef.current;
    if (!el) return;
    let start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    // Backspace with nothing selected takes the character before the caret.
    if (deleteBackIfEmpty && start === end) start = Math.max(0, start - 1);
    setText(text.slice(0, start) + replacement + text.slice(end));
    requestAnimationFrame(() => {
      const caret = start + replacement.length;
      el.focus();
      el.setSelectionRange(caret, caret);
      trackSelection();
    });
  }, [text, trackSelection]);

  const selectedText = useCallback(() => {
    const el = areaRef.current;
    if (!el) return '';
    return text.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  }, [text]);

  const handleSelectAll = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.select();
    trackSelection();
  }, [trackSelection]);

  const handleCopy = useCallback(async () => {
    const sel = selectedText();
    if (!sel) return;
    if (!(await writeClipboard(escapeHtml(sel), sel))) {
      showToast('Could not copy to the clipboard.', 'error');
    }
  }, [selectedText]);

  const handleCut = useCallback(async () => {
    const sel = selectedText();
    if (!sel) return;
    if (await writeClipboard(escapeHtml(sel), sel)) replaceSelection('');
    else showToast('Could not cut to the clipboard.', 'error');
  }, [selectedText, replaceSelection]);

  const handlePaste = useCallback(async () => {
    const result = await readClipboardText();
    if (result.text) replaceSelection(result.text);
    else if (result.error) showToast(result.error, 'error');
  }, [replaceSelection]);

  /**
   * Turning the keyboard on has to re-focus the field: iOS decides whether to
   * raise it when focus arrives, so changing `inputmode` under a field that is
   * already focused does nothing until focus comes back.
   */
  const toggleKeyboard = useCallback(() => {
    setKeyboardOn((on) => {
      const next = !on;
      saveFlag(KEYBOARD_PREF_KEY, next);
      const el = areaRef.current;
      if (el) {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        el.blur();
        requestAnimationFrame(() => {
          el.focus();
          if (start != null && end != null) el.setSelectionRange(start, end);
        });
      }
      return next;
    });
  }, []);

  const togglePreview = useCallback(() => {
    setPreviewOn((on) => {
      saveFlag(PREVIEW_PREF_KEY, !on);
      return !on;
    });
  }, []);

  const handleInsert = useCallback(() => {
    const paragraphs = splitHandwriting(text);
    if (paragraphs.length === 0) {
      setText('');
      return;
    }

    // Read at the moment of the insert, not when the panel opened: the writer
    // may have tapped somewhere else in the script since, which is the point of
    // the panel staying up.
    const { from, to } = editor.state.selection;

    // The element the caret is in decides what new paragraphs become, so a
    // handwritten line continues the writer's Action or Dialogue rather than
    // reverting to a default.
    const elementType = editor.state.doc.resolve(from).parent.type.name;

    // A single line joins the sentence the caret is in, so it is spaced into
    // it. The characters either side come from `textBetween`, which stops at a
    // block boundary and hands back '' — nothing to join to at the start or the
    // end of a line, which is exactly the answer wanted there.
    //
    // Several lines become blocks of their own; nothing runs together, so
    // nothing needs spacing.
    const content = paragraphs.length === 1
      ? joinHandwriting(
        paragraphs[0],
        from > 0 ? editor.state.doc.textBetween(from - 1, from) : '',
        to < editor.state.doc.content.size ? editor.state.doc.textBetween(to, to + 1) : '',
      )
      : paragraphs.map((p) => ({
        type: elementType,
        content: [{ type: 'text', text: p }],
      }));

    editor
      .chain()
      // A range rather than a point: with text selected the writer is replacing
      // it, which is the revising half of what the Pencil is for.
      //
      // No `.focus()`. Focusing the editor would take the Pencil out of the
      // writing field on every insert, and this panel is built to be written in
      // again straight away. `insertContentAt` leaves the selection after what
      // it inserted, so the next insert carries on from there.
      .insertContentAt({ from, to }, content)
      .run();

    setText('');
    requestAnimationFrame(() => {
      // The script is deliberately left exactly where it was. It used to be
      // scrolled so the caret cleared the panel, which moved the page out from
      // under the writer at the moment they were looking for what had just
      // landed — the one moment the view needs to hold still. Where to put the
      // panel so it does not cover the work is the writer's call, and they can
      // drag and now resize it to make that call.
      //
      // Back to the field, so the next sentence can be written without a tap.
      areaRef.current?.focus();
      trackSelection();
    });
  }, [editor, text, trackSelection]);

  // Escape closes — it is a deliberate "I am done here", which is the bar the
  // panel holds everything else to.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // No backdrop, and nothing dismisses this but the close button or Escape.
    // The script behind it stays live on purpose: tapping a line there is how
    // the writer moves where the next insert lands. (A palm, a sleeve or a
    // stray Pencil tip landing outside used to throw away everything written
    // in it.)
    <div
      className={`scribble-panel${compact ? ' is-compact' : ''}`}
      ref={panelRef}
      role="dialog"
      aria-label="Handwriting input"
      style={{
        ...(pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }),
        ...(size ? { width: size.width, height: size.height } : {}),
        '--scribble-panel-alpha': String(panelAlpha),
        '--scribble-area-alpha': String(areaAlpha),
        ...(ink ? { '--scribble-ink': ink } : {}),
      } as unknown as React.CSSProperties}
    >
      <div
        className="scribble-header"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="scribble-header-row">
          <span className="scribble-title">
            <span className="scribble-grip" aria-hidden="true" />
            Handwriting
            {elementLabel && <span className="scribble-element">{elementLabel}</span>}
          </span>
          <div className="scribble-header-tools">
            <button
              type="button"
              className={`scribble-toggle ${keyboardOn ? 'is-on' : ''}`}
              onClick={toggleKeyboard}
              aria-pressed={keyboardOn}
              title={keyboardOn ? 'Tapping the box opens the keyboard' : 'Tapping the box will not open the keyboard'}
            >
              <FaKeyboard /> {keyboardOn ? 'Keyboard on' : 'Keyboard off'}
            </button>
            <button
              type="button"
              className="scribble-toggle"
              onClick={togglePreview}
              aria-pressed={previewOn}
              title={previewOn ? 'Hide the script preview' : 'Show the script preview'}
            >
              {previewOn ? <FaChevronUp /> : <FaChevronDown />} Preview
            </button>
            <button
              type="button"
              className={`scribble-close${settingsOpen ? ' is-on' : ''}`}
              onClick={() => setSettingsOpen((o) => !o)}
              aria-label="Handwriting settings"
              aria-expanded={settingsOpen}
              title="Transparency and ink"
            >
              <FaCog />
            </button>
            <button
              type="button"
              className="scribble-close"
              onClick={onClose}
              aria-label="Close handwriting"
              title="Close handwriting"
            >
              <FaTimes />
            </button>
          </div>
        </div>

        {/* Transparency and ink. The panel covers the script, so how much of
            it shows through — and what colour the handwriting has to stay
            legible against whatever does — is the writer's call, not a fixed
            choice. Kept in the header so it never moves with the field. */}
        {settingsOpen && (
          <div className="scribble-settings" onPointerDown={(e) => e.stopPropagation()}>
            <label className="scribble-setting">
              <span>Panel</span>
              <input
                type="range" min={0.2} max={1} step={0.05} value={panelAlpha}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPanelAlpha(v);
                  saveValue(PANEL_ALPHA_KEY, String(v));
                }}
                aria-label="Panel opacity"
              />
            </label>
            <label className="scribble-setting">
              <span>Writing area</span>
              <input
                type="range" min={0} max={1} step={0.05} value={areaAlpha}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAreaAlpha(v);
                  saveValue(AREA_ALPHA_KEY, String(v));
                }}
                aria-label="Writing area opacity"
              />
            </label>
            <div className="scribble-setting scribble-inks">
              <span>Ink</span>
              <div className="scribble-ink-row">
                {INKS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className={`scribble-ink${ink === c.value ? ' is-on' : ''}${c.value ? '' : ' is-default'}`}
                    style={c.value ? { background: c.value } : undefined}
                    onClick={() => { setInk(c.value); saveValue(INK_KEY, c.value); }}
                    aria-label={`${c.label} ink`}
                    aria-pressed={ink === c.value}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* The script either side of where this lands, in the editor's own
            element styles and page metrics. It follows the caret: tap a
            different line and this catches up. */}
        {previewOn && (
          <div className="scribble-preview" ref={previewRef} aria-label="Where the text will go">
            <div className="scribble-preview-page screenplay-content" style={pageStyle}>
              {blocks.length === 0 ? (
                <div className="scribble-preview-empty">The script is empty — this starts it.</div>
              ) : blocks.map((b) => (
                <div
                  key={b.key}
                  className={`screenplay-element ${elementClass(b.typeName)}${b.caretAt !== null ? ' is-target' : ''}`}
                >
                  {b.caretAt === null ? (b.text || ' ') : (
                    <>
                      {b.text.slice(0, b.caretAt)}
                      {b.replacing
                        ? <mark className="scribble-ctx-replace">{b.replacing}</mark>
                        : <span className="scribble-ctx-caret" aria-hidden="true" />}
                      {b.text.slice(b.caretAt + (b.replacing?.length ?? 0))}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="scribble-area-wrap">
        <textarea
          ref={areaRef}
          className="scribble-area"
          value={text}
          onChange={(e) => { setText(e.target.value); trackSelection(); }}
          onSelect={trackSelection}
          onKeyUp={trackSelection}
          onPointerUp={trackSelection}
          // `none` leaves the field focused and writable — which is all Scribble
          // and the Pencil's own gestures need — while telling iOS not to raise
          // the keyboard over the writing area.
          inputMode={keyboardOn ? 'text' : 'none'}
          // Screenplay text is prose: the writer wants their own capitals and
          // their own spelling of a character's name left alone.
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          placeholder="Write here with your Apple Pencil"
        />
        {/* iPadOS paints no caret while the keyboard is down, which is how this
            panel is meant to be used, so the app draws one. */}
        <TextareaCaret areaRef={areaRef} value={text} enabled={!keyboardOn} />
      </div>

      {/* The controls a Pencil cannot reach without a keyboard. iPadOS shows
          its own palette for native fields, but not for a field inside a web
          view, so the app has to supply the equivalents. */}
      <div className="scribble-tools">
        <button type="button" className="scribble-tool scribble-tool-key" onClick={() => replaceSelection('\n')} aria-label="Enter" title="Enter">
          <FaLevelDownAlt style={{ transform: 'rotate(90deg)' }} /><span className="scribble-tool-label">Enter</span>
        </button>
        <button
          type="button"
          className="scribble-tool scribble-tool-key"
          onClick={() => replaceSelection('', true)} aria-label="Backspace" title="Backspace"
          disabled={text === ''}
        >
          <FaArrowLeft /><span className="scribble-tool-label">Backspace</span>
        </button>
        <span className="scribble-tools-gap" />
        <button type="button" className="scribble-tool" onClick={handleSelectAll} aria-label="Select All" title="Select All" disabled={text === ''}>
          <FaTextWidth /><span className="scribble-tool-label">Select All</span>
        </button>
        <button type="button" className="scribble-tool" onClick={() => void handleCut()} aria-label="Cut" title="Cut" disabled={!hasSelection}>
          <FaCut /><span className="scribble-tool-label">Cut</span>
        </button>
        <button type="button" className="scribble-tool" onClick={() => void handleCopy()} aria-label="Copy" title="Copy" disabled={!hasSelection}>
          <FaCopy /><span className="scribble-tool-label">Copy</span>
        </button>
        <button type="button" className="scribble-tool" onClick={() => void handlePaste()} aria-label="Paste" title="Paste">
          <FaPaste /><span className="scribble-tool-label">Paste</span>
        </button>
      </div>

      {/* Drag the corner to resize. The panel floats over the script, so how
          much of the page it is allowed to cover is the writer's decision —
          the same decision dragging it around already was. */}
      <div
        className="scribble-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        role="separator"
        aria-label="Resize handwriting panel"
      />

      <div className="scribble-actions">
        {/* Clear rather than Cancel: leaving is the close button's job now, and
            what a writer wants after a misread word is the field empty, not the
            panel gone. */}
        <button
          type="button"
          className="scribble-btn"
          onClick={() => { setText(''); areaRef.current?.focus(); }}
          disabled={text === ''}
        >
          Clear
        </button>
        <button
          type="button"
          className="scribble-btn scribble-btn-primary"
          onClick={handleInsert}
          disabled={text.trim() === ''}
        >
          Insert
        </button>
      </div>
    </div>
  );
};

/** Document position of a parent's nth child, counting the sizes before it. */
function posOfChild(parent: import('@tiptap/pm/model').Node, index: number, parentStart: number): number {
  let pos = parentStart;
  for (let i = 0; i < index; i++) pos += parent.child(i).nodeSize;
  return pos;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export default ScribbleInput;

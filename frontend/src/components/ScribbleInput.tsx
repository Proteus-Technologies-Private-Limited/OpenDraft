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
 * This sheet is a single empty text field, large enough to write at a natural
 * hand size. Nothing follows the caret inside it, so nothing can be
 * overwritten. What it converts is inserted into the script at the position the
 * writer had selected when they opened it.
 *
 * Above the field is a preview of the script either side of that position,
 * drawn with the editor's own element classes and page metrics so a Character
 * cue sits where a Character cue sits. Looking away from the page costs the
 * writer their place; this hands it back.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import {
  FaArrowLeft, FaCopy, FaCut, FaKeyboard, FaLevelDownAlt, FaPaste, FaTextWidth,
} from 'react-icons/fa';
import { ELEMENT_LABELS } from '../stores/editorStore';
import { readClipboardText, writeClipboard } from '../utils/clipboardCommands';
import { showToast } from './Toast';
import TextareaCaret from './TextareaCaret';

/**
 * Whether tapping the field should raise the on-screen keyboard.
 *
 * Off by default: this sheet exists for the Pencil, and a keyboard covering
 * two thirds of the iPad is the opposite of what it is for. The preference is
 * remembered because which one a writer wants is a habit, not a per-use choice.
 */
const KEYBOARD_PREF_KEY = 'opendraft:handwritingKeyboard';

function loadKeyboardPref(): boolean {
  try {
    return localStorage.getItem(KEYBOARD_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function saveKeyboardPref(on: boolean): void {
  try {
    localStorage.setItem(KEYBOARD_PREF_KEY, on ? '1' : '0');
  } catch {
    /* private mode — the sheet still works, the choice just will not stick */
  }
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
  /** Where the converted text goes — captured before this sheet took focus. */
  target: { from: number; to: number };
  onClose: () => void;
}

const ScribbleInput: React.FC<ScribbleInputProps> = ({ editor, target, onClose }) => {
  const [text, setText] = useState('');
  const [keyboardOn, setKeyboardOn] = useState(loadKeyboardPref);
  const [hasSelection, setHasSelection] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  /**
   * The script around the insertion point, read once: the document cannot
   * change while this sheet is up, so there is nothing to recompute.
   */
  const { blocks, elementLabel } = useMemo(() => {
    const out: PreviewBlock[] = [];
    let label = '';
    try {
      const { doc } = editor.state;
      const $from = doc.resolve(target.from);
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
          caretAt: isCaretBlock ? clamp(target.from - start - 1, 0, blockText.length) : null,
          replacing: isCaretBlock && target.to > target.from
            ? doc.textBetween(target.from, Math.min(target.to, start + 1 + blockText.length), ' ')
            : null,
        });
      }
    } catch {
      /* a preview is a courtesy; never let it stop the writer writing */
    }
    return { blocks: out, elementLabel: label };
  }, [editor, target]);

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
  // can start out scrolled past. Put it in view before the writer looks.
  useEffect(() => {
    const box = previewRef.current;
    const line = box?.querySelector('.is-target') as HTMLElement | null;
    if (!box || !line) return;
    // Its own scrollTop rather than scrollIntoView: that walks every scrollable
    // ancestor, and the sheet is rendered inside the editor's tree, so it can
    // jog the page behind the overlay while centring a line in front of it.
    box.scrollTop = Math.max(
      0,
      line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2,
    );
  }, [blocks]);

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
      saveKeyboardPref(next);
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

  const handleInsert = useCallback(() => {
    const written = text.trim();
    if (written === '') {
      onClose();
      return;
    }

    // The element the caret was in decides what new paragraphs become, so a
    // handwritten line continues the writer's Action or Dialogue rather than
    // reverting to a default.
    const elementType = editor.state.doc.resolve(target.from).parent.type.name;

    // Blank lines are the writer separating thoughts, not empty paragraphs to
    // reproduce; a single line is inserted as text so it joins the sentence the
    // caret was in instead of breaking the block in two.
    const paragraphs = written.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);

    const content = paragraphs.length <= 1
      ? paragraphs[0] ?? ''
      : paragraphs.map((p) => ({
        type: elementType,
        content: [{ type: 'text', text: p }],
      }));

    editor
      .chain()
      .focus()
      // A range rather than a point: with text selected the writer is replacing
      // it, which is the revising half of what the Pencil is for.
      .insertContentAt({ from: target.from, to: target.to }, content)
      .run();

    // Leave the writer looking at what they just wrote. The sheet can cover a
    // different part of the script than the caret was in — and on a long script
    // the insertion can be off screen entirely — so the caret is put after the
    // new text and scrolled to in one transaction.
    requestAnimationFrame(() => {
      try {
        const end = Math.min(
          target.from + written.length + (paragraphs.length > 1 ? paragraphs.length * 2 : 0),
          editor.state.doc.content.size,
        );
        const tr = editor.state.tr;
        tr.setSelection(TextSelection.near(editor.state.doc.resolve(end)));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
      } catch {
        /* the text is in; not scrolling to it is a small loss */
      }
    });

    onClose();
  }, [editor, target, text, onClose]);

  // Escape still cancels — it is a deliberate "I am done here", which is the
  // bar the sheet holds everything else to.
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
    // No dismiss-on-backdrop. A palm, a sleeve or a stray Pencil tip landing
    // outside the sheet used to throw away everything written in it; leaving
    // only takes Cancel or Insert.
    <div className="scribble-overlay">
      <div className="scribble-sheet" role="dialog" aria-modal="true" aria-label="Handwriting input">
        <div className="scribble-header">
          <div className="scribble-header-row">
            <span className="scribble-title">
              Handwriting
              {elementLabel && <span className="scribble-element">{elementLabel}</span>}
            </span>
            <button
              type="button"
              className={`scribble-toggle ${keyboardOn ? 'is-on' : ''}`}
              onClick={toggleKeyboard}
              aria-pressed={keyboardOn}
              title={keyboardOn ? 'Tapping the box opens the keyboard' : 'Tapping the box will not open the keyboard'}
            >
              <FaKeyboard /> {keyboardOn ? 'Keyboard on' : 'Keyboard off'}
            </button>
          </div>

          {/* The script either side of where this lands, in the editor's own
              element styles and page metrics. */}
          <div className="scribble-preview" ref={previewRef} aria-label="Where the text will go">
            <div className="scribble-preview-page screenplay-content" style={pageStyle}>
              {blocks.length === 0 ? (
                <div className="scribble-preview-empty">The script is empty — this starts it.</div>
              ) : blocks.map((b) => (
                <div
                  key={b.key}
                  className={`screenplay-element ${elementClass(b.typeName)}${b.caretAt !== null ? ' is-target' : ''}`}
                >
                  {b.caretAt === null ? (b.text || ' ') : (
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
            sheet is meant to be used, so the app draws one. */}
        <TextareaCaret areaRef={areaRef} value={text} enabled={!keyboardOn} />
        </div>

        {/* The controls a Pencil cannot reach without a keyboard. iPadOS shows
            its own palette for native fields, but not for a field inside a web
            view, so the app has to supply the equivalents. */}
        <div className="scribble-tools">
          <button type="button" className="scribble-tool scribble-tool-key" onClick={() => replaceSelection('\n')}>
            <FaLevelDownAlt style={{ transform: 'rotate(90deg)' }} /> Enter
          </button>
          <button
            type="button"
            className="scribble-tool scribble-tool-key"
            onClick={() => replaceSelection('', true)}
            disabled={text === ''}
          >
            <FaArrowLeft /> Backspace
          </button>
          <span className="scribble-tools-gap" />
          <button type="button" className="scribble-tool" onClick={handleSelectAll} disabled={text === ''}>
            <FaTextWidth /> Select All
          </button>
          <button type="button" className="scribble-tool" onClick={() => void handleCut()} disabled={!hasSelection}>
            <FaCut /> Cut
          </button>
          <button type="button" className="scribble-tool" onClick={() => void handleCopy()} disabled={!hasSelection}>
            <FaCopy /> Copy
          </button>
          <button type="button" className="scribble-tool" onClick={() => void handlePaste()}>
            <FaPaste /> Paste
          </button>
        </div>

        <div className="scribble-actions">
          <button type="button" className="scribble-btn" onClick={onClose}>
            Cancel
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

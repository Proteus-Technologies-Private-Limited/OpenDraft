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
 * This sheet is a single empty, deliberately large text field. Nothing follows
 * the caret, so nothing can be overwritten, and the field is tall enough to
 * write at a natural size. What it converts is inserted into the script at the
 * position the writer had selected when they opened it.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';

interface ScribbleInputProps {
  editor: Editor;
  /** Where the converted text goes — captured before this sheet took focus. */
  target: { from: number; to: number };
  onClose: () => void;
}

const ScribbleInput: React.FC<ScribbleInputProps> = ({ editor, target, onClose }) => {
  const [text, setText] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on open so the Pencil has a live field to write into straight away,
  // rather than the writer having to tap the box first.
  useEffect(() => {
    const id = window.setTimeout(() => areaRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
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

    onClose();
  }, [editor, target, text, onClose]);

  return (
    <div
      className="scribble-overlay"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="scribble-sheet" role="dialog" aria-label="Handwriting input">
        <div className="scribble-header">
          <span className="scribble-title">Handwriting</span>
          <span className="scribble-hint">Write anywhere in the box &mdash; it goes in at your cursor.</span>
        </div>
        <textarea
          ref={areaRef}
          className="scribble-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          // Screenplay text is prose: the writer wants their own capitals and
          // their own spelling of a character's name left alone.
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          placeholder="Write here with your Apple Pencil"
        />
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

export default ScribbleInput;

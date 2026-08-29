/**
 * The footnotes drawn at the foot of a page.
 *
 * It sits inside the page-break overlay's bottom band, pushed up onto the page
 * above it with `bottom: 100%`. That lands it in the whitespace the paginator
 * reserved by reporting fewer lines on the page.
 *
 * The paginator decides not just WHICH notes belong here but exactly how much
 * of each one fits, and this draws no more than that. A note longer than the
 * room its page can spare is clipped to its share and continues at the foot of
 * the next page — the alternative, drawing it whole, is what made a long
 * footnote climb up over the script. Word splits a long footnote for the same
 * reason.
 *
 * The clipping is done by giving each slice a box of exactly its line count and
 * sliding the note up inside it. That is exact because every line here is one
 * 12pt line, the same unit the reserve was counted in.
 */
import React from 'react';
import { useEditorStore } from '../stores/editorStore';
import type { FootnoteEntry, FootnotePlan, NoteSlice } from '../utils/footnotes';
import { noteEntryLabel } from '../utils/noteNumbering';
import type { NoteBlock } from '../utils/noteContent';

/** Height of one printed line, in px. Matches pagination's LINE_HEIGHT_PT. */
const LINE_PX = 16;

interface FootnoteBlockProps {
  plan: FootnotePlan;
  /** Exactly what this page draws, already clipped by the paginator. */
  slices: readonly NoteSlice[];
  /** The page's number, for "restart each page" numbering. */
  pageNumber: number;
  /** Note ids whose references land on this page, in order. */
  noteIds: readonly string[];
}

/** One line of a note's prose. */
const Line: React.FC<{ block: Extract<NoteBlock, { kind: 'line' }> }> = ({ block }) => (
  <>
    {block.parts.map((part, i) => {
      if (part.kind === 'text') return <span key={i}>{part.text}</span>;
      if (part.kind === 'url') return <span key={i}>{part.url}</span>;
      // An unresolved reference prints as the writer typed it, which is at
      // least visible, rather than vanishing.
      return <span key={i}>{part.asset ? part.asset.original_name : part.ref}</span>;
    })}
  </>
);

/**
 * A whole note. The label is drawn inline at the head of the first line rather
 * than in a column of its own, so the text wraps exactly where
 * `footnoteEntryLines` measured it wrapping.
 */
export const NoteBody: React.FC<{ entry: FootnoteEntry; label: string | null }> = ({ entry, label }) => {
  let first = true;
  return (
    <>
      {entry.title && (
        <span className="footnote-entry-line footnote-entry-title">
          {label && <span className="footnote-entry-label">{label} </span>}
          {entry.title}
        </span>
      )}
      {entry.blocks.map((b, i) => {
        if (b.kind === 'image') {
          return (
            <span className="footnote-entry-image" key={i}>
              <img src={b.url} alt={b.alt} loading="lazy" />
            </span>
          );
        }
        const lead = label && first && !entry.title
          ? <span className="footnote-entry-label">{label} </span>
          : null;
        first = false;
        // Paper cannot play anything, so a video prints as its address.
        if (b.kind === 'video') {
          return <span className="footnote-entry-line" key={i}>{lead}{b.url}</span>;
        }
        return <span className="footnote-entry-line" key={i}>{lead}<Line block={b} /></span>;
      })}
    </>
  );
};

const FootnoteBlock: React.FC<FootnoteBlockProps> = ({ plan, slices, pageNumber, noteIds }) => {
  const setNoteFilter = useEditorStore((s) => s.setNoteFilter);
  const scriptNotesOpen = useEditorStore((s) => s.scriptNotesOpen);
  const toggleScriptNotes = useEditorStore((s) => s.toggleScriptNotes);

  if (slices.length === 0) return null;

  const { numberFormat, numbering, startAt } = plan.settings;

  const open = (noteId: string) => {
    setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId });
    if (!scriptNotesOpen) toggleScriptNotes();
  };

  return (
    <div className="footnote-block" data-page={pageNumber}>
      <div className="footnote-rule" />
      {slices.map((slice, i) => {
        const entry = plan.entryById.get(slice.noteId);
        if (!entry) return null;
        // Word restarts at "Start at" on every page; continuous numbering was
        // settled when the plan was built. A continuation repeats no number.
        const label = !slice.isStart
          ? null
          : numbering === 'restartEachPage'
            ? noteEntryLabel(startAt + Math.max(0, noteIds.indexOf(slice.noteId)), numberFormat)
            : entry.entryLabel;
        return (
          <div
            key={`${slice.noteId}-${slice.fromLine}-${i}`}
            className="footnote-slice"
            style={{ height: slice.lines * LINE_PX }}
            onClick={() => open(slice.noteId)}
            title="Show this note in the Script Notes panel"
          >
            <div className="footnote-slice-inner" style={{ marginTop: -slice.fromLine * LINE_PX }}>
              <NoteBody entry={entry} label={label} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FootnoteBlock;

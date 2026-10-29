/**
 * The conversation under a note: its replies, a box to reply in, who it is
 * assigned to, and Resolve / Reopen.
 *
 * Shared by script notes and general notes. Every change goes back through
 * `onUpdate` as the fields to write (utils/noteThreads), so the note store,
 * saving and collaboration treat a reply like any other edit to a note.
 */
import React, { useRef, useState } from 'react';
import { FaCheck, FaUndo } from 'react-icons/fa';
import type { Asset } from '../stores/assetStore';
import {
  addNoteReply,
  assignNote,
  deleteNoteReply,
  editNoteReply,
  isNoteResolved,
  noteReplies,
  samePerson,
  setNoteResolved,
  type NoteThread as NoteThreadData,
  type NoteThreadUpdate,
} from '../utils/noteThreads';
import {
  buildMentionSuggestions,
  insertSuggestion,
  mentionQueryAt,
  type MentionSuggestion,
} from '../utils/noteMentions';
import Select from './Select';

// ── @ suggestions: people and assets ────────────────────────────────────────


export const MentionDropdown: React.FC<{
  suggestions: MentionSuggestion[];
  selected: number;
  onPick: (s: MentionSuggestion) => void;
}> = ({ suggestions, selected, onPick }) => (
  <div className="note-asset-dropdown" role="listbox">
    {suggestions.map((s, idx) => (
      <div
        key={s.kind === 'person' ? `p:${s.name}` : `a:${s.asset.id}`}
        role="option"
        aria-selected={idx === selected}
        className={`note-asset-option${idx === selected ? ' selected' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault();
          onPick(s);
        }}
      >
        {s.kind === 'person' ? (
          <>
            <span className="note-asset-option-icon">👤</span>
            <span className="note-asset-option-name">{s.name}</span>
          </>
        ) : (
          <>
            <span className="note-asset-option-icon">
              {s.asset.mime_type.startsWith('image/') ? '🖼' : s.asset.mime_type.startsWith('video/') ? '🎬' : '📎'}
            </span>
            <span className="note-asset-option-name">{s.asset.original_name}</span>
            <span className="note-asset-option-tags">{s.asset.tags.slice(0, 2).join(', ')}</span>
          </>
        )}
      </div>
    ))}
  </div>
);

/**
 * A textarea that offers people and assets after `@`. Arrow keys move through
 * the list, Enter or Tab takes one, Escape closes it. Keys the list does not
 * use go to `onKeyDown`.
 */
export const MentionTextarea: React.FC<{
  value: string;
  onChange: (value: string) => void;
  people: string[];
  assets: Asset[];
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  ariaLabel?: string;
}> = ({ value, onChange, people, assets, onKeyDown, onBlur, placeholder, className, rows = 2, autoFocus, ariaLabel }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [selected, setSelected] = useState(0);

  const refresh = (text: string, caret: number) => {
    const q = mentionQueryAt(text, caret);
    setSuggestions(q === null ? [] : buildMentionSuggestions(q, people, assets));
    setSelected(0);
  };

  const pick = (s: MentionSuggestion) => {
    const el = ref.current;
    if (!el) return;
    const next = insertSuggestion(value, el.selectionStart, s);
    onChange(next.value);
    setSuggestions([]);
    requestAnimationFrame(() => {
      el.setSelectionRange(next.caret, next.caret);
      el.focus();
    });
  };

  return (
    <div className="note-edit-area">
      <textarea
        ref={ref}
        className={className}
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (suggestions.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, suggestions.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[selected]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setSuggestions([]); return; }
          }
          onKeyDown?.(e);
        }}
        onBlur={() => {
          // Let a click on a suggestion land first.
          setTimeout(() => {
            setSuggestions([]);
            onBlur?.();
          }, 200);
        }}
      />
      {suggestions.length > 0 && (
        <MentionDropdown suggestions={suggestions} selected={selected} onPick={pick} />
      )}
    </div>
  );
};

// ── The thread ──────────────────────────────────────────────────────────────

interface NoteThreadProps {
  note: NoteThreadData;
  /** Who is writing here; empty when nobody is signed in. */
  me: string;
  /** Everyone who can be assigned or mentioned. */
  people: string[];
  assets: Asset[];
  onUpdate: (updates: NoteThreadUpdate) => void;
  /** Draws note text the way the panel draws a note — links, media, mentions. */
  renderContent: (text: string) => React.ReactNode;
  formatDate: (iso: string) => string;
}

const NoteThread: React.FC<NoteThreadProps> = ({
  note, me, people, assets, onUpdate, renderContent, formatDate,
}) => {
  const replies = noteReplies(note);
  const resolved = isNoteResolved(note);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const submitReply = () => {
    const text = draft.trim();
    if (!text) return;
    onUpdate(addNoteReply(note, me, text));
    setDraft('');
    setComposing(false);
  };

  // Enter commits, and so does the blur that follows it a moment later; the
  // ref makes the second one a no-op instead of a second write.
  const editingRef = useRef<string | null>(null);
  const startEdit = (id: string, content: string) => {
    editingRef.current = id;
    setEditingReplyId(id);
    setEditDraft(content);
  };
  const submitEdit = () => {
    const id = editingRef.current;
    if (!id) return;
    editingRef.current = null;
    const text = editDraft.trim();
    // Emptying a reply is not how to delete it; leave it as it was.
    if (text) onUpdate(editNoteReply(note, id, text));
    setEditingReplyId(null);
  };
  const cancelEdit = () => {
    editingRef.current = null;
    setEditingReplyId(null);
  };

  /** A reply is yours when it carries your name — or, with nobody signed in
   *  on this copy, when it carries none either. */
  const isMine = (author: string) => (me ? samePerson(author, me) : !author);

  // The assignee may be someone this window has never seen online; keep them
  // in the list so the pulldown still shows who it is.
  const assignable = note.assignee && !people.some((p) => samePerson(p, note.assignee))
    ? [...people, note.assignee]
    : people;

  return (
    <div className="note-thread">
      {replies.length > 0 && (
        <ul className="note-replies" aria-label="Replies">
          {replies.map((r) => (
            <li key={r.id} className="note-reply">
              <div className="note-reply-header">
                {/* Signed out, a writer has no name to put here; their notes
                    leave it out too rather than calling them "Unknown". */}
                <span className="note-reply-author">{r.author}</span>
                <span className="note-reply-date">
                  {r.createdAt ? formatDate(r.createdAt) : ''}
                  {r.editedAt ? ' (edited)' : ''}
                </span>
              </div>
              {editingReplyId === r.id ? (
                <MentionTextarea
                  className="note-item-content"
                  value={editDraft}
                  onChange={setEditDraft}
                  people={people}
                  assets={assets}
                  autoFocus
                  ariaLabel="Edit reply"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  }}
                  onBlur={submitEdit}
                />
              ) : (
                <div className="note-reply-content">{renderContent(r.content)}</div>
              )}
              {isMine(r.author) && editingReplyId !== r.id && (
                <div className="note-reply-actions">
                  <button
                    className="note-link-btn"
                    onClick={() => startEdit(r.id, r.content)}
                  >
                    Edit
                  </button>
                  <button
                    className="note-link-btn note-link-danger"
                    onClick={() => onUpdate(deleteNoteReply(note, r.id))}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {composing ? (
        <div className="note-reply-composer">
          <MentionTextarea
            className="note-item-content"
            value={draft}
            onChange={setDraft}
            people={people}
            assets={assets}
            autoFocus
            ariaLabel="Reply"
            placeholder="Reply… (@ to mention someone; Shift+Enter for a new line)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(); }
              if (e.key === 'Escape') { e.preventDefault(); setComposing(false); setDraft(''); }
            }}
          />
          <div className="note-reply-composer-actions">
            <button className="note-link-btn" onClick={() => { setComposing(false); setDraft(''); }}>Cancel</button>
            <button className="note-reply-submit" onClick={submitReply} disabled={!draft.trim()}>
              {resolved ? 'Reply & reopen' : 'Reply'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="note-thread-bar">
        {!composing && (
          <button className="note-link-btn" onClick={() => setComposing(true)}>
            Reply{replies.length > 0 ? ` (${replies.length})` : ''}
          </button>
        )}
        {assignable.length > 0 && (
          <Select
            className={`note-assign-select${note.assignee ? ' active' : ''}`}
            value={note.assignee ?? ''}
            onChange={(e) => onUpdate(assignNote(e.target.value))}
            title="Assign this note to a collaborator"
            aria-label="Assigned to"
          >
            <option value="">Unassigned</option>
            {assignable.map((p) => (
              <option key={p} value={p}>
                {p}{samePerson(p, me) ? ' (you)' : ''}
              </option>
            ))}
          </Select>
        )}
        <button
          className={`note-resolve-btn${resolved ? ' resolved' : ''}`}
          onClick={() => onUpdate(setNoteResolved(!resolved, me))}
          title={resolved ? 'Reopen this note' : 'Mark this note as resolved'}
        >
          {resolved ? <><FaUndo /> Reopen</> : <><FaCheck /> Resolve</>}
        </button>
      </div>
      {resolved && (
        <div className="note-resolved-line">
          Resolved{note.resolvedBy ? ` by ${note.resolvedBy}` : ''}
          {note.resolvedAt ? ` · ${formatDate(note.resolvedAt)}` : ''}
        </div>
      )}
    </div>
  );
};

export default NoteThread;

/**
 * Suggestions — every suggested change in the script, for the writer to
 * accept or reject (editor/suggestions).
 *
 * Each card says who suggested what and when; clicking it goes to the change
 * in the script. An editor can accept or reject each one, or everything shown
 * at once, narrowed to one person if they like. A collaborator who is only
 * suggesting can withdraw their own suggestions, and cannot accept anything.
 */
import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { ELEMENT_LABELS } from '../stores/editorStore';
import { useSuggestModeStore, suggestionAuthor } from '../stores/suggestModeStore';
import {
  isOwn,
  listSuggestions,
  resolveSuggestionTransaction,
  resolveSuggestionsTransaction,
  type Suggestion,
} from '../editor/suggestions';
import Select from './Select';
import {
  adjacentSuggestion,
  filterSuggestions,
  formattingDescription,
  type ReviewFilter,
} from '../editor/suggestionReview';

interface Props {
  editor: Editor | null;
  style?: React.CSSProperties;
}

const typeLabel = (t?: string) => (t ? (ELEMENT_LABELS[t] ?? t).replace(/ \(.*\)$/, '') : '');

/** One line saying what the suggestion does. */
function describe(s: Suggestion): string {
  const parts: string[] = [];
  const ins = s.inserted.replace(/\n/g, ' ').trim();
  const del = s.deleted.replace(/\n/g, ' ').trim();
  if (del && ins) parts.push(`Replace “${del}” with “${ins}”`);
  else if (ins) parts.push(`Add “${ins}”`);
  else if (del) parts.push(`Delete “${del}”`);
  if (s.kinds.includes('split') && !ins) parts.push('Start a new line');
  else if (s.kinds.includes('split')) parts.push('on a new line');
  if (s.kinds.includes('join')) parts.push('Join to the line before');
  if (s.kinds.includes('type'))
    parts.push(`Change ${typeLabel(s.fromType)} to ${typeLabel(s.toType)}`);
  const formatting = formattingDescription(s);
  if (formatting) parts.push(formatting);
  return parts.join(' · ') || 'Change';
}

function when(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString();
}

function goTo(editor: Editor, pos: number, focus = true) {
  const at = Math.min(Math.max(1, pos), editor.state.doc.content.size);
  const chain = editor.chain();
  if (focus) chain.focus();
  chain.setTextSelection(at).run();
  requestAnimationFrame(() => {
    const coords = editor.view.coordsAtPos(at);
    const main = document.querySelector('.editor-main');
    if (!main || !coords) return;
    const rect = main.getBoundingClientRect();
    main.scrollTo({
      top: main.scrollTop + (coords.top - rect.top) - rect.height / 3,
      behavior: 'auto',
    });
  });
}

const SuggestionsPanel: React.FC<Props> = ({ editor, style }) => {
  const open = useSuggestModeStore((s) => s.panelOpen);
  const setOpen = useSuggestModeStore((s) => s.setPanelOpen);
  const locked = useSuggestModeStore((s) => s.locked);
  const suggesting = useSuggestModeStore((s) => s.suggesting);
  const setSuggesting = useSuggestModeStore((s) => s.setSuggesting);
  const [who, setWho] = useState('');
  const [kind, setKind] = useState<ReviewFilter>('all');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!editor) return () => {};
      editor.on('transaction', notify);
      return () => {
        editor.off('transaction', notify);
      };
    },
    [editor],
  );
  const snapshot = useCallback(() => editor?.state.doc, [editor]);
  const doc = useSyncExternalStore(subscribe, snapshot, snapshot);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const { shouldRender, animationState } = useDelayedUnmount(open, 250);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: close, enabled: shouldRender });

  const all = useMemo(() => (doc && open ? listSuggestions(doc) : []), [doc, open]);
  const people = useMemo(() => [...new Set(all.map((s) => s.by))].sort(), [all]);
  const me = suggestionAuthor();
  const shown = filterSuggestions(all, who, kind);
  const selected = shown.find((s) => s.id === currentId);
  const visit = (s: Suggestion | null, focus = true) => {
    if (!s || !editor) return;
    setCurrentId(s.id);
    goTo(editor, s.pos, focus);
  };
  const navigate = (direction: 1 | -1) =>
    visit(
      adjacentSuggestion(shown, currentId, editor?.state.selection.from ?? 0, direction),
      false,
    );

  if (!shouldRender) return null;
  const panelClass =
    animationState === 'entered'
      ? 'panel-open'
      : animationState === 'exiting'
        ? 'panel-closing'
        : '';

  const run = (tr: ReturnType<typeof resolveSuggestionTransaction>) => {
    if (editor && tr) editor.view.dispatch(tr);
  };
  const resolveOne = (id: string, accept: boolean, advance = false) => {
    if (
      !editor ||
      (locked &&
        (accept ||
          !isOwn(
            all.find((s) => s.id === id),
            me,
          )))
    )
      return;
    const old = listSuggestions(editor.state.doc).find((s) => s.id === id);
    const tr = resolveSuggestionTransaction(editor.state, id, accept);
    if (!tr) return;
    run(tr);
    if (advance) {
      const remaining = filterSuggestions(listSuggestions(editor.state.doc), who, kind);
      const position = tr.mapping.map(old?.pos ?? editor.state.selection.from, 1);
      visit(adjacentSuggestion(remaining, null, position, 1), false);
    }
  };
  const resolveShown = (accept: boolean) => {
    if (!editor || locked) return;
    const ids = new Set(shown.map((s) => s.id));
    run(resolveSuggestionsTransaction(editor.state, (st) => ids.has(st.id), accept));
  };
  /** A suggester may only take back their own. */
  const canResolve = (s: Suggestion) => !locked || isOwn(s, me);

  return (
    <div
      ref={panelRef}
      className={`tags-panel suggestions-panel ${panelClass}`}
      style={style}
      aria-label="Suggestions"
    >
      <div className="tags-panel-header">
        <span className="tags-panel-title">Suggestions</span>
        <span className="tags-panel-count" title="Suggestions waiting">
          {all.length}
        </span>
        <button
          className="tags-panel-close"
          onClick={close}
          title="Close"
          aria-label="Close Suggestions"
        >
          &times;
        </button>
      </div>

      <div className="suggestions-controls">
        <label className="suggestions-mode">
          <input
            type="checkbox"
            checked={suggesting}
            disabled={locked}
            onChange={(e) => setSuggesting(e.target.checked)}
          />
          <span>
            {locked
              ? 'You are suggesting — the writer decides what goes in'
              : 'Suggest my own changes'}
          </span>
        </label>
        {(people.length > 1 || who) && (
          <Select
            value={who}
            onChange={(e) => setWho(e.target.value)}
            aria-label="Whose suggestions"
          >
            <option value="">Everyone</option>
            {who && !people.includes(who) && <option value={who}>{who}</option>}
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        )}
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ReviewFilter);
            setCurrentId(null);
          }}
          aria-label="Change type"
        >
          <option value="all">All change types</option>
          <option value="text">Text changes</option>
          <option value="format">Formatting changes</option>
          <option value="structure">Element and line changes</option>
        </Select>
        <div className="suggestions-navigation" aria-label="Review navigation">
          <button
            className="dialog-btn"
            disabled={!shown.length}
            onClick={() => navigate(-1)}
            aria-label="Previous suggestion"
          >
            ← Previous
          </button>
          <span role="status" aria-live="polite">
            {selected
              ? `${shown.indexOf(selected) + 1} of ${shown.length}`
              : `${shown.length} shown`}
          </span>
          <button
            className="dialog-btn"
            disabled={!shown.length}
            onClick={() => navigate(1)}
            aria-label="Next suggestion"
          >
            Next →
          </button>
        </div>
        {selected && canResolve(selected) && (
          <div className="suggestions-bulk">
            {!locked && (
              <button className="dialog-btn" onClick={() => resolveOne(selected.id, true, true)}>
                Accept &amp; Next
              </button>
            )}
            <button className="dialog-btn" onClick={() => resolveOne(selected.id, false, true)}>
              {locked ? 'Withdraw' : 'Reject'} &amp; Next
            </button>
          </div>
        )}
        {!locked && shown.length > 0 && (
          <div className="suggestions-bulk">
            <button className="dialog-btn" onClick={() => resolveShown(true)}>
              Accept shown ({shown.length})
            </button>
            <button className="dialog-btn" onClick={() => resolveShown(false)}>
              Reject shown ({shown.length})
            </button>
          </div>
        )}
      </div>

      <div className="tags-panel-list suggestions-list">
        {shown.length === 0 && (
          <div className="tags-panel-empty">
            {all.length === 0
              ? 'No suggestions. Turn on Suggest my own changes, or invite someone to suggest from Tools → Collaboration.'
              : 'No suggestions match these filters.'}
          </div>
        )}
        {shown.map((s) => (
          <div
            key={s.id}
            className={`suggestion-card${s.id === currentId ? ' suggestion-card--current' : ''}`}
          >
            <button
              className="suggestion-card-main"
              onClick={() => visit(s)}
              aria-current={s.id === currentId ? 'true' : undefined}
              title="Go to this change in the script"
            >
              <span className="suggestion-card-who">
                {s.by}
                <span className="suggestion-card-when">{when(s.at)}</span>
              </span>
              <span className="suggestion-card-what">{describe(s)}</span>
            </button>
            {canResolve(s) && (
              <div className="suggestion-card-actions">
                {!locked && (
                  <button
                    className="suggestion-accept"
                    onClick={() => resolveOne(s.id, true)}
                    aria-label="Accept"
                    title="Accept"
                  >
                    &#10003; Accept
                  </button>
                )}
                <button
                  className="suggestion-reject"
                  onClick={() => resolveOne(s.id, false)}
                  aria-label={locked ? 'Withdraw' : 'Reject'}
                  title={locked ? 'Withdraw' : 'Reject'}
                >
                  &#10005; {locked ? 'Withdraw' : 'Reject'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SuggestionsPanel;

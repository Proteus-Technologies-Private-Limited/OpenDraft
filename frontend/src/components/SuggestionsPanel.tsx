/**
 * Suggestions — every suggested change in the script, for the writer to
 * accept or reject (editor/suggestions).
 *
 * Each card says who suggested what and when; clicking it goes to the change
 * in the script. An editor can accept or reject each one, or everything shown
 * at once, narrowed to one person if they like. A collaborator who is only
 * suggesting can withdraw their own suggestions, and cannot accept anything.
 */
import React, { useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { ELEMENT_LABELS } from '../stores/editorStore';
import { useSuggestModeStore, suggestionAuthor } from '../stores/suggestModeStore';
import {
  listSuggestions, resolveSuggestionTransaction, resolveSuggestionsTransaction, type Suggestion,
} from '../editor/suggestions';
import Select from './Select';

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
  if (s.kinds.includes('type')) parts.push(`Change ${typeLabel(s.fromType)} to ${typeLabel(s.toType)}`);
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

function goTo(editor: Editor, pos: number) {
  const at = Math.min(Math.max(1, pos), editor.state.doc.content.size);
  editor.chain().focus().setTextSelection(at).run();
  requestAnimationFrame(() => {
    const coords = editor.view.coordsAtPos(at);
    const main = document.querySelector('.editor-main');
    if (!main || !coords) return;
    const rect = main.getBoundingClientRect();
    main.scrollTo({ top: main.scrollTop + (coords.top - rect.top) - rect.height / 3, behavior: 'auto' });
  });
}

const SuggestionsPanel: React.FC<Props> = ({ editor, style }) => {
  const open = useSuggestModeStore((s) => s.panelOpen);
  const setOpen = useSuggestModeStore((s) => s.setPanelOpen);
  const locked = useSuggestModeStore((s) => s.locked);
  const suggesting = useSuggestModeStore((s) => s.suggesting);
  const setSuggesting = useSuggestModeStore((s) => s.setSuggesting);
  const [who, setWho] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const { shouldRender, animationState } = useDelayedUnmount(open, 250);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: close, enabled: shouldRender });

  const doc = editor?.state.doc;
  const all = useMemo(() => (doc && open ? listSuggestions(doc) : []), [doc, open]);
  const people = useMemo(() => [...new Set(all.map((s) => s.by))].sort(), [all]);
  const me = suggestionAuthor();
  const shown = who ? all.filter((s) => s.by === who) : all;

  if (!shouldRender) return null;
  const panelClass = animationState === 'entered' ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';

  const run = (tr: ReturnType<typeof resolveSuggestionTransaction>) => {
    if (editor && tr) editor.view.dispatch(tr);
  };
  const resolveOne = (id: string, accept: boolean) => editor && run(resolveSuggestionTransaction(editor.state, id, accept));
  const resolveShown = (accept: boolean) => {
    if (!editor) return;
    const ids = new Set(shown.map((s) => s.id));
    run(resolveSuggestionsTransaction(editor.state, (st) => ids.has(st.id), accept));
  };
  /** A suggester may only take back their own. */
  const canResolve = (s: Suggestion) => !locked || s.by === me;

  return (
    <div ref={panelRef} className={`tags-panel suggestions-panel ${panelClass}`} style={style} aria-label="Suggestions">
      <div className="tags-panel-header">
        <span className="tags-panel-title">Suggestions</span>
        <span className="tags-panel-count" title="Suggestions waiting">{all.length}</span>
        <button className="tags-panel-close" onClick={close} title="Close" aria-label="Close Suggestions">&times;</button>
      </div>

      <div className="suggestions-controls">
        <label className="suggestions-mode">
          <input
            type="checkbox"
            checked={suggesting}
            disabled={locked}
            onChange={(e) => setSuggesting(e.target.checked)}
          />
          <span>{locked ? 'You are suggesting — the writer decides what goes in' : 'Suggest my own changes'}</span>
        </label>
        {people.length > 1 && (
          <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose suggestions">
            <option value="">Everyone</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        )}
        {!locked && shown.length > 0 && (
          <div className="suggestions-bulk">
            <button className="dialog-btn" onClick={() => resolveShown(true)}>Accept {who ? `${who}’s` : 'all'}</button>
            <button className="dialog-btn" onClick={() => resolveShown(false)}>Reject {who ? `${who}’s` : 'all'}</button>
          </div>
        )}
      </div>

      <div className="tags-panel-list suggestions-list">
        {shown.length === 0 && (
          <div className="tags-panel-empty">
            {all.length === 0
              ? 'No suggestions. Turn on Suggest my own changes, or invite someone to suggest from Tools → Collaboration.'
              : 'Nothing from this person.'}
          </div>
        )}
        {shown.map((s) => (
          <div key={s.id} className="suggestion-card">
            <button className="suggestion-card-main" onClick={() => editor && goTo(editor, s.pos)} title="Go to this change in the script">
              <span className="suggestion-card-who">{s.by}<span className="suggestion-card-when">{when(s.at)}</span></span>
              <span className="suggestion-card-what">{describe(s)}</span>
            </button>
            {canResolve(s) && (
              <div className="suggestion-card-actions">
                {!locked && (
                  <button className="suggestion-accept" onClick={() => resolveOne(s.id, true)} aria-label="Accept" title="Accept">&#10003; Accept</button>
                )}
                <button className="suggestion-reject" onClick={() => resolveOne(s.id, false)} aria-label={locked ? 'Withdraw' : 'Reject'} title={locked ? 'Withdraw' : 'Reject'}>
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

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
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatDate, formatTime } from '../i18n/format';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import { useSuggestModeStore, suggestionAuthor } from '../stores/suggestModeStore';
import {
  isOwn, listSuggestions, resolveSuggestionTransaction, resolveSuggestionsTransaction, type Suggestion,
} from '../editor/suggestions';
import Select from './Select';
import {
  adjacentSuggestion,
  filterSuggestions,
  formattingDescription,
  type ReviewFilter,
} from '../editor/suggestionReview';
import { elementLabel } from '../editor/elementLabels';

interface Props {
  editor: Editor | null;
  style?: React.CSSProperties;
}

const typeLabel = (type?: string) => (type ? elementLabel(type).replace(/ \(.*\)$/, '') : '');

/** One line saying what the suggestion does. */
function describe(s: Suggestion, t: TFunction<'tools'>): string {
  const parts: string[] = [];
  const ins = s.inserted.replace(/\n/g, ' ').trim();
  const del = s.deleted.replace(/\n/g, ' ').trim();
  if (del && ins) parts.push(t('suggestions.replace', { deleted: del, inserted: ins }));
  else if (ins) parts.push(t('suggestions.add', { text: ins }));
  else if (del) parts.push(t('suggestions.delete', { text: del }));
  if (s.kinds.includes('split') && !ins) parts.push(t('suggestions.startNewLine'));
  else if (s.kinds.includes('split')) parts.push(t('suggestions.onNewLine'));
  if (s.kinds.includes('join')) parts.push(t('suggestions.joinLine'));
  if (s.kinds.includes('type')) parts.push(t('suggestions.changeType', { from: typeLabel(s.fromType), to: typeLabel(s.toType) }));
  const formatting = formattingDescription(s);
  if (formatting) parts.push(formatting);
  return parts.join(' · ') || t('suggestions.change');
}

function when(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? formatTime(d, { hour: 'numeric', minute: '2-digit' })
    : formatDate(d);
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
    main.scrollTo({ top: main.scrollTop + (coords.top - rect.top) - rect.height / 3, behavior: 'auto' });
  });
}

const SuggestionsPanel: React.FC<Props> = ({ editor, style }) => {
  const { t } = useTranslation(['tools', 'common']);
  const open = useSuggestModeStore((s) => s.panelOpen);
  const setOpen = useSuggestModeStore((s) => s.setPanelOpen);
  const locked = useSuggestModeStore((s) => s.locked);
  const suggesting = useSuggestModeStore((s) => s.suggesting);
  const setSuggesting = useSuggestModeStore((s) => s.setSuggesting);
  const [who, setWho] = useState('');
  const [kind, setKind] = useState<ReviewFilter>('all');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const { shouldRender, animationState } = useDelayedUnmount(open, 250);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: close, enabled: shouldRender });
  const subscribe = useCallback((notify: () => void) => {
    if (!editor) return () => {};
    editor.on('transaction', notify);
    return () => { editor.off('transaction', notify); };
  }, [editor]);
  const snapshot = useCallback(() => editor?.state.doc, [editor]);
  const doc = useSyncExternalStore(subscribe, snapshot, snapshot);
  const all = useMemo(() => (doc && open ? listSuggestions(doc) : []), [doc, open]);
  const people = useMemo(() => [...new Set(all.map((s) => s.by))].sort(), [all]);
  const me = suggestionAuthor();
  const shown = filterSuggestions(all, who, all.length >= 2 ? kind : 'all');
  const selected = shown.find((s) => s.id === currentId);
  const visit = (s: Suggestion | null, focus = true) => {
    if (!s || !editor) return;
    setCurrentId(s.id);
    goTo(editor, s.pos, focus);
  };
  const navigate = (direction: 1 | -1) =>
    visit(adjacentSuggestion(shown, currentId, editor?.state.selection.from ?? 0, direction), false);

  if (!shouldRender) return null;
  const panelClass = animationState === 'entered' ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';
  const run = (tr: ReturnType<typeof resolveSuggestionTransaction>) => {
    if (editor && tr) editor.view.dispatch(tr);
  };
  const resolveOne = (id: string, accept: boolean) => {
    if (!editor || (locked && (accept || !isOwn(all.find((s) => s.id === id), me)))) return;
    const old = listSuggestions(editor.state.doc).find((s) => s.id === id);
    const tr = resolveSuggestionTransaction(editor.state, id, accept);
    if (!tr) return;
    run(tr);
    const remainingAll = listSuggestions(editor.state.doc);
    const remaining = filterSuggestions(remainingAll, who, remainingAll.length >= 2 ? kind : 'all');
    const next = adjacentSuggestion(remaining, null, tr.mapping.map(old?.pos ?? editor.state.selection.from, 1), 1);
    visit(next, false);
    requestAnimationFrame(() => {
      const cards = panelRef.current?.querySelectorAll<HTMLElement>('[data-suggestion-id]');
      const card = Array.from(cards ?? []).find((element) => element.dataset.suggestionId === next?.id);
      const control = card?.querySelector<HTMLElement>(accept ? '.suggestion-accept' : '.suggestion-reject')
        ?? card?.querySelector<HTMLElement>('.suggestion-card-main')
        ?? panelRef.current?.querySelector<HTMLElement>('.tags-panel-close');
      control?.focus();
    });
  };
  const resolveShown = (accept: boolean) => {
    if (!editor || locked) return;
    const ids = new Set(shown.map((s) => s.id));
    run(resolveSuggestionsTransaction(editor.state, (stamp) => ids.has(stamp.id), accept));
  };
  /** A suggester may only take back their own. */
  const canResolve = (s: Suggestion) => !locked || isOwn(s, me);

  return (
    <div ref={panelRef} className={`tags-panel suggestions-panel ${panelClass}`} style={style} aria-label={t('suggestions.title')}>
      <div className="tags-panel-header">
        <span className="tags-panel-title">{t('suggestions.title')}</span>
        <span className="tags-panel-count" title={t('suggestions.waiting')}>{all.length}</span>
        <button className="tags-panel-close" onClick={close} title={t('common:close')} aria-label={t('suggestions.closePanel')}>&times;</button>
      </div>
      <div className="suggestions-controls">
        <label className="suggestions-mode">
          <input
            type="checkbox"
            checked={suggesting}
            disabled={locked}
            onChange={(e) => setSuggesting(e.target.checked)}
          />
          <span>{locked ? t('suggestions.youAreSuggesting') : t('suggestions.suggestMine')}</span>
        </label>
        {(people.length > 1 || who) && (
          <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('suggestions.whose')}>
            <option value="">{t('suggestions.everyone')}</option>
            {who && !people.includes(who) && <option value={who}>{who}</option>}
            {people.map((person) => <option key={person} value={person}>{person}</option>)}
          </Select>
        )}
        {all.length >= 2 && (
          <Select value={kind} onChange={(e) => { setKind(e.target.value as ReviewFilter); setCurrentId(null); }} aria-label={t('suggestions.changeTypeLabel')}>
            <option value="all">{t('suggestions.filters.all')}</option>
            <option value="text">{t('suggestions.filters.text')}</option>
            <option value="format">{t('suggestions.filters.format')}</option>
            <option value="structure">{t('suggestions.filters.structure')}</option>
          </Select>
        )}
        {shown.length >= 2 && (
          <div className="suggestions-navigation" aria-label={t('suggestions.reviewNavigation')}>
            <button className="dialog-btn" onClick={() => navigate(-1)} aria-label={t('suggestions.previousSuggestion')}>{t('suggestions.previous')}</button>
            <span role="status" aria-live="polite">{selected ? t('suggestions.position', { current: shown.indexOf(selected) + 1, total: shown.length }) : t('suggestions.shown', { count: shown.length })}</span>
            <button className="dialog-btn" onClick={() => navigate(1)} aria-label={t('suggestions.nextSuggestion')}>{t('suggestions.next')}</button>
          </div>
        )}
        {!locked && shown.length > 1 && (
          <div className="suggestions-bulk">
            <button className="dialog-btn" onClick={() => resolveShown(true)}>{t('suggestions.acceptShown', { count: shown.length })}</button>
            <button className="dialog-btn" onClick={() => resolveShown(false)}>{t('suggestions.rejectShown', { count: shown.length })}</button>
          </div>
        )}
      </div>
      <div className="tags-panel-list suggestions-list">
        {shown.length === 0 && (
          <div className="tags-panel-empty">
            {all.length === 0
              ? t('suggestions.empty')
              : t('suggestions.noMatch')}
          </div>
        )}
        {shown.map((s) => (
          <div key={s.id} data-suggestion-id={s.id} className={`suggestion-card${s.id === currentId ? ' suggestion-card--current' : ''}`}>
            <button className="suggestion-card-main" onClick={() => visit(s)} aria-current={s.id === currentId ? 'true' : undefined} title={t('suggestions.goTo')}>
              <span className="suggestion-card-who">{s.by}<span className="suggestion-card-when">{when(s.at)}</span></span>
              <span className="suggestion-card-what">{describe(s, t)}</span>
            </button>
            {canResolve(s) && (
              <div className="suggestion-card-actions">
                {!locked && (
                  <button className="suggestion-accept" onClick={() => resolveOne(s.id, true)} aria-label={t('suggestions.accept')} title={t('suggestions.acceptTitle')}>&#10003; {t('suggestions.accept')}</button>
                )}
                <button className="suggestion-reject" onClick={() => resolveOne(s.id, false)} aria-label={locked ? t('suggestions.withdraw') : t('suggestions.reject')} title={locked ? t('suggestions.withdrawTitle') : t('suggestions.rejectTitle')}>
                  &#10005; {locked ? t('suggestions.withdraw') : t('suggestions.reject')}
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

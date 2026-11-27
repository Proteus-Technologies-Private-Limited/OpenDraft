/**
 * One filed task: its status, subject, the excerpt with its formatting, an
 * optional note, and what can be done with it.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { FaCopy, FaCrosshairs, FaFileImport, FaStickyNote, FaTrash } from 'react-icons/fa';
import { updateData, updateTask, type TaskPatch } from '../data';
import { KEEP_STATUSES, PANEL_ID, PLUGIN_ID, TRACK_STATUSES, type Task, type TaskType } from '../model';
import { hasScriptSource, insertExcerpt, renderExcerpt, revealInScript } from '../script';
import { notify, typeLabel } from '../actions';
import { ExcerptView } from './ExcerptView';
import { TypeIcon } from './icons';

interface Props {
  task: Task;
  type: TaskType | undefined;
  types: TaskType[];
  editor: Editor | null;
  autoFocus: boolean;
  onDelete: (task: Task) => void;
  onError: (message: string) => void;
}

export function TaskCard({ task, type, types, editor, autoFocus, onDelete, onError }: Props) {
  const { t } = useTranslation(PLUGIN_ID);
  const id = useId();
  const subjectRef = useRef<HTMLInputElement>(null);
  const cancelSubjectEdit = useRef(false);
  const [subjectDraft, setSubjectDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const note = noteDraft ?? task.note;
  const [noteOpen, setNoteOpen] = useState(task.note !== '');
  const [copied, setCopied] = useState(false);
  const kind = type?.kind ?? 'track';
  const closed = task.status === 'done' || task.status === 'used';

  // A new task is shown, and with a mouse its subject is ready to retype. On a
  // touch screen focusing the field would raise the on-screen keyboard over
  // the panel, so it is only scrolled into view.
  useEffect(() => {
    if (!autoFocus) return;
    subjectRef.current?.scrollIntoView({ block: 'nearest' });
    let finePointer = true;
    try {
      finePointer = window.matchMedia('(pointer: fine)').matches;
    } catch (err) {
      console.warn('[sidekick] could not tell the pointer type', err);
    }
    if (!finePointer) return;
    subjectRef.current?.focus();
    subjectRef.current?.select();
  }, [autoFocus]);

  const save = (patch: TaskPatch) => {
    const error = updateData((data) => updateTask(data, task.id, patch));
    if (error) onError(t('errors.saveFailed', { message: error }));
    return !error;
  };

  const commitSubject = () => {
    const subject = subjectDraft?.trim();
    const cancel = cancelSubjectEdit.current;
    cancelSubjectEdit.current = false;
    if (!cancel && subject && subject !== task.subject && !save({ subject })) return;
    setSubjectDraft(null);
  };

  const goTo = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!editor || editor.isDestroyed) return onError(t('errors.noEditor'));
    const panel = event.currentTarget.closest('.plugin-panel-tabs__content');
    const overlay = panel && getComputedStyle(panel).position === 'fixed';
    const found = revealInScript(editor, task.excerpt, task.source, !overlay);
    if (!found) void notify(t('task.notFound'), 'error');
    else {
      if (overlay) document.dispatchEvent(new CustomEvent('plugin-panel:close', { detail: { panelId: PANEL_ID } }));
      if (!found.exact && task.source.navigation !== 'cursor') void notify(t('task.locationOnly'), 'info');
    }
  };

  const insert = () => {
    if (!editor || editor.isDestroyed) return onError(t('errors.noEditor'));
    try {
      insertExcerpt(editor, task.excerpt, task.source);
    } catch (err) {
      return onError(t('errors.insertFailed', { message: err instanceof Error ? err.message : String(err) }));
    }
    // Something held for later has now been used.
    if (kind === 'keep' && task.status === 'kept') save({ status: 'used' });
  };

  const copy = async () => {
    try {
      const fragment = editor && !editor.isDestroyed ? renderExcerpt(editor.schema, task.excerpt) : null;
      if (fragment && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        // HTML as the editor writes it, so pasting into a script keeps the formatting.
        const holder = document.createElement('div');
        holder.append(fragment);
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([holder.innerHTML], { type: 'text/html' }),
            'text/plain': new Blob([task.excerpt.text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(task.excerpt.text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      onError(t('errors.copyFailed', { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  const statuses = kind === 'track' ? TRACK_STATUSES : KEEP_STATUSES;
  const canGoTo = hasScriptSource(task.excerpt, task.source);
  const hasExcerpt = Boolean(task.excerpt.text);
  const scene = task.source.sceneHeading ? t('task.from', { scene: task.source.sceneHeading }) : t('task.noScene');

  return (
    <article
      className={`sk-card${closed ? ' sk-card--closed' : ''}`}
      style={{ '--sk-type-color': type?.color ?? '#7c8aa5' } as React.CSSProperties}
      aria-labelledby={`${id}-subject`}
    >
      <div className="sk-card__head">
        {kind === 'track' ? (
          <input
            type="checkbox"
            className="sk-check"
            checked={task.status === 'done'}
            onChange={(e) => save({ status: e.target.checked ? 'done' : 'open' })}
            aria-label={task.status === 'done' ? t('task.markOpen') : t('task.markDone')}
            title={task.status === 'done' ? t('task.markOpen') : t('task.markDone')}
          />
        ) : (
          <span className="sk-card__kind-icon" aria-hidden>
            <TypeIcon icon={type?.icon ?? 'custom'} />
          </span>
        )}
        <label className="sk-visually-hidden" htmlFor={`${id}-subject`}>{t('task.subject')}</label>
        <input
          id={`${id}-subject`}
          ref={subjectRef}
          className="sk-subject"
          value={subjectDraft ?? task.subject}
          onChange={(e) => setSubjectDraft(e.target.value)}
          onBlur={commitSubject}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== 'Escape') return;
            e.preventDefault();
            cancelSubjectEdit.current = e.key === 'Escape';
            e.currentTarget.blur();
          }}
        />
      </div>

      <div className="sk-card__meta">
        <label className="sk-visually-hidden" htmlFor={`${id}-status`}>{t('task.status')}</label>
        <select id={`${id}-status`} className="sk-select" value={task.status} onChange={(e) => save({ status: e.target.value as Task['status'] })}>
          {statuses.map((status) => <option key={status} value={status}>{t(`status.${status}`)}</option>)}
        </select>
        <label className="sk-visually-hidden" htmlFor={`${id}-type`}>{t('task.type')}</label>
        <select id={`${id}-type`} className="sk-select" value={task.typeId} onChange={(e) => save({ typeId: e.target.value })}>
          {!type && <option value={task.typeId}>{t('panel.other')}</option>}
          {types.map((option) => <option key={option.id} value={option.id}>{typeLabel(option)}</option>)}
        </select>
        {canGoTo && <span className="sk-card__scene" title={scene}>{scene}</span>}
      </div>

      {hasExcerpt && <ExcerptView editor={editor} excerpt={task.excerpt} />}

      {noteOpen && (
        <>
          <label className="sk-visually-hidden" htmlFor={`${id}-note`}>{t('task.note')}</label>
          <textarea
            id={`${id}-note`}
            className="sk-note"
            rows={2}
            value={note}
            placeholder={t('task.notePlaceholder')}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => {
              if (note !== task.note && !save({ note })) return;
              setNoteDraft(null);
              if (!note) setNoteOpen(false);
            }}
          />
        </>
      )}

      <div className="sk-card__actions">
        {canGoTo && (
          <button type="button" className="sk-action" onClick={goTo} title={t(task.source.navigation === 'cursor' ? 'task.goToCursorTitle' : 'task.goToTitle')}>
            <FaCrosshairs aria-hidden /> {t('task.goTo')}
          </button>
        )}
        {hasExcerpt && (
          <>
            <button type="button" className="sk-action" onClick={insert} title={t(task.source.navigation === 'cursor' ? 'task.insertMovedTitle' : 'task.insertTitle')}>
              <FaFileImport aria-hidden /> {t('task.insert')}
            </button>
            <button type="button" className="sk-action" onClick={() => void copy()} aria-live="polite">
              <FaCopy aria-hidden /> {copied ? t('task.copied') : t('task.copy')}
            </button>
          </>
        )}
        {!noteOpen && (
          <button type="button" className="sk-action" onClick={() => setNoteOpen(true)}>
            <FaStickyNote aria-hidden /> {t('task.addNote')}
          </button>
        )}
        <button
          type="button"
          className="sk-action sk-action--danger"
          onClick={() => onDelete(task)}
          aria-label={`${t('task.delete')}: ${task.subject}`}
          title={t('task.delete')}
        >
          <FaTrash aria-hidden />
        </button>
      </div>
    </article>
  );
}

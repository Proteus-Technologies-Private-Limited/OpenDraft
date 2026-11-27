/**
 * The Sidekick panel (right sidebar): file a selection under a type, then
 * track it to done or keep it for later.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { FaChevronDown, FaChevronRight, FaTimes } from 'react-icons/fa';
import { removeTask, restoreTask, updateData, useSidekickData } from '../data';
import { allTypes, isPending, PLUGIN_ID, visibleTypes, type Task, type TaskType } from '../model';
import { typeLabel, type FileResult } from '../actions';
import { DropGrid } from './DropGrid';
import { TaskCard } from './TaskCard';
import { TypeManager } from './TypeManager';
import './sidekick.css';

type Filter = 'pending' | 'closed' | 'all';

/** Whether the editor has a selection, kept current as it moves. */
function useHasSelection(editor: Editor | null): boolean {
  const [has, setHas] = useState(() => !!editor && !editor.state.selection.empty);
  useEffect(() => {
    if (!editor) return;
    const sync = () => setHas(!editor.isDestroyed && !editor.state.selection.empty);
    sync();
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);
  return has;
}

export function SidekickPanel({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation(PLUGIN_ID);
  const data = useSidekickData();
  const hasSelection = useHasSelection(editor);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ task: Task; index: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [typesOpen, setTypesOpen] = useState(false);

  // The undo offer lasts a few seconds.
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), 8000);
    return () => clearTimeout(timer);
  }, [deleted]);

  const types = allTypes(data);
  const pending = data.tasks.filter(isPending).length;
  const closed = data.tasks.length - pending;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = data.tasks.filter((task) => {
      if (filter === 'pending' && !isPending(task)) return false;
      if (filter === 'closed' && isPending(task)) return false;
      if (!q) return true;
      return [task.subject, task.note, task.excerpt.text, task.source.sceneHeading ?? ''].some((s) => s.toLowerCase().includes(q));
    });
    const byType = new Map<string, Task[]>();
    for (const task of shown) byType.set(task.typeId, [...(byType.get(task.typeId) ?? []), task]);
    const known = new Set(types.map((type) => type.id));
    const result: Array<{ key: string; type: TaskType | undefined; tasks: Task[] }> = types
      .filter((type) => byType.has(type.id))
      .map((type) => ({ key: type.id, type, tasks: byType.get(type.id)! }));
    const orphans = shown.filter((task) => !known.has(task.typeId));
    if (orphans.length) result.push({ key: '__other', type: undefined, tasks: orphans });
    return result;
  }, [data.tasks, types, filter, query]);

  const onFiled = (result: FileResult) => {
    if (!result.ok) return setError(result.error);
    setError(null);
    setFilter((f) => (f === 'closed' ? 'pending' : f));
    setCollapsed((c) => { const n = new Set(c); n.delete(result.task.typeId); return n; });
    setFocusId(result.task.id);
  };

  const onDelete = (task: Task) => {
    const index = data.tasks.findIndex((item) => item.id === task.id);
    const err = updateData((d) => removeTask(d, task.id));
    if (err) return setError(t('errors.saveFailed', { message: err }));
    setDeleted({ task, index });
  };

  const undo = () => {
    if (!deleted) return;
    const err = updateData((d) => restoreTask(d, deleted.task, deleted.index));
    if (err) setError(t('errors.saveFailed', { message: err }));
    setDeleted(null);
  };

  const toggle = (key: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  if (!editor) {
    return <div className="sk-panel"><p className="sk-help sk-pad sk-panel__scroll">{t('panel.noScript')}</p></div>;
  }

  return (
    <div className="sk-panel">
      <header className="sk-panel__header">
        <h2 className="sk-panel__title">{t('panel.title')}</h2>
        <span className="sk-panel__summary">{t('panel.summary', { pending, closed })}</span>
      </header>

      {error && (
        <div className="sk-banner sk-banner--error" role="alert">
          <span>{error}</span>
          <button type="button" className="sk-icon-button" onClick={() => setError(null)} aria-label={t('panel.dismiss')}><FaTimes aria-hidden /></button>
        </div>
      )}

      <div className="sk-panel__scroll">
      <DropGrid editor={editor} types={visibleTypes(data)} hasSelection={hasSelection} onFiled={onFiled} />

      <div className="sk-toolbar">
        <label className="sk-visually-hidden" htmlFor="sk-search">{t('panel.search')}</label>
        <input id="sk-search" className="sk-input" type="search" placeholder={t('panel.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="sk-visually-hidden" htmlFor="sk-filter">{t('panel.filter')}</label>
        <select id="sk-filter" className="sk-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="pending">{t('panel.filterPending')}</option>
          <option value="closed">{t('panel.filterClosed')}</option>
          <option value="all">{t('panel.filterAll')}</option>
        </select>
      </div>

      <div className="sk-list">
        {data.tasks.length === 0 && <p className="sk-help sk-pad">{t('panel.empty')}</p>}
        {data.tasks.length > 0 && groups.length === 0 && <p className="sk-help sk-pad">{t('panel.emptyFiltered')}</p>}
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          const label = group.type ? typeLabel(group.type) : t('panel.other');
          return (
            <section key={group.key} className="sk-group" style={{ '--sk-type-color': group.type?.color ?? '#7c8aa5' } as React.CSSProperties}>
              <h3 className="sk-group__heading">
                <button type="button" className="sk-group__toggle" onClick={() => toggle(group.key)} aria-expanded={!isCollapsed}>
                  {isCollapsed ? <FaChevronRight aria-hidden /> : <FaChevronDown aria-hidden />}
                  <span className="sk-group__dot" aria-hidden />
                  <span>{label}</span>
                  <span className="sk-group__count">{t('panel.count', { count: group.tasks.length })}</span>
                </button>
              </h3>
              {!isCollapsed && group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  type={group.type}
                  types={types}
                  editor={editor}
                  autoFocus={task.id === focusId}
                  onDelete={onDelete}
                  onError={setError}
                />
              ))}
            </section>
          );
        })}
      </div>

      <section className="sk-group sk-group--types">
        <h3 className="sk-group__heading">
          <button type="button" className="sk-group__toggle" onClick={() => setTypesOpen((v) => !v)} aria-expanded={typesOpen}>
            {typesOpen ? <FaChevronDown aria-hidden /> : <FaChevronRight aria-hidden />}
            <span>{t('panel.typesTitle')}</span>
          </button>
        </h3>
        {typesOpen && <TypeManager data={data} onError={setError} />}
      </section>

      {deleted && (
        <div className="sk-banner" role="status">
          <span>{t('panel.undoDelete')}</span>
          <button type="button" className="sk-action" onClick={undo}>{t('panel.undo')}</button>
        </div>
      )}
      </div>
    </div>
  );
}

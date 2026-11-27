/**
 * The Sidekick's commands, shared by the menu, the panel, the keyboard
 * shortcuts and drops, so each does exactly the same thing.
 */
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { pluginRegistry, resolvePluginText } from '../../plugins/registry';
import { i18next } from '../../i18n';
import { showToast } from '../../components/Toast';
import { addTask, readData, removeTask, updateData } from './data';
import { findType, PANEL_ID, PLUGIN_ID, type Task, type TaskType } from './model';
import { captureExternalDrop, captureSelection, draggedSelection, emptyExcerpt, moveSelection, sourceAt, unlinkedSource, type Capture } from './script';

export const tr = (key: string, options?: Record<string, unknown>): string =>
  String(i18next.t(`${PLUGIN_ID}:${key}`, { ...options, defaultValue: key }));

/** The words for a type — its translation when it has one. */
export function typeLabel(type: { label: string; labelKey?: string }): string {
  return resolvePluginText(type.labelKey, type.label);
}

/** Show the Sidekick in the right sidebar. */
export function openPanel(): void {
  document.dispatchEvent(new CustomEvent('plugin-panel:open', { detail: { panelId: PANEL_ID } }));
}

/** A short message for the writer, through core's toast. */
export async function notify(text: string, type: 'info' | 'success' | 'error' = 'info'): Promise<void> {
  try {
    showToast(text, type);
  } catch (err) {
    console.warn('[sidekick] could not show a message', text, err);
  }
}

export type FileResult = { ok: true; task: Task } | { ok: false; error: string };

/** File an already-captured excerpt under a type. */
function fileCapture(capture: Capture, typeId: string): FileResult {
  let created: Task | null = null;
  const error = updateData((data) => {
    const result = addTask(data, { typeId, excerpt: capture.excerpt, source: capture.source });
    created = result.task;
    return result.data;
  });
  if (error || !created) return { ok: false, error: tr('errors.saveFailed', { message: error ?? 'unknown error' }) };
  return { ok: true, task: created };
}

function fileFromEditor(editor: Editor, type: TaskType, origin: EditorState): FileResult {
  if (type.scriptLink === 'none') return fileCapture({ excerpt: emptyExcerpt, source: unlinkedSource }, type.id);

  const capture = captureSelection(origin);
  if (!capture) {
    if (type.scriptLink === 'required') return { ok: false, error: tr('errors.noSelection') };
    const source = sourceAt(origin.doc, origin.selection.head, 'cursor');
    return fileCapture({ excerpt: emptyExcerpt, source }, type.id);
  }
  if (type.textAction === 'copy') return fileCapture(capture, type.id);

  const { state, view } = editor;
  if (!editor.isEditable || state.doc !== origin.doc) return { ok: false, error: tr('errors.moveFailed') };
  const transaction = moveSelection(state, origin.selection);
  if (!transaction.docChanged) return { ok: false, error: tr('errors.moveFailed') };
  const source = sourceAt(transaction.doc, transaction.selection.from, 'cursor');

  // Store the excerpt before deleting it. Core may reject the write or the editor transaction.
  const result = fileCapture({ ...capture, source }, type.id);
  if (!result.ok) return result;
  try {
    if (editor.state.doc === state.doc && !editor.isDestroyed) view.dispatch(transaction);
  } catch (err) {
    console.error('[sidekick] could not move the editor selection', err);
  }
  if (editor.state.doc.eq(state.doc)) {
    const error = updateData((data) => removeTask(data, result.task.id));
    return { ok: false, error: error ? tr('errors.saveFailed', { message: error }) : tr('errors.moveFailed') };
  }
  return result;
}

/** File from the current editor, a drag from this editor, or an outside drop. */
export function fileSelection(editor: Editor | null, typeId: string, drop?: DataTransfer): FileResult {
  if (!editor || editor.isDestroyed) return { ok: false, error: tr('errors.noEditor') };
  const type = findType(readData(), typeId);
  if (!type) return { ok: false, error: tr('errors.noType') };
  try {
    if (!drop) return fileFromEditor(editor, type, editor.state);
    if (type.scriptLink === 'none') return { ok: false, error: tr('errors.dropFailed') };
    const origin = draggedSelection(editor, drop);
    if (origin) return fileFromEditor(editor, type, origin);
    if (type.textAction === 'move') return { ok: false, error: tr('errors.moveDrop') };
    const capture = captureExternalDrop(editor.schema, drop);
    return capture ? fileCapture(capture, typeId) : { ok: false, error: tr('errors.dropFailed') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** File the selection from a menu or shortcut: open the panel and confirm, or say why not. */
export function fileSelectionWithFeedback(editor: Editor | null, typeId: string): boolean {
  const result = fileSelection(editor, typeId);
  if (!result.ok) {
    void notify(result.error, 'error');
    return false;
  }
  const type = findType(readData(), typeId);
  openPanel();
  void notify(tr('task.filed', { type: type ? typeLabel(type) : typeId }), 'success');
  return true;
}

export function canFile(editor: Editor | null, type: TaskType | undefined): boolean {
  if (!editor || editor.isDestroyed || !type) return false;
  if (type.scriptLink === 'none') return true;
  if (editor.state.selection.empty) return type.scriptLink === 'optional';
  return type.textAction === 'copy' || editor.isEditable;
}

/** Ask core which editor is open, for code that is not handed one. */
export function currentEditor(): Editor | null {
  return pluginRegistry.getEditor();
}

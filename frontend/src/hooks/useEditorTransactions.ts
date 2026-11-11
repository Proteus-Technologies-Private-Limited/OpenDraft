import { useEffect, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Re-renders the caller after every transaction `editor` dispatches, while
 * `enabled`. For components that read editor state (the selection, active
 * marks, the document) while rendering.
 *
 * The screenplay editor does not re-render on transactions itself: that
 * re-rendered the whole editor screen, menu bar included, for every key
 * pressed (issue #229). Each component that needs the live state subscribes
 * here instead, and only while it is showing.
 */
export function useEditorTransactions(editor: Editor | null | undefined, enabled = true): void {
  useEditorState({
    editor: editor ?? null,
    selector: ({ transactionNumber }) => (enabled ? transactionNumber : -1),
  });
}

/**
 * `select(editor)`, re-run after every transaction; the caller re-renders only
 * when the result changes under `equalityFn` (deep equality by default).
 *
 * Always reads the `editor` passed in, never the one in Tiptap's snapshot.
 * When the screenplay editor is rebuilt (opening a file, recovery, joining or
 * leaving a collab session) Tiptap swaps the editor it listens to but keeps
 * the old snapshot until the new editor dispatches a transaction, so a
 * selector reading the snapshot's editor would describe the destroyed one —
 * the previous script's word count, scenes and undo state — until then.
 *
 * A selector that throws would throw during render and take the component
 * down with it; it is logged under `label` and answered with `fallback`.
 */
export function useEditorSelector<T>(
  editor: Editor | null | undefined,
  select: (editor: Editor) => T,
  fallback: T,
  label: string,
  equalityFn?: (a: T, b: T | null) => boolean,
): T {
  const ed = editor ?? null;
  const selected = useEditorState({
    editor: ed,
    selector: () => readEditor(ed, select, fallback, label),
    equalityFn,
  });
  return selected ?? fallback;
}

/** `select(editor)`, or `fallback` for a missing or destroyed editor or a selector that throws. */
export function readEditor<T>(
  editor: Editor | null,
  select: (editor: Editor) => T,
  fallback: T,
  label: string,
): T {
  if (!editor || editor.isDestroyed) return fallback;
  try {
    return select(editor);
  } catch (err) {
    console.warn(`[editor] ${label} could not be read from the editor`, err);
    return fallback;
  }
}

/**
 * The editor's document while `enabled`, else null. Re-renders the caller when
 * the document changes, and not for a selection that moves over it.
 */
export function useEditorDoc(editor: Editor | null | undefined, enabled = true): PMNode | null {
  return useEditorSelector<PMNode | null>(
    enabled ? editor : null,
    (ed) => ed.state.doc,
    null,
    'the document',
    Object.is,
  );
}

/** How long the document must sit still before a settled reader sees it. */
export const DOC_SETTLE_MS = 300;

/**
 * The editor's document while `enabled`, else null — but only once it has gone
 * `delayMs` without changing. Typing and held Backspace re-render the caller
 * once, after the burst, instead of once per key.
 *
 * For panels whose figures come from walking the whole script (the navigator's
 * scene lengths and timings, the status bar's runtime and word count). On a
 * long script those walks were most of the time each key took (#229). A new
 * editor, or a reader that has just been enabled, gets its document at once.
 */
export function useSettledEditorDoc(
  editor: Editor | null | undefined,
  enabled = true,
  delayMs = DOC_SETTLE_MS,
): PMNode | null {
  const ed = enabled && editor && !editor.isDestroyed ? editor : null;
  const [settled, setSettled] = useState<{ editor: Editor | null; doc: PMNode | null }>(
    () => ({ editor: ed, doc: ed ? ed.state.doc : null }),
  );
  // A different editor, or a reader switched off or back on, starts from the
  // document as it is now — not one kept from before.
  if (settled.editor !== ed) {
    setSettled({ editor: ed, doc: ed ? ed.state.doc : null });
  }

  useEffect(() => {
    if (!ed) return;
    return watchSettledDoc(ed, delayMs, (doc) => {
      setSettled((prev) => (prev.editor === ed && prev.doc === doc ? prev : { editor: ed, doc }));
    });
  }, [ed, delayMs]);

  if (!ed) return null;
  return settled.editor === ed ? settled.doc : ed.state.doc;
}

/**
 * Calls `onSettle(doc)` once `editor`'s document has gone `delayMs` without a
 * change; a burst of edits calls it once, after the last. Selection-only
 * transactions are not changes. Returns the unsubscribe.
 */
export function watchSettledDoc(
  editor: Pick<Editor, 'on' | 'off' | 'state' | 'isDestroyed'>,
  delayMs: number,
  onSettle: (doc: PMNode) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
    if (!transaction.docChanged) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!editor.isDestroyed) onSettle(editor.state.doc);
    }, delayMs);
  };
  editor.on('transaction', onTransaction);
  return () => {
    clearTimeout(timer);
    editor.off('transaction', onTransaction);
  };
}

const jsonCache = new WeakMap<PMNode, ReturnType<PMNode['toJSON']>>();

/**
 * `doc.toJSON()`, computed once per document. ProseMirror documents are
 * immutable, so the status bar, the navigator and the index cards can share
 * one serialisation per edit instead of each walking the whole script.
 */
export function docJSON(doc: PMNode): ReturnType<PMNode['toJSON']> {
  let json = jsonCache.get(doc);
  if (json === undefined) {
    json = doc.toJSON();
    jsonCache.set(doc, json);
  }
  return json;
}

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

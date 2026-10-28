/**
 * Feeds the writing-goals tracker (stores/writingGoalsStore) from the editor,
 * runs the sprint clock, and enforces a sprint's no-backspace rule.
 */
import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { useEditorStore } from '../stores/editorStore';
import { useWritingGoalsStore } from '../stores/writingGoalsStore';
import { countWords } from '../utils/writingGoals';
import { showToast } from '../components/Toast';

/** How long after the last edit the script is counted. */
const IDLE_MS = 3000;

/** A change that arrived from a collaborator (y-prosemirror marks those). */
function isRemote(tr: Transaction): boolean {
  const meta = tr.getMeta('y-sync$') as { isChangeOrigin?: boolean; isUndoRedoOperation?: boolean } | undefined;
  return !!meta?.isChangeOrigin && !meta.isUndoRedoOperation;
}

export function useWritingTracker(editor: Editor | null, scriptKey: string, enabled: boolean): void {
  // Count what was written: a while after typing stops, compare the script's
  // totals with the last ones seen.
  useEffect(() => {
    if (!editor || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remoteSeen = false;
    const count = () => {
      if (editor.isDestroyed) return;
      const doc = editor.state.doc;
      const words = countWords(doc.textBetween(0, doc.content.size, ' ', ' '));
      const pages = useEditorStore.getState().pageCount;
      const store = useWritingGoalsStore.getState();
      if (remoteSeen) {
        // A collaborator wrote in this pause too, and their words are not the
        // writer's: start again from here rather than count them.
        remoteSeen = false;
        useWritingGoalsStore.setState({ baseline: { scriptKey, words, pages } });
        return;
      }
      store.recordCount(scriptKey, words, pages);
    };
    const onUpdate = ({ transaction }: { transaction: Transaction }) => {
      if (isRemote(transaction)) remoteSeen = true;
      clearTimeout(timer);
      timer = setTimeout(count, IDLE_MS);
    };
    // The baseline for this script, once it has loaded.
    timer = setTimeout(count, IDLE_MS);
    editor.on('update', onUpdate);
    return () => {
      clearTimeout(timer);
      editor.off('update', onUpdate);
    };
  }, [editor, scriptKey, enabled]);

  // End a sprint when its time is up, wherever the writer is.
  const sprint = useWritingGoalsStore((s) => s.sprint);
  useEffect(() => {
    if (!sprint) return;
    const finish = () => {
      // Count the last few seconds before closing the sprint.
      if (editor && !editor.isDestroyed) {
        const doc = editor.state.doc;
        useWritingGoalsStore.getState().recordCount(
          scriptKey, countWords(doc.textBetween(0, doc.content.size, ' ', ' ')), useEditorStore.getState().pageCount,
        );
      }
      const done = useWritingGoalsStore.getState().endSprint();
      if (done) showToast(`Sprint finished — ${done.words} word${done.words === 1 ? '' : 's'} written.`, 'success');
    };
    const t = setTimeout(finish, Math.max(0, sprint.endsAt - Date.now()));
    return () => clearTimeout(t);
    // Re-armed only when a new sprint starts, not as its word count grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprint?.endsAt, editor, scriptKey]);

  // No-backspace sprints: deleting does nothing until the sprint ends.
  const noBackspace = !!sprint?.noBackspace;
  useEffect(() => {
    if (!editor || !noBackspace) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Touch keyboards delete through beforeinput rather than a key event.
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType.startsWith('delete')) e.preventDefault();
    };
    dom.addEventListener('keydown', onKey, true);
    dom.addEventListener('beforeinput', onBeforeInput, true);
    return () => {
      dom.removeEventListener('keydown', onKey, true);
      dom.removeEventListener('beforeinput', onBeforeInput, true);
    };
  }, [editor, noBackspace]);
}

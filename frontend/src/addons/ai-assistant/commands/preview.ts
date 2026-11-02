/**
 * A dry-run adapter for the assistant's insertion preview.
 *
 * Commands run against this instead of the editor: `insertDialogue` still
 * validates its arguments and reports what it would do, but the typed blocks
 * are only recorded. The panel shows them, and Accept runs the same commands
 * against the real TipTap adapter.
 */
import type {
  BlockSpec,
  CommandElement,
  EditorAdapter,
  ScriptContext,
} from './types';

export type PreviewOp =
  | { kind: 'blocks'; blocks: BlockSpec[] }
  | { kind: 'element'; type: CommandElement }
  | { kind: 'replace'; text: string; element?: CommandElement }
  | { kind: 'text'; text: string };

export interface PreviewAdapter {
  adapter: EditorAdapter;
  ops: PreviewOp[];
}

export function createPreviewAdapter(context: ScriptContext): PreviewAdapter {
  const ops: PreviewOp[] = [];
  const adapter: EditorAdapter = {
    context: () => context,
    insertBlocks: (blocks) => { ops.push({ kind: 'blocks', blocks }); },
    setElement: (type) => { ops.push({ kind: 'element', type }); },
    replaceSelection: (text, element) => { ops.push({ kind: 'replace', text, element }); },
    insertText: (text) => { ops.push({ kind: 'text', text }); },
    // Undoing or redoing a change that was never applied is not a preview.
    undo: () => {},
    redo: () => {},
  };
  return { adapter, ops };
}

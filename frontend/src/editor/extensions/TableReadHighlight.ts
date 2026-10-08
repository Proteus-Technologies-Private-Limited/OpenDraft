/**
 * Marks the line Table Read is reading, and the word it is on, in the script
 * itself (issue #131).
 *
 * Decorations only: nothing is written into the document, nothing reaches
 * collaborators, and the writer's selection is left where it was. The ranges
 * are mapped through edits, so typing while a read plays does not leave the
 * highlight stranded on the wrong words.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface TableReadRange { from: number; to: number }

interface HighlightState {
  block: TableReadRange | null;
  word: TableReadRange | null;
  decorations: DecorationSet;
}

export interface TableReadMeta {
  block?: TableReadRange | null;
  word?: TableReadRange | null;
}

export const tableReadPluginKey = new PluginKey<HighlightState>('tableReadHighlight');

function clamp(range: TableReadRange | null, size: number): TableReadRange | null {
  if (!range) return null;
  const from = Math.max(0, Math.min(range.from, size));
  const to = Math.max(from, Math.min(range.to, size));
  return to > from ? { from, to } : null;
}

function build(state: EditorState, block: TableReadRange | null, word: TableReadRange | null): DecorationSet {
  const size = state.doc.content.size;
  const decos: Decoration[] = [];
  const b = clamp(block, size);
  if (b) {
    // The block's own node, so the whole element is tinted, not just its text.
    const $pos = state.doc.resolve(b.from);
    if ($pos.depth > 0) {
      const start = $pos.before($pos.depth);
      const node = state.doc.nodeAt(start);
      if (node) decos.push(Decoration.node(start, start + node.nodeSize, { class: 'tr-reading-line' }));
    }
  }
  const w = clamp(word, size);
  if (w) decos.push(Decoration.inline(w.from, w.to, { class: 'tr-reading-word' }));
  return DecorationSet.create(state.doc, decos);
}

export const TableReadHighlight = Extension.create({
  name: 'tableReadHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: tableReadPluginKey,
        state: {
          init: () => ({ block: null, word: null, decorations: DecorationSet.empty }),
          apply(tr: Transaction, prev: HighlightState, _old: EditorState, state: EditorState): HighlightState {
            const meta = tr.getMeta(tableReadPluginKey) as TableReadMeta | undefined;
            if (!meta && !tr.docChanged) return prev;
            const map = (r: TableReadRange | null) =>
              r && tr.docChanged ? { from: tr.mapping.map(r.from), to: tr.mapping.map(r.to, -1) } : r;
            const block = meta && 'block' in meta ? meta.block ?? null : map(prev.block);
            const word = meta && 'word' in meta ? meta.word ?? null : map(prev.word);
            if (!block && !word) return { block: null, word: null, decorations: DecorationSet.empty };
            return { block, word, decorations: build(state, block, word) };
          },
        },
        props: {
          decorations(state) {
            return tableReadPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

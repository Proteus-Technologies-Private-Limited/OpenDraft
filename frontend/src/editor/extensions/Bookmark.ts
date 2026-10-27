/**
 * Bookmark — a named marker on a script element (Edit → Add Bookmark…).
 *
 * Stored as a `bookmark` attribute on the element, so it is part of the
 * document: saved with the script, synced to collaborators, carried through
 * undo. `utils/bookmarks.ts` lists and edits them.
 *
 * Drawn as a small flag in the left margin by a widget decoration. Not a
 * `::before`, which element numbers and scene numbers already use, and not an
 * absolutely positioned child, which would make the element `position:
 * relative` and pull its revision asterisks into the text column in print (see
 * the element-number note in screenplay.css).
 */
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BOOKMARKABLE_TYPES, listBookmarks } from '../../utils/bookmarks';

export const bookmarkPluginKey = new PluginKey<DecorationSet>('bookmarks');

function flag(name: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'bookmark-flag';
  el.contentEditable = 'false';
  el.setAttribute('aria-label', `Bookmark: ${name}`);
  el.title = `Bookmark: ${name}`;
  return el;
}

function buildDecorations(state: EditorState): DecorationSet {
  const decos = listBookmarks(state.doc).map((b) =>
    Decoration.widget(b.pos + 1, () => flag(b.name), {
      side: -1,
      ignoreSelection: true,
      marks: [],
      key: `bookmark:${b.name}`,
    }),
  );
  return DecorationSet.create(state.doc, decos);
}

/**
 * Pasted elements keep their bookmarks only when the name is free, so moving
 * a bookmarked line with cut and paste keeps it, while copying one does not
 * leave two bookmarks with the same name.
 */
function dropTakenBookmarks(fragment: Fragment, taken: Set<string>): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    let next = node;
    const name = node.attrs?.bookmark;
    if (typeof name === 'string' && name) {
      if (taken.has(name.toLowerCase())) next = node.type.create({ ...node.attrs, bookmark: null }, node.content, node.marks);
      else taken.add(name.toLowerCase());
    }
    if (!next.isLeaf && next.content.size) next = next.copy(dropTakenBookmarks(next.content, taken));
    nodes.push(next);
  });
  return Fragment.fromArray(nodes);
}

/**
 * Positions of elements whose bookmark repeats one already in the script —
 * all but the original, which is the first copy holding any text.
 *
 * Splitting a line mid-way copies every attribute to both halves (Tiptap's
 * `keepOnSplit: false` only covers a split at the very end), so without this
 * Enter in the middle of a bookmarked line would leave two bookmarks with the
 * same name. When the split is at the start, the first half is the empty one,
 * hence "first with text" rather than simply "first".
 */
export function duplicateBookmarks(doc: PMNode): number[] {
  const byName = new Map<string, Array<{ pos: number; empty: boolean }>>();
  for (const b of listBookmarks(doc)) {
    const key = b.name.toLowerCase();
    const list = byName.get(key) ?? [];
    list.push({ pos: b.pos, empty: !b.text.trim() });
    byName.set(key, list);
  }
  const extra: number[] = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const keep = (list.find((c) => !c.empty) ?? list[0]).pos;
    for (const c of list) if (c.pos !== keep) extra.push(c.pos);
  }
  return extra;
}

export const Bookmark = Extension.create({
  name: 'bookmark',

  addGlobalAttributes() {
    return [
      {
        types: [...BOOKMARKABLE_TYPES],
        attributes: {
          bookmark: {
            default: null,
            // Enter at the end of a bookmarked line must not bookmark the new one too.
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-bookmark') || null,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.bookmark ? { 'data-bookmark': String(attributes.bookmark) } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [createBookmarkPlugin()];
  },
});

/** The flags and the paste rule, apart from the extension so tests can run them. */
export function createBookmarkPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: bookmarkPluginKey,
    appendTransaction: (trs, _oldState, newState) => {
      if (!trs.some((tr) => tr.docChanged)) return null;
      const extra = duplicateBookmarks(newState.doc);
      if (!extra.length) return null;
      const tr = newState.tr;
      for (const pos of extra) tr.setNodeAttribute(pos, 'bookmark', null);
      return tr.setMeta('addToHistory', true);
    },
    state: {
      init: (_, state) => buildDecorations(state),
      apply: (tr, old, _oldState, newState) => (tr.docChanged ? buildDecorations(newState) : old),
    },
    props: {
      decorations: (state) => bookmarkPluginKey.getState(state),
      transformPasted: (slice, view) => {
        const taken = new Set(listBookmarks(view.state.doc).map((b) => b.name.toLowerCase()));
        return new Slice(dropTakenBookmarks(slice.content, taken), slice.openStart, slice.openEnd);
      },
    },
  });
}

/**
 * The reference number drawn in the script beside a printing note.
 *
 * It is a widget decoration, never document content, and that is the whole
 * point. The number depends on how many printing notes come before it, so
 * inserting a note in act one renumbers every note after it; if the number
 * lived in the document that would be a transaction on every edit — undo
 * history polluted, collaborators fighting over renumbering operations, and a
 * new mark attribute for Fountain and Final Draft to learn to ignore.
 *
 * As a decoration it costs none of that:
 *
 *   - `computeBreaks` reads `node.textContent` from the model, which never sees
 *     a widget, so a marker cannot move a page break by accident. Where it
 *     *should* affect the line — a bracketed marker is ordinary inline text —
 *     pagination accounts for it explicitly, through `plan.textWithMarkers`.
 *   - No exporter can leak it: it does not exist in the document. The PDF and
 *     Word exports draw their own markers from the same plan.
 *   - Renumbering is a repaint, not an edit.
 *
 * The anchored text also gets a class of its own, so that hiding note
 * highlights (View ▸ Note Highlights) hides the annotation colour but leaves
 * the marker showing — a printing note's number is part of the script, not an
 * annotation about it.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { FootnotePlan } from '../utils/footnotes';

export const footnoteMarkerPluginKey = new PluginKey('footnoteMarkers');

/** Document position of a block by its top-level index. */
function blockOffsets(doc: PmNode): number[] {
  const offsets: number[] = [];
  doc.forEach((_node, offset) => offsets.push(offset));
  return offsets;
}

function buildDecorations(doc: PmNode, plan: FootnotePlan | null): DecorationSet {
  if (!plan || plan.refs.length === 0) return DecorationSet.empty;

  const offsets = blockOffsets(doc);
  const decos: Decoration[] = [];
  const style = plan.settings.markerStyle;

  for (const ref of plan.refs) {
    const blockStart = offsets[ref.srcIndex];
    if (blockStart === undefined) continue;
    const block = doc.child(ref.srcIndex);
    // +1 to step inside the block; the offset is measured in its text.
    const at = blockStart + 1 + Math.min(ref.charOffset, block.content.size);
    if (at < 0 || at > doc.content.size) continue;

    const label = ref.label;
    decos.push(
      Decoration.widget(
        at,
        () => {
          const el = document.createElement(style === 'superscript' ? 'sup' : 'span');
          el.className = 'footnote-marker';
          el.textContent = label;
          el.setAttribute('contenteditable', 'false');
          el.setAttribute('aria-hidden', 'true');
          return el;
        },
        {
          side: 1,
          marks: [],
          ignoreSelection: true,
          // Lets ProseMirror reuse the node while the number is unchanged, so
          // ordinary typing does not thrash the marker DOM.
          key: `fn:${ref.noteId}:${label}`,
        },
      ),
    );
  }

  return DecorationSet.create(doc, decos);
}

/**
 * `getPlan` is read fresh on every recompute, the same way the paginator reads
 * its layout and template hints.
 */
export function createFootnoteMarkerPlugin(getPlan: () => FootnotePlan | null) {
  return new Plugin({
    key: footnoteMarkerPluginKey,
    props: {
      decorations(state) {
        return buildDecorations(state.doc, getPlan());
      },
    },
  });
}

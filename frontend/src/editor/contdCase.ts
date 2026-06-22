import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { PageLayout } from '../stores/editorStore';
import { resolveMoresContds } from '../stores/editorStore';

export const contdCasePluginKey = new PluginKey('contdCase');

/**
 * Character cues are force-uppercased by `.character { text-transform: uppercase }`.
 * That also uppercases a trailing continued marker, so a configured lowercase
 * marker like "(cont'd)" would still show as "(CONT'D)". This plugin renders that
 * trailing marker in its stored case (via an inline `text-transform: none`
 * decoration) while leaving the character name uppercased.
 */
export function createContdCasePlugin(getLayout: () => PageLayout) {
  return new Plugin({
    key: contdCasePluginKey,
    props: {
      decorations(state) {
        const marker = resolveMoresContds(getLayout()).contdText.toLowerCase();
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== 'character') return true;
          const text = node.textContent;
          const m = /\s*(\([^)]*\))\s*$/.exec(text); // trailing parenthetical
          if (m) {
            const paren = m[1];
            const lower = paren.toLowerCase();
            // Only the continued marker (configured text or a standard CONT'D form);
            // leave (V.O.)/(O.S.) etc. to the normal uppercase styling.
            if (lower === marker || /cont'?d|continued/.test(lower)) {
              const start = text.lastIndexOf(paren);
              const from = pos + 1 + start;
              const to = from + paren.length;
              decos.push(Decoration.inline(from, to, { style: 'text-transform: none' }));
            }
          }
          return false; // no need to descend into the character node's inline content
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

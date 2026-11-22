import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { PageLayout } from '../stores/editorStore';
import { resolveMoresContds } from '../stores/editorStore';

interface ContdCaseState {
  rendered?: { marker: string; decorations: DecorationSet };
}

export const contdCasePluginKey = new PluginKey<ContdCaseState>('contdCase');

/** Plain text edits within one non-cue block cannot change any continued markers. */
function editsNonCueText(tr: Transaction): boolean {
  const [step] = tr.steps;
  if (tr.steps.length !== 1 || !(step instanceof ReplaceStep)
      || step.slice.openStart || step.slice.openEnd) return false;
  const from = tr.before.resolve(step.from);
  const to = tr.before.resolve(step.to);
  if (!from.sameParent(to) || !from.parent.isTextblock || from.parent.type.name === 'character') return false;
  let textOnly = true;
  step.slice.content.forEach(node => { if (!node.isText) textOnly = false; });
  return textOnly;
}

function buildDecorations(doc: ProseMirrorNode, marker: string): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'character') return true;
    const text = node.textContent;
    const match = /\s*(\([^)]*\))\s*$/.exec(text);
    if (match) {
      const paren = match[1];
      const lower = paren.toLowerCase();
      // Only the configured or standard continued marker gets this styling.
      if (lower === marker || /cont'?d|continued/.test(lower)) {
        const from = pos + 1 + text.lastIndexOf(paren);
        decos.push(Decoration.inline(from, from + paren.length, { style: 'text-transform: none' }));
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/**
 * Character cues are force-uppercased by `.character { text-transform: uppercase }`.
 * That also uppercases a trailing continued marker, so a configured lowercase
 * marker like "(cont'd)" would still show as "(CONT'D)". This plugin renders that
 * trailing marker in its stored case (via an inline `text-transform: none`
 * decoration) while leaving the character name uppercased.
 */
export function createContdCasePlugin(getLayout: () => PageLayout) {
  return new Plugin<ContdCaseState>({
    key: contdCasePluginKey,
    state: {
      init: () => ({}),
      apply(tr, value) {
        if (!tr.docChanged) return value;
        if (!value.rendered || !editsNonCueText(tr)) return {};
        const { marker, decorations } = value.rendered;
        return { rendered: { marker, decorations: decorations.map(tr.mapping, tr.doc) } };
      },
    },
    props: {
      decorations(state) {
        const marker = resolveMoresContds(getLayout()).contdText.toLowerCase();
        const value = contdCasePluginKey.getState(state)!;
        // Layout settings can change independently of an editor transaction.
        if (value.rendered?.marker !== marker) {
          value.rendered = { marker, decorations: buildDecorations(state.doc, marker) };
        }
        return value.rendered.decorations;
      },
    },
  });
}

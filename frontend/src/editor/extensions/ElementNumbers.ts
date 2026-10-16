/**
 * Draws element numbers (utils/elementNumbers) beside the elements a format
 * numbers — every line of dialogue in a podcast, every SFX cue.
 *
 * The numbers are node decorations carrying `data-element-number`, which the
 * stylesheet prints in the left margin while `.show-element-numbers` is on the
 * page. Being decorations they are never part of the document: not saved, not
 * in undo history, not sent to collaborators. A format that numbers nothing
 * gets an empty set and the document is never walked.
 *
 * Recomputed for the whole document on every change, as AvCueDecorations is,
 * because one inserted line renumbers every line below it.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  assignElementNumbers, hasNumbering, type NumberingItem, type NumberingRules,
} from '../../utils/elementNumbers';
import { elementIdOf } from '../../utils/pageBreaks';
import { AV_BLOCK_RULE_ID } from '../../stores/formattingTypes';

export const elementNumbersPluginKey = new PluginKey<DecorationSet>('elementNumbers');

/** Set on a transaction to recompute after something outside the document
 *  changed: the format's numbering, or whether scene numbers are shown. */
export const ELEMENT_NUMBERS_REFRESH = 'elementNumbersRefresh';

export interface ElementNumbersOptions {
  /** The active format's numbered elements. */
  getRules: () => NumberingRules;
  /** Whether scene numbers are shown — the 12.3 style needs them. */
  getSceneNumbersVisible: () => boolean;
}

const DESCEND: ReadonlySet<string> = new Set(['doc', 'dualDialogue', 'dualDialogueColumn']);

/** Every element of the document in reading order, with where it sits. */
function collect(doc: PmNode): Array<{ from: number; to: number; item: NumberingItem }> {
  const out: Array<{ from: number; to: number; item: NumberingItem }> = [];
  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (DESCEND.has(type)) return true;
    if (type === AV_BLOCK_RULE_ID) return false;
    if (!node.isBlock) return false;
    out.push({
      from: pos,
      to: pos + node.nodeSize,
      item: {
        elementId: elementIdOf({ type, attrs: node.attrs }),
        empty: node.textContent.trim() === '',
        sceneNumber: type === 'sceneHeading' ? (node.attrs.sceneNumber as string | null) ?? null : undefined,
      },
    });
    return false;
  });
  return out;
}

/** The decorations for `doc`. Exported for tests. */
export function buildElementNumberDecorations(
  doc: PmNode,
  rules: NumberingRules,
  sceneNumbersVisible: boolean,
): DecorationSet {
  if (!hasNumbering(rules)) return DecorationSet.empty;
  const found = collect(doc);
  const labels = assignElementNumbers(found.map((f) => f.item), rules, { sceneNumbersVisible });
  const decorations: Decoration[] = [];
  found.forEach((f, i) => {
    const label = labels[i];
    if (label != null) decorations.push(Decoration.node(f.from, f.to, { 'data-element-number': label }));
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/** Numbering that cannot be computed must not take the editor down — the
 *  script still renders, just without numbers. */
function safeBuild(state: Pick<EditorState, 'doc'>, opts: ElementNumbersOptions): DecorationSet {
  try {
    return buildElementNumberDecorations(state.doc, opts.getRules(), opts.getSceneNumbersVisible());
  } catch (err) {
    console.warn('[elementNumbers] could not compute element numbers', err);
    return DecorationSet.empty;
  }
}

export const ElementNumbers = Extension.create<ElementNumbersOptions>({
  name: 'elementNumbers',

  addOptions() {
    return { getRules: () => ({}), getSceneNumbersVisible: () => false };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<DecorationSet>({
        key: elementNumbersPluginKey,
        // Plugin state, not `decorations(state)`, so a cursor move does not
        // re-walk the document: the numbers change only with the document or
        // an explicit refresh.
        state: {
          init: (_config, state) => safeBuild(state, opts),
          apply: (tr, value) => {
            if (!tr.docChanged && !tr.getMeta(ELEMENT_NUMBERS_REFRESH)) return value;
            return safeBuild(tr, opts);
          },
        },
        props: {
          decorations(state) {
            return elementNumbersPluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

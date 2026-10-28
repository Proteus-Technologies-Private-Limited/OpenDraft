/**
 * Alternates: other versions of a line kept beside the one in the script.
 *
 * The element's own text is always the version in use, so printing, PDF,
 * Word, Final Draft, Fountain, the page count and every report see exactly
 * one version without knowing alternates exist. The others wait in the
 * element's `alternates` attribute as inline JSON — marks included, so a
 * version keeps its italics, notes and revision marks when it comes back.
 * Being an attribute, they are saved with the script, carried by backups and
 * `.odraft` files, and synced to collaborators like any other attribute.
 *
 * Switching versions swaps the element's text with a stored one, in one
 * transaction, so a single undo puts the previous version back.
 *
 * With versions V0…Vn-1 in the order they were added and Vi showing, the
 * stored list is always the others in cycle order after Vi:
 * [Vi+1, …, Vn-1, V0, …, Vi-1]. Next is its head, previous its tail, and
 * `alternateIndex` (i) is kept only to tell the writer which version this is.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment, type Node as PmNode } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { uuid } from '../utils/uuid';

/** Elements that can hold alternates. Whole scenes are a later step. */
export const ALTERNATE_TYPES = ['action', 'dialogue'] as const;

export interface Alternate {
  id: string;
  /** The version's inline content, as `node.content.toJSON()` gives it. */
  content: JSONContent[];
}

/**
 * The stored versions of an element, whatever was read from a file or a
 * collaborator: anything that is not a version is dropped, so a hand-edited
 * file cannot break the editor.
 */
export function alternatesOf(node: Pick<PmNode, 'attrs'> | null | undefined): Alternate[] {
  const raw = node?.attrs?.alternates;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is Alternate =>
      !!a && typeof a === 'object' && typeof a.id === 'string' && Array.isArray(a.content),
  );
}

/** How many versions an element has, the one showing included. 1 = none stored. */
export function versionCount(node: Pick<PmNode, 'attrs'>): number {
  return alternatesOf(node).length + 1;
}

/** Which version is showing, from 0, in the order they were added. */
export function versionIndex(node: Pick<PmNode, 'attrs'>): number {
  const n = versionCount(node);
  const i = Number(node.attrs?.alternateIndex);
  return Number.isInteger(i) && i >= 0 ? i % n : 0;
}

export function canHoldAlternates(node: PmNode | null | undefined): boolean {
  return !!node && (ALTERNATE_TYPES as readonly string[]).includes(node.type.name);
}

/** The element holding `pos`, if it is one that can have alternates. */
export function alternateTargetAt(state: EditorState, pos: number): { node: PmNode; pos: number } | null {
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (canHoldAlternates(node)) return { node, pos: $pos.before(d) };
  }
  return null;
}

const contentJSON = (node: PmNode): JSONContent[] =>
  (node.content.toJSON() as JSONContent[] | null) ?? [];

/** Put `content` in the element at `pos` and set its version attributes. */
function swapIn(
  state: EditorState,
  target: { node: PmNode; pos: number },
  content: JSONContent[],
  alternates: Alternate[],
  alternateIndex: number,
): Transaction | null {
  let fragment: Fragment;
  try {
    fragment = Fragment.fromJSON(state.schema, content);
  } catch (err) {
    // A version holding a mark or node this build does not know cannot be
    // shown; leave the line as it is rather than lose either version.
    console.warn('[alternates] could not restore a version', err);
    return null;
  }
  const { node, pos } = target;
  const tr = state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    alternates: alternates.length ? alternates : null,
    alternateIndex: alternates.length ? alternateIndex : 0,
  });
  tr.replaceWith(pos + 1, pos + node.nodeSize - 1, fragment);
  return tr;
}

/**
 * Keep the current text as a version and stay on the line to write the next
 * one: the text is selected, so typing replaces it. The new version is the
 * last one.
 */
export function addAlternateTransaction(state: EditorState, pos: number): Transaction | null {
  const target = alternateTargetAt(state, pos);
  if (!target) return null;
  const { node } = target;
  const stored = alternatesOf(node);
  const count = stored.length + 1;
  const index = versionIndex(node);
  // Unroll the cycle back to V0…Vn-1; the new version Vn is the one showing,
  // so the stored list for it is exactly that.
  const split = count - 1 - index;
  const showing: Alternate = { id: uuid(), content: contentJSON(node) };
  const ordered = [...stored.slice(split), showing, ...stored.slice(0, split)];
  const tr = state.tr.setNodeMarkup(target.pos, undefined, {
    ...node.attrs,
    alternates: ordered,
    alternateIndex: count,
  });
  const from = target.pos + 1;
  const to = target.pos + node.nodeSize - 1;
  tr.setSelection(TextSelection.create(tr.doc, from, to));
  return tr;
}

/** Show the next (+1) or previous (-1) version. */
export function cycleAlternateTransaction(state: EditorState, pos: number, direction: 1 | -1): Transaction | null {
  const target = alternateTargetAt(state, pos);
  if (!target) return null;
  const stored = alternatesOf(target.node);
  if (stored.length === 0) return null;
  const current: Alternate = { id: uuid(), content: contentJSON(target.node) };
  const count = stored.length + 1;
  const index = (versionIndex(target.node) + direction + count) % count;
  // The stored list runs from the version after the showing one round to the
  // one before it, so next is its head and previous its tail.
  return direction === 1
    ? swapIn(state, target, stored[0].content, [...stored.slice(1), current], index)
    : swapIn(state, target, stored[stored.length - 1].content, [current, ...stored.slice(0, -1)], index);
}

/** Throw away the version showing and show the next one in its place. */
export function deleteShownAlternateTransaction(state: EditorState, pos: number): Transaction | null {
  const target = alternateTargetAt(state, pos);
  if (!target) return null;
  const stored = alternatesOf(target.node);
  if (stored.length === 0) return null;
  const count = stored.length; // after the delete
  const index = versionIndex(target.node) % count;
  return swapIn(state, target, stored[0].content, stored.slice(1), index);
}

/** Keep the version showing and throw away the others. */
export function keepOnlyShownTransaction(state: EditorState, pos: number): Transaction | null {
  const target = alternateTargetAt(state, pos);
  if (!target || alternatesOf(target.node).length === 0) return null;
  return state.tr.setNodeMarkup(target.pos, undefined, {
    ...target.node.attrs,
    alternates: null,
    alternateIndex: 0,
  });
}

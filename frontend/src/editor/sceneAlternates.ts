/**
 * Scene alternates: other versions of a whole scene, kept beside the one in
 * the script — the scene-sized counterpart of editor/alternates.
 *
 * As with a line, the scene in the document is always the version in use, so
 * printing, every export, the page count and the reports see exactly one
 * version without knowing the others exist. The others are stored on the
 * scene heading, in its `sceneVersions` attribute: each is the scene's
 * top-level nodes as JSON, heading first, marks and attributes included, so a
 * version keeps its notes, tags, revision marks and line alternates when it
 * comes back. Being an attribute, they are saved with the script, carried by
 * backups and `.odraft` files, and synced to collaborators.
 *
 * What makes the scene this scene rather than a version of it stays put on a
 * switch: its number and lock, its plotlines, sequence, colour and bookmark.
 * The synopsis and timing belong to the version, since they describe it.
 *
 * A scene runs from its heading to the next heading or act break — the same
 * extent Omit Scene uses (editor/omitScene). Versions are kept in the same
 * cycle order as a line's: with V0…Vn-1 and Vi showing, the stored list is
 * [Vi+1, …, Vn-1, V0, …, Vi-1], so next is its head and previous its tail.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment, type Node as PmNode } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { uuid } from '../utils/uuid';
import { sceneRangeAt } from './omitScene';

export interface SceneVersion {
  id: string;
  /** The scene's top-level nodes, heading first, as `node.toJSON()` gives them. */
  nodes: JSONContent[];
}

/** Heading attributes that belong to the scene's place in the script, not to a version. */
const SCENE_IDENTITY_ATTRS = ['sceneNumber', 'locked', 'plotlines', 'sequenceId', 'sceneColor', 'bookmark'] as const;

/**
 * The stored versions on a heading, whatever was read from a file or a
 * collaborator: anything that is not a version starting with a heading is
 * dropped, so a hand-edited file cannot break the editor.
 */
export function sceneVersionsOf(heading: Pick<PmNode, 'attrs'> | null | undefined): SceneVersion[] {
  const raw = heading?.attrs?.sceneVersions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is SceneVersion =>
      !!v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray(v.nodes)
      && v.nodes.length > 0 && v.nodes[0]?.type === 'sceneHeading',
  );
}

/** How many versions a scene has, the one showing included. 1 = none stored. */
export function sceneVersionCount(heading: Pick<PmNode, 'attrs'>): number {
  return sceneVersionsOf(heading).length + 1;
}

/** Which version is showing, from 0, in the order they were added. */
export function sceneVersionIndex(heading: Pick<PmNode, 'attrs'>): number {
  const n = sceneVersionCount(heading);
  const i = Number(heading.attrs?.sceneVersionIndex);
  return Number.isInteger(i) && i >= 0 ? i % n : 0;
}

export interface SceneTarget {
  heading: PmNode;
  /** Range of the whole scene in the document, heading included. */
  from: number;
  to: number;
}

/** The scene holding `pos`, if it is one that can have versions. An omitted scene cannot. */
export function sceneAlternateTargetAt(state: EditorState, pos: number): SceneTarget | null {
  const range = sceneRangeAt(state, pos);
  if (!range) return null;
  const heading = state.doc.child(range.headingIndex);
  if (heading.attrs.omitted === true) return null;
  return { heading, from: range.from, to: range.to };
}

/** The scene's nodes as a version: heading first, without the versions themselves. */
function sceneJSON(state: EditorState, target: SceneTarget): JSONContent[] {
  const nodes: JSONContent[] = [];
  state.doc.nodesBetween(target.from, target.to, (node, pos) => {
    if (pos >= target.from && pos < target.to) nodes.push(node.toJSON() as JSONContent);
    return false;
  });
  const head = nodes[0];
  if (head?.attrs) {
    const attrs = { ...head.attrs };
    delete attrs.sceneVersions;
    delete attrs.sceneVersionIndex;
    for (const key of SCENE_IDENTITY_ATTRS) delete attrs[key];
    head.attrs = attrs;
  }
  return nodes;
}

/** Put `version` in place of the scene and set the version attributes on its heading. */
function swapIn(
  state: EditorState,
  target: SceneTarget,
  version: JSONContent[],
  stored: SceneVersion[],
  index: number,
): Transaction | null {
  let fragment: Fragment;
  try {
    fragment = Fragment.fromJSON(state.schema, version);
  } catch (err) {
    // A version holding a node or mark this build does not know cannot be
    // shown; leave the scene as it is rather than lose either version.
    console.warn('[scene alternates] could not restore a version', err);
    return null;
  }
  const first = fragment.firstChild;
  if (!first || first.type.name !== 'sceneHeading') return null;

  const identity: Record<string, unknown> = {};
  for (const key of SCENE_IDENTITY_ATTRS) identity[key] = target.heading.attrs[key];
  const heading = first.type.create(
    {
      ...first.attrs,
      ...identity,
      sceneVersions: stored.length ? stored : null,
      sceneVersionIndex: stored.length ? index : 0,
    },
    first.content,
    first.marks,
  );
  const nodes: PmNode[] = [heading];
  fragment.forEach((node, _offset, i) => { if (i > 0) nodes.push(node); });

  const tr = state.tr.replaceWith(target.from, target.to, Fragment.fromArray(nodes));
  // The caret goes to the start of the heading, where the writer is looking.
  tr.setSelection(TextSelection.create(tr.doc, target.from + 1));
  return tr;
}

/**
 * Keep the scene as it stands as a version, and carry on with a copy of it
 * as the new version — the one now showing, and the last in order.
 */
export function addSceneAlternateTransaction(state: EditorState, pos: number): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target) return null;
  const { heading } = target;
  const stored = sceneVersionsOf(heading);
  const count = stored.length + 1;
  const index = sceneVersionIndex(heading);
  // Unroll the cycle back to V0…Vn-1; the new version Vn is the one showing,
  // so the stored list for it is exactly that.
  const split = count - 1 - index;
  const showing: SceneVersion = { id: uuid(), nodes: sceneJSON(state, target) };
  const ordered = [...stored.slice(split), showing, ...stored.slice(0, split)];
  const tr = state.tr.setNodeMarkup(target.from, undefined, {
    ...heading.attrs,
    sceneVersions: ordered,
    sceneVersionIndex: count,
  });
  tr.setSelection(TextSelection.create(tr.doc, target.from + 1));
  return tr;
}

/** Show the next (+1) or previous (-1) version of the scene. */
export function cycleSceneAlternateTransaction(state: EditorState, pos: number, direction: 1 | -1): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target) return null;
  const stored = sceneVersionsOf(target.heading);
  if (stored.length === 0) return null;
  const current: SceneVersion = { id: uuid(), nodes: sceneJSON(state, target) };
  const count = stored.length + 1;
  const index = (sceneVersionIndex(target.heading) + direction + count) % count;
  return direction === 1
    ? swapIn(state, target, stored[0].nodes, [...stored.slice(1), current], index)
    : swapIn(state, target, stored[stored.length - 1].nodes, [current, ...stored.slice(0, -1)], index);
}

/** Throw away the version of the scene showing and show the next one in its place. */
export function deleteShownSceneAlternateTransaction(state: EditorState, pos: number): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target) return null;
  const stored = sceneVersionsOf(target.heading);
  if (stored.length === 0) return null;
  const count = stored.length; // after the delete
  const index = sceneVersionIndex(target.heading) % count;
  return swapIn(state, target, stored[0].nodes, stored.slice(1), index);
}

/** Keep the version of the scene showing and throw away the others. */
export function keepOnlyShownSceneTransaction(state: EditorState, pos: number): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target || sceneVersionsOf(target.heading).length === 0) return null;
  return state.tr.setNodeMarkup(target.from, undefined, {
    ...target.heading.attrs,
    sceneVersions: null,
    sceneVersionIndex: 0,
  });
}

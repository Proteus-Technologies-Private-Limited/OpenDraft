/**
 * Scene alternates: other versions of a whole scene, kept beside the one in
 * the script — the scene-sized form of editor/alternates.
 *
 * A scene is its heading and everything after it up to the next scene or
 * act/section break (sceneRangeAt in editor/omitScene). The scene in the
 * document is always the version in use, so printing, every export, the page
 * count, statistics, reports, scene numbering and the navigator see exactly
 * one version without knowing alternates exist. The others wait in the
 * heading's `sceneAlternates` attribute as the blocks' JSON — attributes and
 * marks included, so a stored version keeps its line alternates, bookmarks,
 * script note and tag marks and revision marks for when it comes back. Being
 * an attribute, they are saved with the script, carried by backups,
 * recovery snapshots and `.odraft` files, and synced to collaborators.
 *
 * What belongs to a version and what to the scene's place in the script:
 * a version is the heading's text, its synopsis, its timing and its revised
 * flag, and every block after it. Everything else on the heading — above all
 * its scene number, but also its lock, bookmark, page anchors, colour,
 * sequence and plotlines — stays on the heading whichever version shows, so
 * switching never moves a locked number and the navigator does not see a
 * different scene.
 *
 * Switching replaces the scene's blocks with a stored version in one
 * transaction, kept apart from the typing before it in the history, so a
 * single undo puts the previous version back — and only that.
 *
 * The stored list keeps the order editor/alternates documents: with versions
 * V0…Vn-1 and Vi showing it is [Vi+1, …, Vn-1, V0, …, Vi-1], so next is its
 * head and previous its tail; `sceneAlternateIndex` (i) only tells the writer
 * which version this is.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { ALTERNATES_META } from './alternates';
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/core';
import { uuid } from '../utils/uuid';
import { sceneRangeAt } from './omitScene';

export const SCENE_ALTERNATES_ATTR = 'sceneAlternates';
export const SCENE_ALTERNATE_INDEX_ATTR = 'sceneAlternateIndex';

/**
 * The heading attributes that belong to a version. Every other attribute is
 * the scene's — its number, lock, bookmark, page anchors — and stays put.
 * `revised` is Revision Mode's whole-line flag (editor/revisionMarks).
 */
export const SCENE_VERSION_HEADING_ATTRS = ['synopsis', 'timingOverride', 'revised'] as const;

export interface SceneAlternate {
  id: string;
  /** The version's blocks as `node.toJSON()` gives them, its heading first. */
  content: JSONContent[];
}

/** The scene holding `pos`: its heading and the range of its blocks. */
export interface SceneAlternateTarget {
  heading: PmNode;
  /** Position of the heading (before its opening token) — also `from`. */
  headingPos: number;
  from: number;
  to: number;
}

/**
 * The stored versions of a scene, whatever was read from a file or a
 * collaborator: anything that is not a version starting with a scene heading
 * is dropped, so a hand-edited file cannot break the editor.
 */
export function sceneAlternatesOf(node: Pick<PmNode, 'attrs'> | null | undefined): SceneAlternate[] {
  const raw = node?.attrs?.[SCENE_ALTERNATES_ATTR];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is SceneAlternate =>
      !!a && typeof a === 'object' && typeof a.id === 'string'
      && Array.isArray(a.content) && a.content.length > 0
      && a.content[0]?.type === 'sceneHeading',
  );
}

/** How many versions a scene has, the one showing included. 1 = none stored. */
export function sceneVersionCount(node: Pick<PmNode, 'attrs'>): number {
  return sceneAlternatesOf(node).length + 1;
}

/** Which version is showing, from 0, in the order they were added. */
export function sceneVersionIndex(node: Pick<PmNode, 'attrs'>): number {
  const n = sceneVersionCount(node);
  const i = Number(node.attrs?.[SCENE_ALTERNATE_INDEX_ATTR]);
  return Number.isInteger(i) && i >= 0 ? i % n : 0;
}

/**
 * The scene holding `pos`, if it can have alternates. Not an omitted scene:
 * it is a placeholder for a number, with nothing in it to have versions of.
 */
export function sceneAlternateTargetAt(state: EditorState, pos: number): SceneAlternateTarget | null {
  const range = sceneRangeAt(state, pos);
  if (!range) return null;
  const heading = state.doc.child(range.headingIndex);
  if (heading.attrs.omitted === true) return null;
  return { heading, headingPos: range.from, from: range.from, to: range.to };
}

/** The heading's attributes that a version carries. */
function versionHeadingAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SCENE_VERSION_HEADING_ATTRS) if (key in attrs) out[key] = attrs[key];
  return out;
}

/** The scene showing now, as a version to store. */
function captureScene(state: EditorState, target: SceneAlternateTarget): SceneAlternate {
  const content: JSONContent[] = [];
  state.doc.nodesBetween(target.from, target.to, (node, pos) => {
    if (pos === target.headingPos) {
      const json = node.toJSON() as JSONContent;
      content.push({ ...json, attrs: versionHeadingAttrs(node.attrs) });
    } else {
      content.push(node.toJSON() as JSONContent);
    }
    return false;
  });
  return { id: uuid(), content };
}

/** Bookmark names held by elements outside `from`–`to`, lower-cased. */
function bookmarksOutside(doc: PmNode, from: number, to: number): Set<string> {
  const taken = new Set<string>();
  doc.descendants((node, pos) => {
    if (pos >= from && pos < to) return false;
    const name = node.attrs?.bookmark;
    if (typeof name === 'string' && name) taken.add(name.toLowerCase());
    return !node.isTextblock;
  });
  return taken;
}

/**
 * A stored version's blocks without the bookmarks another scene took while it
 * was put away. The bookmark plugin would clear one of the two anyway, and
 * might clear the one the writer has been using since.
 */
function withoutTakenBookmarks(content: JSONContent[], taken: Set<string>): JSONContent[] {
  if (!taken.size) return content;
  const strip = (node: JSONContent): JSONContent => {
    let next = node;
    const name = node.attrs?.bookmark;
    if (typeof name === 'string' && taken.has(name.toLowerCase())) {
      next = { ...node, attrs: { ...node.attrs, bookmark: null } };
    }
    return next.content ? { ...next, content: next.content.map(strip) } : next;
  };
  return content.map(strip);
}

/**
 * Put the version `content` in place of the scene, with `alternates` stored
 * on its heading. Null when the version cannot be shown.
 */
function swapIn(
  state: EditorState,
  target: SceneAlternateTarget,
  content: JSONContent[],
  alternates: SceneAlternate[],
  index: number,
): Transaction | null {
  let blocks: PmNode[];
  try {
    const incoming = withoutTakenBookmarks(content, bookmarksOutside(state.doc, target.from, target.to));
    const [headingJSON, ...body] = incoming;
    // The scene's own attributes, then the version's, then the versions.
    const headingAttrs: Record<string, unknown> = { ...target.heading.attrs };
    for (const key of SCENE_VERSION_HEADING_ATTRS) {
      headingAttrs[key] = headingJSON.attrs && key in headingJSON.attrs
        ? headingJSON.attrs[key]
        : state.schema.nodes.sceneHeading.spec.attrs?.[key]?.default ?? null;
    }
    headingAttrs[SCENE_ALTERNATES_ATTR] = alternates.length ? alternates : null;
    headingAttrs[SCENE_ALTERNATE_INDEX_ATTR] = alternates.length ? index : 0;
    blocks = [
      state.schema.nodeFromJSON({ ...headingJSON, attrs: headingAttrs }),
      ...body.map((b) => state.schema.nodeFromJSON(b)),
    ];
    // A version holding blocks that cannot sit at the top level here, or
    // content its blocks do not allow, is not shown — nodeFromJSON alone
    // does not check either.
    if (!state.doc.type.contentMatch.matchFragment(Fragment.fromArray(blocks))) {
      throw new Error('the version holds blocks that cannot sit in the script');
    }
    for (const b of blocks) b.check();
  } catch (err) {
    // Leave the scene as it is rather than lose either version.
    console.warn('[sceneAlternates] could not restore a scene version', err);
    return null;
  }
  const tr = closeHistory(state.tr.replaceWith(target.from, target.to, Fragment.fromArray(blocks)));
  // A caret inside the scene would land wherever the replace mapped it; put
  // it at the start of the heading so the writer is still in this scene.
  const sel = state.selection;
  if (sel.from >= target.from && sel.to <= target.to) {
    tr.setSelection(TextSelection.create(tr.doc, target.from + 1));
  }
  return tr.setMeta(ALTERNATES_META, true);
}

/**
 * Keep the scene as it stands as a version and go on writing the next one:
 * the scene stays where it is, and the copy in the script is now the new,
 * last version.
 */
export function addSceneAlternateTransaction(state: EditorState, pos: number): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target) return null;
  const stored = sceneAlternatesOf(target.heading);
  const count = stored.length + 1;
  const index = sceneVersionIndex(target.heading);
  // Unroll the cycle back to V0…Vn-1; the new version Vn is the one showing,
  // so the stored list for it is exactly that.
  const split = count - 1 - index;
  const ordered = [...stored.slice(split), captureScene(state, target), ...stored.slice(0, split)];
  const tr = closeHistory(state.tr).setNodeMarkup(target.headingPos, undefined, {
    ...target.heading.attrs,
    [SCENE_ALTERNATES_ATTR]: ordered,
    [SCENE_ALTERNATE_INDEX_ATTR]: count,
  });
  const sel = state.selection;
  if (!(sel.from >= target.from && sel.to <= target.to)) {
    tr.setSelection(TextSelection.create(tr.doc, target.from + 1));
  }
  return tr.setMeta(ALTERNATES_META, true).scrollIntoView();
}

/** Show the scene's next (+1) or previous (-1) version. */
export function cycleSceneAlternateTransaction(state: EditorState, pos: number, direction: 1 | -1): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target) return null;
  const stored = sceneAlternatesOf(target.heading);
  if (stored.length === 0) return null;
  const current = captureScene(state, target);
  const count = stored.length + 1;
  const index = (sceneVersionIndex(target.heading) + direction + count) % count;
  return direction === 1
    ? swapIn(state, target, stored[0].content, [...stored.slice(1), current], index)
    : swapIn(state, target, stored[stored.length - 1].content, [current, ...stored.slice(0, -1)], index);
}

/** Throw away the scene version showing and show the next one in its place. */
export function deleteShownSceneAlternateTransaction(state: EditorState, pos: number): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target) return null;
  const stored = sceneAlternatesOf(target.heading);
  if (stored.length === 0) return null;
  const count = stored.length; // after the delete
  const index = sceneVersionIndex(target.heading) % count;
  return swapIn(state, target, stored[0].content, stored.slice(1), index);
}

/** Keep the scene version showing and throw away the others. */
export function keepOnlyShownSceneTransaction(state: EditorState, pos: number): Transaction | null {
  const target = sceneAlternateTargetAt(state, pos);
  if (!target || sceneAlternatesOf(target.heading).length === 0) return null;
  return closeHistory(state.tr).setNodeMarkup(target.headingPos, undefined, {
    ...target.heading.attrs,
    [SCENE_ALTERNATES_ATTR]: null,
    [SCENE_ALTERNATE_INDEX_ATTR]: 0,
  }).setMeta(ALTERNATES_META, true);
}

/**
 * Positions of headings holding a copy of versions an earlier heading holds.
 *
 * Enter in the middle of a heading copies every attribute to both halves
 * (keepOnSplit only covers a split at the end), which would give two scenes
 * the same stored versions. The earlier heading is the original, as with
 * scene numbers (utils/sceneNumbers), so the later copies lose theirs.
 */
export function duplicateSceneAlternates(doc: PmNode): number[] {
  const seen = new Set<string>();
  const extra: number[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'sceneHeading') return;
    const ids = sceneAlternatesOf(node).map((a) => a.id);
    if (!ids.length) return;
    if (ids.some((id) => seen.has(id))) extra.push(offset);
    else ids.forEach((id) => seen.add(id));
  });
  return extra;
}

/**
 * A pasted slice whose scene versions have new ids: a copied scene is a new
 * scene with versions of its own, not a duplicate to be cleared.
 */
export function freshSceneAlternateIds(slice: Slice): Slice {
  const refresh = (fragment: Fragment): Fragment => {
    const nodes: PmNode[] = [];
    fragment.forEach((node) => {
      let next = node;
      const stored = sceneAlternatesOf(node);
      if (stored.length) {
        next = node.type.create(
          { ...node.attrs, [SCENE_ALTERNATES_ATTR]: stored.map((a) => ({ ...a, id: uuid() })) },
          node.content,
          node.marks,
        );
      } else if (!node.isTextblock && node.content.size) {
        next = node.copy(refresh(node.content));
      }
      nodes.push(next);
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(refresh(slice.content), slice.openStart, slice.openEnd);
}

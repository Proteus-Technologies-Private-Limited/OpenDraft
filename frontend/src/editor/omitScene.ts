/**
 * Omit Scene — cut a scene from a script whose scene numbers are locked.
 *
 * A production schedule is built on scene numbers, so a cut scene cannot just
 * vanish: scene 13 would leave a gap nobody can tell from a mistake. Instead
 * its heading stays, keeping its number, and reads OMITTED; everything under
 * it goes. It is one undoable edit, and in Revision Mode it is marked like any
 * other.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';

export const OMITTED_TEXT = 'OMITTED';

/** Elements that end a scene: the next scene, and the structure around it. */
const SCENE_BOUNDARIES = new Set(['sceneHeading', 'newAct', 'endOfAct', 'section', 'showEpisode']);

/** The top-level range of the scene holding `pos`, or null outside a scene. */
export function sceneRangeAt(state: EditorState, pos: number): { from: number; to: number; headingIndex: number } | null {
  const { doc } = state;
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  const at = $pos.depth > 0 ? $pos.index(0) : Math.min($pos.index(0), doc.childCount - 1);
  let headingIndex = -1;
  for (let i = at; i >= 0; i--) {
    const type = doc.child(i).type.name;
    if (type === 'sceneHeading') { headingIndex = i; break; }
    if (i !== at && SCENE_BOUNDARIES.has(type)) break;
  }
  if (headingIndex < 0) return null;
  let from = 0;
  for (let i = 0; i < headingIndex; i++) from += doc.child(i).nodeSize;
  let to = from + doc.child(headingIndex).nodeSize;
  for (let i = headingIndex + 1; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (SCENE_BOUNDARIES.has(child.type.name)) break;
    to += child.nodeSize;
  }
  return { from, to, headingIndex };
}

/** True when the scene at `pos` is already omitted. */
export function sceneOmittedAt(state: EditorState, pos: number): boolean {
  const range = sceneRangeAt(state, pos);
  return !!range && state.doc.child(range.headingIndex).attrs.omitted === true;
}

/**
 * The transaction that omits the scene at `pos`, or null when there is no
 * scene there. The heading keeps every attribute — its number above all.
 */
export function omitSceneTransaction(state: EditorState, pos: number): Transaction | null {
  const range = sceneRangeAt(state, pos);
  if (!range) return null;
  const heading = state.doc.child(range.headingIndex);
  const omitted = heading.type.create(
    { ...heading.attrs, omitted: true, synopsis: '', timingOverride: null },
    state.schema.text(OMITTED_TEXT),
  );
  return state.tr.replaceWith(range.from, range.to, omitted).scrollIntoView();
}

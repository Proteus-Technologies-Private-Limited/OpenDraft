/**
 * Linking Beat Board beats to the scenes that play them.
 *
 * A beat lists the scenes it is linked to (`BeatInfo.sceneIds`) by the scene
 * heading's `sceneUid` attribute: a stable id given to a heading the first
 * time a beat links to it, and kept through edits to the heading, moving the
 * scene and renumbering, because it is part of the heading rather than a
 * position or a number. It reaches collaborators the way any edit does.
 *
 * A scene that is deleted leaves its id behind in the beats that linked to
 * it. The beat keeps it and shows it as a missing scene, so undoing the
 * deletion brings the link back; the writer can remove a missing one by hand.
 *
 * Copies of a heading share its id — a split in the middle of the line copies
 * every attribute, and so does copy and paste. The id belongs to the first
 * scene that has it; a later copy reads as having none and gets a new one if
 * something links to it. Pasting a copy of a scene whose id is still in the
 * script drops the id from the copy (`sceneUidPastePlugin`).
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model';
import { uuid } from './uuid';

export const SCENE_UID_ATTR = 'sceneUid';

/** The stable id a scene heading carries, if it has been given one. */
export function sceneUidOf(attrs: Record<string, unknown> | null | undefined): string | null {
  const raw = attrs?.[SCENE_UID_ATTR];
  return typeof raw === 'string' && raw ? raw : null;
}

/** A scene as a beat can link to it. */
export interface LinkableScene {
  /** Position of the scene heading in the document. */
  pos: number;
  index: number;
  /** The printed scene number, or the scene's place when it has none. */
  number: string;
  heading: string;
  /** Its stable id; null until something links to it, and on a copy. */
  uid: string | null;
}

/**
 * The script's scenes — top-level scene headings with text, as the Story
 * Timeline and the timing engine count them — with their ids, each id only on
 * the first scene that has it.
 */
export function linkableScenes(doc: PmNode): LinkableScene[] {
  const out: LinkableScene[] = [];
  const seen = new Set<string>();
  doc.forEach((node, offset) => {
    if (node.type.name !== 'sceneHeading' || !node.textContent.trim()) return;
    const index = out.length;
    let uid = sceneUidOf(node.attrs);
    if (uid && seen.has(uid)) uid = null;
    if (uid) seen.add(uid);
    out.push({
      pos: offset,
      index,
      number: node.attrs.sceneNumber != null && String(node.attrs.sceneNumber).trim()
        ? String(node.attrs.sceneNumber)
        : String(index + 1),
      heading: node.textContent.trim(),
      uid,
    });
  });
  return out;
}

/**
 * The scene heading at `pos`'s stable id, giving it one when it has none (or
 * shares a copy's). The transaction is null when nothing needs writing; it is
 * kept out of undo history, so undoing the writer's last edit does not cut
 * the link it was given for.
 */
export function ensureSceneUid(state: EditorState, pos: number): { uid: string; tr: Transaction | null } | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'sceneHeading') return null;
  const current = sceneUidOf(node.attrs);
  if (current && linkableScenes(state.doc).some((s) => s.pos === pos && s.uid === current)) {
    return { uid: current, tr: null };
  }
  const uid = uuid();
  const tr = state.tr.setNodeAttribute(pos, SCENE_UID_ATTR, uid).setMeta('addToHistory', false);
  return { uid, tr };
}

/** The scene ids a beat links to, whatever a file or collaborator sent. */
export function beatSceneIds(beat: { sceneIds?: unknown } | null | undefined): string[] {
  const raw = beat?.sceneIds;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && !!x))];
}

/** A beat's links with this scene added, or taken away if it was there. */
export function toggleBeatScene(beat: { sceneIds?: unknown }, uid: string): string[] {
  const ids = beatSceneIds(beat);
  return ids.includes(uid) ? ids.filter((x) => x !== uid) : [...ids, uid];
}

/**
 * A beat's links as scenes, in script order, and the ids of those whose scene
 * is no longer in the script.
 */
export function resolveBeatScenes(
  beat: { sceneIds?: unknown },
  scenes: readonly LinkableScene[],
): { linked: LinkableScene[]; missing: string[] } {
  const ids = beatSceneIds(beat);
  if (ids.length === 0) return { linked: [], missing: [] };
  const wanted = new Set(ids);
  const linked = scenes.filter((s) => s.uid && wanted.has(s.uid));
  const found = new Set(linked.map((s) => s.uid));
  return { linked, missing: ids.filter((id) => !found.has(id)) };
}

/** The beats linked to each scene, by scene id, in Beat Board order. */
export function beatsByScene<B extends { sceneIds?: unknown }>(beats: readonly B[]): Map<string, B[]> {
  const out = new Map<string, B[]>();
  for (const b of beats) {
    for (const id of beatSceneIds(b)) {
      const list = out.get(id);
      if (list) list.push(b);
      else out.set(id, [b]);
    }
  }
  return out;
}

/** Where the scene with this id is now, or null when it is gone. */
export function findSceneByUid(doc: PmNode, uid: string): LinkableScene | null {
  return linkableScenes(doc).find((s) => s.uid === uid) ?? null;
}

// ── Pasting a copy of a scene ───────────────────────────────────────────────

/** Scene headings in pasted content lose an id the script already has. */
export function dropTakenSceneUids(content: Fragment, taken: ReadonlySet<string>): Fragment {
  let changed = false;
  const nodes: PmNode[] = [];
  content.forEach((node) => {
    let next = node;
    const uid = node.type.name === 'sceneHeading' ? sceneUidOf(node.attrs) : null;
    if (uid && taken.has(uid)) {
      next = node.type.create({ ...node.attrs, [SCENE_UID_ATTR]: null }, node.content, node.marks);
    } else if (node.childCount) {
      const inner = dropTakenSceneUids(node.content, taken);
      if (inner !== node.content) next = node.copy(inner);
    }
    if (next !== node) changed = true;
    nodes.push(next);
  });
  return changed ? Fragment.fromArray(nodes) : content;
}

const sceneUidPasteKey = new PluginKey('sceneUidPaste');

/**
 * A pasted copy of a scene starts without its original's id, so a beat linked
 * to the original stays with it. A scene moved by cut and paste keeps its id
 * — the original is gone by then — and so does one dragged within the script.
 */
export function sceneUidPastePlugin(): Plugin {
  return new Plugin({
    key: sceneUidPasteKey,
    props: {
      transformPasted: (slice, view) => {
        if (view.dragging?.move) return slice;
        const taken = new Set<string>();
        view.state.doc.forEach((node) => {
          const uid = node.type.name === 'sceneHeading' ? sceneUidOf(node.attrs) : null;
          if (uid) taken.add(uid);
        });
        if (taken.size === 0) return slice;
        const content = dropTakenSceneUids(slice.content, taken);
        return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
      },
    },
  });
}

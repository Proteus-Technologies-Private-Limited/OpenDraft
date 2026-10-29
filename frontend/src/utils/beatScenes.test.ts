import { describe, it, expect, beforeEach } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { Fragment } from '@tiptap/pm/model';
import { getAttributesFromExtensions, getSplittedAttributes } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { testSchema, testExtensions, block, doc } from '../test/screenplaySchema';
import {
  SCENE_UID_ATTR,
  beatSceneIds,
  beatsByScene,
  dropTakenSceneUids,
  ensureSceneUid,
  findSceneByUid,
  linkableScenes,
  resolveBeatScenes,
  sceneUidOf,
  toggleBeatScene,
} from './beatScenes';
import { useEditorStore, type BeatInfo } from '../stores/editorStore';
import { buildSaveContent, stripSaveMetadata } from './saveContent';
import { hydrateEditorStoresFromContent } from './hydrateStores';

const heading = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ ...block('sceneHeading', text), attrs });

function script() {
  return EditorState.create({
    schema: testSchema,
    doc: testSchema.nodeFromJSON(doc(
      block('action', 'FADE IN:'),
      heading('INT. KITCHEN - NIGHT', { sceneNumber: '1' }),
      block('action', 'Maya waits.'),
      { type: 'sceneHeading', content: [] }, // an empty heading is no scene
      heading('EXT. ROOF - DAY', { sceneNumber: '2' }),
      block('dialogue', 'Now.'),
      heading('INT. CAR - NIGHT', { sceneNumber: '3' }),
      block('action', 'They drive.'),
    )),
  });
}

const beat = (id: string, sceneIds?: unknown): BeatInfo => ({
  id, title: id, description: '', columnId: 'c', position: 0, color: '', imageUrl: '',
  cardWidth: 0, cardHeight: 0, x: 0, y: 0, imageHeight: 0,
  ...(sceneIds !== undefined ? { sceneIds: sceneIds as string[] } : {}),
});

/** Give the nth scene an id, as linking a beat to it does. */
function link(s: EditorState, n: number): { state: EditorState; uid: string } {
  const given = ensureSceneUid(s, linkableScenes(s.doc)[n].pos)!;
  return { state: given.tr ? s.apply(given.tr) : s, uid: given.uid };
}

/** Move the scene starting at child `from` (with its body, `size` blocks) to the end, as scene reordering does. */
function moveSceneToEnd(s: EditorState, fromChild: number, size: number): EditorState {
  let start = 0;
  for (let i = 0; i < fromChild; i++) start += s.doc.child(i).nodeSize;
  let end = start;
  for (let i = fromChild; i < fromChild + size; i++) end += s.doc.child(i).nodeSize;
  const slice = s.doc.slice(start, end);
  const tr = s.tr.delete(start, end);
  tr.insert(tr.doc.content.size, slice.content);
  return s.apply(tr);
}

describe('scene ids', () => {
  it('lists the scenes with text, none with an id until something links to one', () => {
    const scenes = linkableScenes(script().doc);
    expect(scenes.map((s) => [s.number, s.heading, s.uid])).toEqual([
      ['1', 'INT. KITCHEN - NIGHT', null],
      ['2', 'EXT. ROOF - DAY', null],
      ['3', 'INT. CAR - NIGHT', null],
    ]);
  });

  it('gives a scene an id once, outside undo history', () => {
    const s = script();
    const pos = linkableScenes(s.doc)[1].pos;
    const first = ensureSceneUid(s, pos)!;
    expect(first.tr).not.toBeNull();
    expect(first.tr!.getMeta('addToHistory')).toBe(false);
    const after = s.apply(first.tr!);
    expect(sceneUidOf(after.doc.nodeAt(pos)!.attrs)).toBe(first.uid);
    expect(ensureSceneUid(after, pos)).toEqual({ uid: first.uid, tr: null });
    expect(ensureSceneUid(after, 0)).toBeNull(); // not a scene heading
  });

  it('is not carried onto a heading split off with Enter', () => {
    const carried = getSplittedAttributes(
      getAttributesFromExtensions(testExtensions), 'sceneHeading', { [SCENE_UID_ATTR]: 'x', sceneNumber: '1' },
    );
    expect(carried).not.toHaveProperty(SCENE_UID_ATTR);
  });

  it('belongs to the first scene that has it; a copy gets its own when linked', () => {
    const s = EditorState.create({
      schema: testSchema,
      doc: testSchema.nodeFromJSON(doc(
        heading('INT. KITCHEN - NIGHT', { sceneUid: 'k' }),
        heading('INT. KITCHEN - NIGHT', { sceneUid: 'k' }),
      )),
    });
    expect(linkableScenes(s.doc).map((x) => x.uid)).toEqual(['k', null]);
    const copy = ensureSceneUid(s, linkableScenes(s.doc)[1].pos)!;
    expect(copy.uid).not.toBe('k');
    expect(linkableScenes(s.apply(copy.tr!).doc).map((x) => x.uid)).toEqual(['k', copy.uid]);
  });

  it('drops an id the script already has from pasted scenes, keeping the rest', () => {
    const pasted = Fragment.fromArray([
      testSchema.nodeFromJSON(heading('INT. A', { sceneUid: 'taken' })),
      testSchema.nodeFromJSON(heading('INT. B', { sceneUid: 'free' })),
      testSchema.nodeFromJSON(block('action', 'x')),
    ]);
    const out = dropTakenSceneUids(pasted, new Set(['taken']));
    expect([0, 1].map((i) => sceneUidOf(out.child(i).attrs))).toEqual([null, 'free']);
    expect(out.child(0).textContent).toBe('INT. A');
    expect(dropTakenSceneUids(pasted, new Set(['other']))).toBe(pasted);
  });
});

describe('a beat linked to a scene', () => {
  it('stays linked through edits to the heading, renumbering and new scenes before it', () => {
    const { state, uid } = link(script(), 1);
    // Retype the heading and renumber it.
    const pos = findSceneByUid(state.doc, uid)!.pos;
    let s = state.apply(state.tr.insertText('EXT. ROOFTOP - DAWN', pos + 1, pos + 1 + 'EXT. ROOF - DAY'.length));
    s = s.apply(s.tr.setNodeAttribute(pos, 'sceneNumber', '7A'));
    // A new scene at the top pushes every position down.
    s = s.apply(s.tr.insert(0, testSchema.nodeFromJSON(heading('INT. HALL - DAY'))));
    const found = findSceneByUid(s.doc, uid)!;
    expect([found.number, found.heading, found.index]).toEqual(['7A', 'EXT. ROOFTOP - DAWN', 2]);
    expect(resolveBeatScenes(beat('b', [uid]), linkableScenes(s.doc))).toEqual({ linked: [found], missing: [] });
  });

  it('stays linked when the scene is moved', () => {
    const { state, uid } = link(script(), 0);
    // Children 1-2 are the kitchen scene: heading and its action.
    const moved = moveSceneToEnd(state, 1, 2);
    const scenes = linkableScenes(moved.doc);
    expect(scenes.map((x) => x.heading)).toEqual(['EXT. ROOF - DAY', 'INT. CAR - NIGHT', 'INT. KITCHEN - NIGHT']);
    expect(resolveBeatScenes(beat('b', [uid]), scenes).linked.map((x) => x.heading)).toEqual(['INT. KITCHEN - NIGHT']);
  });

  it('keeps the beat when its scene is deleted, flags the link, and finds it again after undo', () => {
    const { state, uid } = link(script(), 2);
    const scene = findSceneByUid(state.doc, uid)!;
    const node = state.doc.nodeAt(scene.pos)!;
    const deleted = state.apply(state.tr.delete(scene.pos, scene.pos + node.nodeSize));
    const b = beat('b', [uid]);
    expect(resolveBeatScenes(b, linkableScenes(deleted.doc))).toEqual({ linked: [], missing: [uid] });
    // Putting the heading back, as undo does, restores the link.
    const restored = deleted.apply(deleted.tr.insert(scene.pos, node));
    expect(resolveBeatScenes(b, linkableScenes(restored.doc)).linked.map((x) => x.heading)).toEqual(['INT. CAR - NIGHT']);
  });

  it('lists linked scenes in script order', () => {
    const first = link(script(), 2);
    const second = link(first.state, 0);
    const r = resolveBeatScenes(beat('b', [first.uid, second.uid]), linkableScenes(second.state.doc));
    expect(r.linked.map((x) => x.heading)).toEqual(['INT. KITCHEN - NIGHT', 'INT. CAR - NIGHT']);
  });

  it('reads links from a file or collaborator defensively, and toggles them', () => {
    expect(beatSceneIds(beat('b', ['a', 7, '', 'a', 'c']))).toEqual(['a', 'c']);
    expect(beatSceneIds(beat('b', 'nope'))).toEqual([]);
    expect(beatSceneIds(beat('b'))).toEqual([]);
    expect(toggleBeatScene(beat('b', ['a']), 'c')).toEqual(['a', 'c']);
    expect(toggleBeatScene(beat('b', ['a', 'c']), 'a')).toEqual(['c']);
  });

  it('groups beats by scene for the timeline', () => {
    const map = beatsByScene([beat('one', ['s1', 's2']), beat('two', ['s2']), beat('three')]);
    expect([...map.entries()].map(([k, v]) => [k, v.map((b) => b.id)])).toEqual([['s1', ['one']], ['s2', ['one', 'two']]]);
  });
});

describe('saving and restoring links', () => {
  beforeEach(() => {
    useEditorStore.setState({ beats: [] });
  });

  it('survive a save and a restore (the recovery snapshot is the same payload)', () => {
    const { state, uid } = link(script(), 1);
    useEditorStore.getState().setBeats([beat('b', [uid])]);
    const fakeEditor = { isDestroyed: false, getJSON: () => state.doc.toJSON() } as unknown as Editor;
    const saved = JSON.parse(JSON.stringify(buildSaveContent(fakeEditor)));

    useEditorStore.setState({ beats: [] });
    const { pmDoc } = stripSaveMetadata(saved);
    hydrateEditorStoresFromContent(saved);
    const reloaded = testSchema.nodeFromJSON(pmDoc);
    const restoredBeat = useEditorStore.getState().beats[0];
    expect(beatSceneIds(restoredBeat)).toEqual([uid]);
    expect(resolveBeatScenes(restoredBeat, linkableScenes(reloaded)).linked.map((x) => x.heading)).toEqual(['EXT. ROOF - DAY']);
  });

  it('can be removed from a beat by hand', () => {
    useEditorStore.getState().setBeats([beat('b', ['gone', 'kept'])]);
    useEditorStore.getState().updateBeat('b', { sceneIds: ['kept'] });
    expect(useEditorStore.getState().beats[0].sceneIds).toEqual(['kept']);
  });
});

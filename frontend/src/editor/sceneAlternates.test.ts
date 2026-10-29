import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { Slice, Fragment } from '@tiptap/pm/model';
import { getAttributesFromExtensions, getSchema, getSplittedAttributes } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { testSchema, testExtensions, block, doc, marked } from '../test/screenplaySchema';
import {
  addSceneAlternateTransaction,
  cycleSceneAlternateTransaction,
  deleteShownSceneAlternateTransaction,
  duplicateSceneAlternates,
  freshSceneAlternateIds,
  keepOnlyShownSceneTransaction,
  sceneAlternateTargetAt,
  sceneAlternatesOf,
  sceneVersionCount,
  sceneVersionIndex,
} from './sceneAlternates';
import { addAlternateTransaction, alternatesOf, cycleAlternateTransaction, versionIndex } from './alternates';
import { omitSceneTransaction } from './omitScene';
import { buildAlternateDecorations, dedupeSceneAlternates } from './extensions/Alternates';
import { listBookmarks } from '../utils/bookmarks';
import { assignSceneNumbers } from '../utils/sceneNumbers';
import { exportFountain } from '../utils/fountainExporter';
import { exportFDX } from '../utils/fdxExporter';

function stateOf(...blocks: JSONContent[]) {
  return EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(...blocks)), plugins: [history()] });
}

/** A position inside the top-level block at `index`. */
function inside(s: EditorState, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return pos + 1;
}

/** Replace the text of the top-level block at `index`, as typing would. */
function retype(s: EditorState, index: number, text: string): EditorState {
  const from = inside(s, index);
  const to = from + s.doc.child(index).content.size;
  return s.apply(s.tr.insertText(text, from, to));
}

/** The text of every top-level block, joined, to compare whole documents. */
const texts = (s: EditorState) => {
  const out: string[] = [];
  s.doc.forEach((n) => out.push(n.textContent));
  return out;
};

const heading = (text: string, attrs: Record<string, unknown> = {}): JSONContent =>
  ({ ...block('sceneHeading', text), attrs });

/**
 * Three scenes; the middle one (blocks 2–4) is the one given versions. Scene
 * numbers are set as a locked script carries them.
 */
function script(): EditorState {
  return stateOf(
    heading('INT. HALL - DAY', { sceneNumber: '1' }),
    block('action', 'Rain.'),
    heading('INT. KITCHEN - NIGHT', { sceneNumber: '2', synopsis: 'Maya returns.' }),
    block('character', 'MAYA'),
    block('dialogue', 'You came back.'),
    heading('EXT. ROAD - DAY', { sceneNumber: '3' }),
    block('action', 'A car.'),
  );
}

/** The middle scene with versions A (as written), B and C, showing C. */
function threeSceneVersions(): EditorState {
  let s = script();
  s = s.apply(addSceneAlternateTransaction(s, inside(s, 3))!);
  s = retype(retype(s, 2, 'INT. KITCHEN - DAY'), 4, 'Version B.');
  s = s.apply(addSceneAlternateTransaction(s, inside(s, 4))!);
  s = retype(retype(s, 2, 'EXT. GARDEN - DAY'), 4, 'Version C.');
  return s;
}

const middle = (s: EditorState) => s.doc.child(2);

describe('finding the scene', () => {
  it('is the scene holding the caret, from its heading or any line in it', () => {
    const s = script();
    for (const i of [2, 3, 4]) {
      const t = sceneAlternateTargetAt(s, inside(s, i))!;
      expect(t.heading.textContent).toBe('INT. KITCHEN - NIGHT');
      expect(s.doc.slice(t.from, t.to).content.childCount).toBe(3);
    }
  });

  it('is nothing before the first scene, or in an omitted one', () => {
    const s = stateOf(block('action', 'Cold open.'), heading('INT. ROOM - DAY'), block('action', 'x'));
    expect(sceneAlternateTargetAt(s, inside(s, 0))).toBeNull();
    const omitted = s.apply(omitSceneTransaction(s, inside(s, 1))!);
    expect(sceneAlternateTargetAt(omitted, inside(omitted, 1))).toBeNull();
    expect(addSceneAlternateTransaction(omitted, inside(omitted, 1))).toBeNull();
  });
});

describe('adding scene alternates', () => {
  it('keeps the scene as a version and leaves the copy in the script to write on', () => {
    let s = script();
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, inside(s, 4) + 2)));
    const next = s.apply(addSceneAlternateTransaction(s, inside(s, 4))!);
    expect(texts(next)).toEqual(texts(s));
    expect(sceneVersionCount(middle(next))).toBe(2);
    expect(sceneVersionIndex(middle(next))).toBe(1);
    const stored = sceneAlternatesOf(middle(next))[0];
    expect(stored.content.map((b) => b.type)).toEqual(['sceneHeading', 'character', 'dialogue']);
    // The stored heading carries only what belongs to a version.
    expect(stored.content[0].attrs).toEqual({ synopsis: 'Maya returns.', timingOverride: null });
    expect(next.selection.from).toBe(inside(s, 4) + 2); // the caret stays where it was
  });

  it('brings a caret from outside the scene to its heading', () => {
    const s = script(); // caret at the start of the script
    const next = s.apply(addSceneAlternateTransaction(s, inside(s, 4))!);
    expect(next.selection.from).toBe(inside(s, 2));
  });

  it('works from the heading too', () => {
    const s = script();
    const next = s.apply(addSceneAlternateTransaction(s, inside(s, 2))!);
    expect(sceneVersionCount(middle(next))).toBe(2);
  });
});

describe('switching scene versions', () => {
  it('steps forward and back through every version in the order they were added', () => {
    let s = threeSceneVersions();
    expect([texts(s)[2], sceneVersionIndex(middle(s)) + 1, sceneVersionCount(middle(s))]).toEqual(['EXT. GARDEN - DAY', 3, 3]);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!);
      seen.push(`${texts(s)[2]}|${texts(s)[4]}:${sceneVersionIndex(middle(s)) + 1}`);
    }
    expect(seen).toEqual([
      'INT. KITCHEN - NIGHT|You came back.:1',
      'INT. KITCHEN - DAY|Version B.:2',
      'EXT. GARDEN - DAY|Version C.:3',
    ]);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 3), -1)!);
    expect(texts(s)[4]).toBe('Version B.');
    expect(sceneVersionIndex(middle(s))).toBe(1);
  });

  it('replaces the whole scene, whatever its length, and nothing around it', () => {
    let s = script();
    s = s.apply(addSceneAlternateTransaction(s, inside(s, 2))!);
    // The new version gets two more lines.
    s = s.apply(s.tr.insert(s.doc.child(0).nodeSize + s.doc.child(1).nodeSize + middle(s).nodeSize
      + s.doc.child(3).nodeSize + s.doc.child(4).nodeSize,
    [testSchema.nodeFromJSON(block('action', 'She sits.')), testSchema.nodeFromJSON(block('action', 'Silence.'))]));
    expect(texts(s)).toHaveLength(9);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 6), 1)!);
    expect(texts(s)).toEqual(texts(script()));
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!);
    expect(texts(s).slice(5, 7)).toEqual(['She sits.', 'Silence.']);
    expect(texts(s)[7]).toBe('EXT. ROAD - DAY');
  });

  it('puts a caret that was in the scene at the start of its heading', () => {
    let s = threeSceneVersions();
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, inside(s, 4) + 3)));
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 4), 1)!);
    expect(s.selection.from).toBe(inside(s, 2));
  });

  it('keeps each version its synopsis, and the scene its number, lock and bookmark', () => {
    let s = script();
    const h = inside(s, 2) - 1;
    s = s.apply(s.tr.setNodeMarkup(h, undefined, { ...middle(s).attrs, locked: true, bookmark: 'Kitchen' }));
    s = s.apply(addSceneAlternateTransaction(s, inside(s, 2))!);
    s = s.apply(s.tr.setNodeAttribute(h, 'synopsis', 'Maya stays away.'));
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!);
    expect(middle(s).attrs).toMatchObject({ sceneNumber: '2', locked: true, bookmark: 'Kitchen', synopsis: 'Maya returns.' });
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!);
    expect(middle(s).attrs).toMatchObject({ sceneNumber: '2', locked: true, bookmark: 'Kitchen', synopsis: 'Maya stays away.' });
  });

  it('does nothing in a scene with no versions', () => {
    const s = script();
    expect(cycleSceneAlternateTransaction(s, inside(s, 2), 1)).toBeNull();
    expect(deleteShownSceneAlternateTransaction(s, inside(s, 2))).toBeNull();
    expect(keepOnlyShownSceneTransaction(s, inside(s, 2))).toBeNull();
  });

  it('leaves the scene alone when a stored version cannot be read', () => {
    let s = script();
    s = s.apply(addSceneAlternateTransaction(s, inside(s, 2))!);
    const broken = [{ id: 'x', content: [heading('INT. X - DAY'), { type: 'noSuchElement' }] }];
    s = s.apply(s.tr.setNodeAttribute(inside(s, 2) - 1, 'sceneAlternates', broken));
    const warn = console.warn;
    const warned: unknown[] = [];
    console.warn = (...args: unknown[]) => { warned.push(args); };
    try {
      expect(cycleSceneAlternateTransaction(s, inside(s, 2), 1)).toBeNull();
    } finally {
      console.warn = warn;
    }
    expect(warned).toHaveLength(1);
  });
});

describe('removing scene versions', () => {
  it('deletes the version showing and shows the next', () => {
    let s = threeSceneVersions();
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!); // A, 1/3
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!); // B, 2/3
    s = s.apply(deleteShownSceneAlternateTransaction(s, inside(s, 2))!);
    expect([texts(s)[4], sceneVersionIndex(middle(s)) + 1, sceneVersionCount(middle(s))]).toEqual(['Version C.', 2, 2]);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!);
    expect(texts(s)[4]).toBe('You came back.');
  });

  it('deleting down to one version leaves a plain scene', () => {
    let s = script();
    s = s.apply(addSceneAlternateTransaction(s, inside(s, 2))!);
    s = retype(s, 4, 'Other.');
    s = s.apply(deleteShownSceneAlternateTransaction(s, inside(s, 2))!);
    expect(texts(s)).toEqual(texts(script()));
    expect(middle(s).attrs.sceneAlternates).toBeNull();
    expect(middle(s).attrs.sceneAlternateIndex).toBe(0);
  });

  it('keeps only the version showing', () => {
    let s = threeSceneVersions();
    s = s.apply(keepOnlyShownSceneTransaction(s, inside(s, 4))!);
    expect(texts(s)[4]).toBe('Version C.');
    expect(sceneVersionCount(middle(s))).toBe(1);
    expect(buildAlternateDecorations(s.doc).find()).toHaveLength(0);
  });

  it('omitting the scene throws its versions away with it', () => {
    let s = threeSceneVersions();
    s = s.apply(omitSceneTransaction(s, inside(s, 2))!);
    expect(middle(s).attrs.sceneAlternates).toBeNull();
    expect(middle(s).attrs.sceneNumber).toBe('2');
  });
});

describe('undo', () => {
  it('takes back a switch in one step', () => {
    const before = threeSceneVersions();
    let s = before.apply(cycleSceneAlternateTransaction(before, inside(before, 2), 1)!);
    expect(texts(s)[4]).toBe('You came back.');
    undo(s, (tr) => { s = s.apply(tr); });
    expect(texts(s)).toEqual(texts(before));
    expect(middle(s).attrs.sceneAlternates).toEqual(middle(before).attrs.sceneAlternates);
    expect(sceneVersionIndex(middle(s))).toBe(2);
  });

  it('takes back a delete and a keep-only in one step each', () => {
    const before = threeSceneVersions();
    for (const build of [deleteShownSceneAlternateTransaction, keepOnlyShownSceneTransaction]) {
      let s = before.apply(build(before, inside(before, 2))!);
      undo(s, (tr) => { s = s.apply(tr); });
      expect(texts(s)).toEqual(texts(before));
      expect(sceneVersionCount(middle(s))).toBe(3);
    }
  });
});

describe('scene numbers', () => {
  const numbers = (s: EditorState) => {
    const out: Array<string | null> = [];
    s.doc.forEach((n) => { if (n.type.name === 'sceneHeading') out.push(n.attrs.sceneNumber); });
    return out;
  };

  it('do not move when a scene switches version, locked or not', () => {
    let s = threeSceneVersions();
    for (let i = 0; i < 4; i++) {
      s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!);
      expect(numbers(s)).toEqual(['1', '2', '3']);
      expect(assignSceneNumbers(numbers(s), { visible: true, locked: true })).toEqual(['1', '2', '3']);
      expect(assignSceneNumbers(numbers(s), { visible: true, locked: false })).toEqual(['1', '2', '3']);
    }
  });

  it('are not stored inside a version', () => {
    const s = threeSceneVersions();
    for (const v of sceneAlternatesOf(middle(s))) expect(v.content[0].attrs).not.toHaveProperty('sceneNumber');
  });
});

describe('what a stored version keeps', () => {
  /** A scene whose first version holds a bookmark, a note, a tag, a revision flag and line alternates. */
  function richScene(): EditorState {
    let s = stateOf(
      heading('INT. LAB - DAY', { sceneNumber: '1' }),
      { ...block('action', 'Beakers.'), attrs: { bookmark: 'Lab' } },
      marked('action', 'A spark.', { type: 'scriptNote', attrs: { noteId: 'note-1' } }),
      marked('action', 'The vial.', { type: 'productionTag', attrs: { tagId: 'tag-1', categoryId: 'props' } }),
      block('character', 'ADA'),
      block('dialogue', 'First take.'),
    );
    s = s.apply(addAlternateTransaction(s, inside(s, 5))!);
    s = retype(s, 5, 'Second take.');
    s = s.apply(addSceneAlternateTransaction(s, inside(s, 0))!);
    // The new version: no bookmark, no note, no tag, no line versions.
    const end = s.doc.content.size;
    s = s.apply(s.tr.replaceWith(inside(s, 0) - 1 + s.doc.child(0).nodeSize, end,
      testSchema.nodeFromJSON(block('action', 'Empty lab.'))));
    return s;
  }

  it('keeps bookmarks, note and tag marks and line alternates, and brings them back', () => {
    let s = richScene();
    expect(listBookmarks(s.doc)).toHaveLength(0);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 0), 1)!);
    expect(listBookmarks(s.doc).map((b) => b.name)).toEqual(['Lab']);
    expect(s.doc.child(2).firstChild?.marks.map((m) => [m.type.name, m.attrs.noteId])).toEqual([['scriptNote', 'note-1']]);
    expect(s.doc.child(3).firstChild?.marks[0].attrs.tagId).toBe('tag-1');
    const dialogue = s.doc.child(5);
    expect(dialogue.textContent).toBe('Second take.');
    expect(alternatesOf(dialogue).map((a) => a.content[0]?.text)).toEqual(['First take.']);
    // …and the line's versions still step.
    s = s.apply(cycleAlternateTransaction(s, inside(s, 5), 1)!);
    expect(s.doc.child(5).textContent).toBe('First take.');
    expect(versionIndex(s.doc.child(5))).toBe(0);
  });

  it('gives up a bookmark another element took while the version was put away', () => {
    const elsewhere = stateOf(heading('INT. A - DAY'), { ...block('action', 'x'), attrs: { bookmark: 'Lab' } });
    let t = richScene();
    t = t.apply(t.tr.insert(t.doc.content.size, elsewhere.doc.content));
    t = t.apply(cycleSceneAlternateTransaction(t, inside(t, 0), 1)!);
    expect(listBookmarks(t.doc).map((b) => b.text)).toEqual(['x']);
  });
});

describe('scene alternates in the document', () => {
  it('survive a save and load as JSON', () => {
    const s = threeSceneVersions();
    const reloaded = testSchema.nodeFromJSON(JSON.parse(JSON.stringify(s.doc.toJSON())));
    expect(sceneAlternatesOf(reloaded.child(2)).map((a) => a.content[0].content?.[0]?.text))
      .toEqual(['INT. KITCHEN - NIGHT', 'INT. KITCHEN - DAY']);
    expect(sceneVersionIndex(reloaded.child(2))).toBe(2);
  });

  it('do not stop an older build opening the script; it keeps the version showing', () => {
    const older = getSchema(testExtensions.filter((e) => e.name !== 'alternates'));
    const reloaded = older.nodeFromJSON(threeSceneVersions().doc.toJSON());
    expect(reloaded.child(2).textContent).toBe('EXT. GARDEN - DAY');
    expect(reloaded.child(4).textContent).toBe('Version C.');
    expect(reloaded.child(2).attrs).not.toHaveProperty('sceneAlternates');
    expect(reloaded.child(2).attrs.sceneNumber).toBe('2');
  });

  it('are not copied onto a new heading made by pressing Enter', () => {
    const s = threeSceneVersions();
    const carried = getSplittedAttributes(getAttributesFromExtensions(testExtensions), 'sceneHeading', middle(s).attrs);
    expect(carried).not.toHaveProperty('sceneAlternates');
    expect(carried).not.toHaveProperty('sceneAlternateIndex');
  });

  it('are cleared from a later heading that copied them, but not on load or from a collaborator', () => {
    let s = threeSceneVersions();
    // As a mid-line split does: the attributes on both halves.
    s = s.apply(s.tr.split(inside(s, 2) + 4, 1, [{ type: testSchema.nodes.sceneHeading, attrs: middle(s).attrs }]));
    expect(duplicateSceneAlternates(s.doc)).toEqual([inside(s, 3) - 1]);
    const tr = s.tr.insertText('!', 1);
    const fix = dedupeSceneAlternates([tr], s.apply(tr))!;
    const fixed = s.apply(tr).apply(fix);
    expect(sceneVersionCount(fixed.doc.child(2))).toBe(3);
    expect(sceneVersionCount(fixed.doc.child(3))).toBe(1);
    const remote = s.tr.insertText('!', 1).setMeta('y-sync$', { isChangeOrigin: true });
    expect(dedupeSceneAlternates([remote], s.apply(remote))).toBeNull();
  });

  it('get new ids when a scene is pasted, so the copy keeps its own versions', () => {
    const s = threeSceneVersions();
    const original = sceneAlternatesOf(middle(s)).map((a) => a.id);
    const pasted = freshSceneAlternateIds(new Slice(Fragment.from(middle(s)), 0, 0));
    const ids = sceneAlternatesOf(pasted.content.firstChild).map((a) => a.id);
    expect(ids).toHaveLength(2);
    expect(ids.some((id) => original.includes(id))).toBe(false);
  });

  it('ignore stored versions that are not scene versions', () => {
    const node = testSchema.nodeFromJSON({
      ...heading('INT. X - DAY'),
      attrs: { sceneAlternates: [null, { id: 1 }, { id: 'a', content: [] }, { id: 'b', content: [block('action', 'x')] }, { id: 'c', content: [heading('INT. Y - DAY')] }] },
    });
    expect(sceneAlternatesOf(node).map((a) => a.id)).toEqual(['c']);
  });

  it('draw one chip per scene that has versions, beside the line chips', () => {
    let s = threeSceneVersions();
    expect(buildAlternateDecorations(s.doc).find()).toHaveLength(1);
    s = s.apply(addAlternateTransaction(s, inside(s, 4))!);
    expect(buildAlternateDecorations(s.doc).find()).toHaveLength(2);
    expect(buildAlternateDecorations(script().doc).find()).toHaveLength(0);
  });

  it('only the version showing reaches an export', () => {
    const json = threeSceneVersions().doc.toJSON();
    const fountain = exportFountain(json);
    expect(fountain).toContain('EXT. GARDEN - DAY');
    expect(fountain).toContain('Version C.');
    expect(fountain).not.toContain('KITCHEN');
    expect(fountain).not.toContain('You came back.');
    expect(fountain).not.toContain('Version B.');
    const fdx = exportFDX(json);
    expect(fdx).toContain('Version C.');
    expect(fdx).not.toMatch(/KITCHEN|You came back|Version B/);
  });
});

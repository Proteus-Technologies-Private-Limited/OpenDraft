import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import type { JSONContent } from '@tiptap/core';
import { testSchema, block, doc, marked } from '../test/screenplaySchema';
import {
  addSceneAlternateTransaction,
  cycleSceneAlternateTransaction,
  deleteShownSceneAlternateTransaction,
  keepOnlyShownSceneTransaction,
  sceneAlternateTargetAt,
  sceneVersionCount,
  sceneVersionIndex,
  sceneVersionsOf,
} from './sceneAlternates';
import { omitSceneTransaction } from './omitScene';
import { buildAlternateDecorations } from './extensions/Alternates';
import { exportFountain } from '../utils/fountainExporter';
import { exportFDX } from '../utils/fdxExporter';

function stateOf(...blocks: JSONContent[]) {
  return EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(...blocks)) });
}

/** A position inside the top-level block at `index`. */
function inside(s: EditorState, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return pos + 1;
}

const texts = (s: EditorState) => {
  const out: string[] = [];
  s.doc.forEach((n) => out.push(n.textContent));
  return out;
};

/** Replace the text of the block at `index`, as typing would. */
function retype(s: EditorState, index: number, text: string): EditorState {
  const from = inside(s, index);
  return s.apply(s.tr.insertText(text, from, from + s.doc.child(index).content.size));
}

/** Two scenes; the first has versions "One", "Two", "Three" of its action, showing "Three". */
function threeVersions(): EditorState {
  let s = stateOf(
    { ...block('sceneHeading', 'INT. KITCHEN - DAY'), attrs: { sceneNumber: '4', locked: true, plotlines: ['a'] } },
    block('action', 'One'),
    block('sceneHeading', 'EXT. ROOF - NIGHT'),
    block('action', 'Wind.'),
  );
  s = retype(s.apply(addSceneAlternateTransaction(s, inside(s, 1))!), 1, 'Two');
  s = retype(s.apply(addSceneAlternateTransaction(s, inside(s, 1))!), 1, 'Three');
  return s;
}

describe('adding a scene alternate', () => {
  it('keeps the scene as a version and carries on with a copy of it', () => {
    const s = stateOf(block('sceneHeading', 'INT. KITCHEN - DAY'), block('action', 'Toast burns.'));
    const next = s.apply(addSceneAlternateTransaction(s, inside(s, 1))!);
    expect(texts(next)).toEqual(['INT. KITCHEN - DAY', 'Toast burns.']);
    const heading = next.doc.child(0);
    expect(sceneVersionCount(heading)).toBe(2);
    expect(sceneVersionIndex(heading)).toBe(1);
    expect(sceneVersionsOf(heading)[0].nodes.map((n) => n.type)).toEqual(['sceneHeading', 'action']);
    expect(next.selection.from).toBe(1);
  });

  it('works from any line of the scene, and not before the first scene', () => {
    const s = stateOf(block('action', 'Cold open.'), block('sceneHeading', 'INT. ROOM - DAY'), block('character', 'MAYA'), block('dialogue', 'Hi.'));
    expect(sceneAlternateTargetAt(s, inside(s, 0))).toBeNull();
    expect(sceneAlternateTargetAt(s, inside(s, 3))?.heading.textContent).toBe('INT. ROOM - DAY');
  });

  it('is not offered on an omitted scene', () => {
    let s = stateOf(block('sceneHeading', 'INT. ROOM - DAY'), block('action', 'Gone.'));
    s = s.apply(omitSceneTransaction(s, inside(s, 1))!);
    expect(sceneAlternateTargetAt(s, inside(s, 0))).toBeNull();
  });

  it('stops at the next scene and at an act break', () => {
    const s = stateOf(
      block('sceneHeading', 'INT. A - DAY'), block('action', 'a'),
      block('endOfAct', 'END OF ACT ONE'),
      block('sceneHeading', 'INT. B - DAY'), block('action', 'b'),
    );
    const next = s.apply(addSceneAlternateTransaction(s, inside(s, 1))!);
    expect(sceneVersionsOf(next.doc.child(0))[0].nodes.map((n) => n.type)).toEqual(['sceneHeading', 'action']);
  });
});

describe('switching scene versions', () => {
  it('steps forward and back through every version in the order they were added', () => {
    let s = threeVersions();
    expect(s.doc.child(1).textContent).toBe('Three');
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), 1)!);
    expect(s.doc.child(1).textContent).toBe('One');
    expect(sceneVersionIndex(s.doc.child(0))).toBe(0);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), 1)!);
    expect(s.doc.child(1).textContent).toBe('Two');
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), -1)!);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), -1)!);
    expect(s.doc.child(1).textContent).toBe('Three');
    expect(sceneVersionIndex(s.doc.child(0))).toBe(2);
  });

  it('swaps scenes of different lengths and leaves the next scene alone', () => {
    let s = stateOf(block('sceneHeading', 'INT. A - DAY'), block('action', 'Short.'), block('sceneHeading', 'INT. B - DAY'));
    s = s.apply(addSceneAlternateTransaction(s, inside(s, 1))!);
    s = s.apply(s.tr.insert(s.doc.child(0).nodeSize + s.doc.child(1).nodeSize,
      [testSchema.nodeFromJSON(block('character', 'MAYA')), testSchema.nodeFromJSON(block('dialogue', 'Longer.'))]));
    expect(texts(s)).toEqual(['INT. A - DAY', 'Short.', 'MAYA', 'Longer.', 'INT. B - DAY']);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 2), 1)!);
    expect(texts(s)).toEqual(['INT. A - DAY', 'Short.', 'INT. B - DAY']);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), 1)!);
    expect(texts(s)).toEqual(['INT. A - DAY', 'Short.', 'MAYA', 'Longer.', 'INT. B - DAY']);
  });

  it('keeps the scene number, lock and plotlines, and lets the heading text change with the version', () => {
    let s = threeVersions();
    s = retype(s, 0, 'INT. KITCHEN - NIGHT');
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), 1)!);
    const heading = s.doc.child(0);
    expect(heading.textContent).toBe('INT. KITCHEN - DAY');
    expect(heading.attrs.sceneNumber).toBe('4');
    expect(heading.attrs.locked).toBe(true);
    expect(heading.attrs.plotlines).toEqual(['a']);
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), -1)!);
    expect(s.doc.child(0).textContent).toBe('INT. KITCHEN - NIGHT');
  });

  it('keeps the marks and line alternates inside each version', () => {
    let s = stateOf(block('sceneHeading', 'INT. A - DAY'), marked('action', 'Italic.', 'italic'));
    s = s.apply(addSceneAlternateTransaction(s, inside(s, 1))!);
    s = retype(s, 1, 'Plain.');
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), 1)!);
    expect(s.doc.child(1).firstChild?.marks.map((m) => m.type.name)).toEqual(['italic']);
  });

  it('is one undo step per switch', async () => {
    const { history, undo } = await import('@tiptap/pm/history');
    let s = EditorState.create({ schema: testSchema, doc: threeVersions().doc, plugins: [history()] });
    s = s.apply(cycleSceneAlternateTransaction(s, inside(s, 1), 1)!);
    expect(s.doc.child(1).textContent).toBe('One');
    undo(s, (tr) => { s = s.apply(tr); });
    expect(s.doc.child(1).textContent).toBe('Three');
  });
});

describe('removing scene versions', () => {
  it('deletes the version showing and shows the next', () => {
    let s = threeVersions();
    s = s.apply(deleteShownSceneAlternateTransaction(s, inside(s, 1))!);
    expect(s.doc.child(1).textContent).toBe('One');
    expect(sceneVersionCount(s.doc.child(0))).toBe(2);
  });

  it('keeps only the version showing', () => {
    let s = threeVersions();
    s = s.apply(keepOnlyShownSceneTransaction(s, inside(s, 1))!);
    expect(s.doc.child(1).textContent).toBe('Three');
    expect(sceneVersionsOf(s.doc.child(0))).toEqual([]);
    expect(cycleSceneAlternateTransaction(s, inside(s, 1), 1)).toBeNull();
  });
});

describe('scene alternates in the document', () => {
  it('survive a save and load as JSON', () => {
    const s = threeVersions();
    const reloaded = testSchema.nodeFromJSON(s.doc.toJSON());
    expect(sceneVersionCount(reloaded.child(0))).toBe(3);
  });

  it('ignore stored versions that are not versions', () => {
    const heading = testSchema.nodeFromJSON({
      ...block('sceneHeading', 'INT. A - DAY'),
      attrs: { sceneVersions: [{ id: 'x', nodes: [block('action', 'no heading')] }, 'junk', { id: 'y', nodes: [block('sceneHeading', 'INT. B')] }] },
    });
    expect(sceneVersionsOf(heading).map((v) => v.id)).toEqual(['y']);
  });

  it('draw a scene chip on the heading', () => {
    const s = threeVersions();
    expect(buildAlternateDecorations(s.doc).find().length).toBe(1);
  });

  it('only the version showing reaches an export', () => {
    const s = threeVersions();
    const json = s.doc.toJSON() as JSONContent;
    expect(exportFountain(json)).toContain('Three');
    expect(exportFountain(json)).not.toContain('One');
    const fdx = exportFDX(json);
    expect(fdx).toContain('<Text>Three</Text>');
    expect(fdx).not.toContain('<Text>One</Text>');
  });
});

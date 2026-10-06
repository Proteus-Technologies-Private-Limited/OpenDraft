import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { testSchema, block, doc } from '../test/screenplaySchema';
import { OMITTED_TEXT, omitSceneTransaction, sceneOmittedAt, sceneRangeAt } from './omitScene';

const heading = (n: string, text: string) => ({ ...block('sceneHeading', text), attrs: { sceneNumber: n } });

function state() {
  return EditorState.create({
    schema: testSchema,
    doc: testSchema.nodeFromJSON(doc(
      heading('1', 'INT. ONE - DAY'), block('action', 'First scene.'),
      heading('2', 'INT. TWO - DAY'), block('action', 'Second scene.'), block('character', 'MAYA'), block('dialogue', 'Hello.'),
      block('newAct', 'ACT TWO'),
      heading('3', 'INT. THREE - DAY'), block('action', 'Third scene.'),
    )),
  });
}

/** A position inside the top-level block at `index`. */
function inside(s: EditorState, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return pos + 1;
}

describe('Omit Scene', () => {
  it('finds the scene the cursor is in, stopping at the next scene or act', () => {
    const s = state();
    const r = sceneRangeAt(s, inside(s, 4))!;
    expect(r.headingIndex).toBe(2);
    expect(s.doc.slice(r.from, r.to).content.childCount).toBe(4);
  });

  it('replaces the scene with an OMITTED heading that keeps its number', () => {
    const s = state();
    const next = s.apply(omitSceneTransaction(s, inside(s, 3))!);
    const types = [];
    for (let i = 0; i < next.doc.childCount; i++) types.push(next.doc.child(i).type.name);
    expect(types).toEqual(['sceneHeading', 'action', 'sceneHeading', 'newAct', 'sceneHeading', 'action']);
    const omitted = next.doc.child(2);
    expect(omitted.textContent).toBe(OMITTED_TEXT);
    expect(omitted.attrs.sceneNumber).toBe('2');
    expect(omitted.attrs.omitted).toBe(true);
    expect(sceneOmittedAt(next, inside(next, 2))).toBe(true);
  });

  it('does nothing outside a scene', () => {
    const s = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(block('action', 'No scene yet.'))) });
    expect(omitSceneTransaction(s, 1)).toBeNull();
  });
});

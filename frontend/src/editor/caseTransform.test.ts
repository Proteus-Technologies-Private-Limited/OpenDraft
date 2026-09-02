/**
 * ALL CAPS across several selected lines used to replace the whole range with
 * one flat string, collapsing the lines into one and dropping their marks.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { testSchema, pmDoc, doc, block, marked, BR } from '../test/screenplaySchema';
import { applyCaseToRange, shouldUpperCase } from './caseTransform';
import type { JSONContent } from '@tiptap/react';

/** Apply the transform across the whole document and hand back the result. */
function transform(json: JSONContent, upper: boolean) {
  const state = EditorState.create({ schema: testSchema, doc: pmDoc(json) });
  const tr = state.tr;
  const changed = applyCaseToRange(tr, state.doc, 0, state.doc.content.size, upper);
  return { doc: state.apply(tr).doc, changed };
}

describe('shouldUpperCase', () => {
  it('raises mixed text and lowers text that is already capitals', () => {
    expect(shouldUpperCase('Fade in')).toBe(true);
    expect(shouldUpperCase('FADE IN')).toBe(false);
  });
});

describe('applyCaseToRange', () => {
  const threeLines = doc(
    block('action', 'first line'),
    block('action', 'second line'),
    block('action', 'third line'),
  );

  it('keeps every selected line a line of its own', () => {
    const { doc: out } = transform(threeLines, true);
    expect(out.childCount).toBe(3);
    expect(out.child(0).textContent).toBe('FIRST LINE');
    expect(out.child(1).textContent).toBe('SECOND LINE');
    expect(out.child(2).textContent).toBe('THIRD LINE');
  });

  it('keeps each line its own element type', () => {
    const { doc: out } = transform(doc(
      block('sceneHeading', 'int. kitchen - day'),
      block('action', 'she waits.'),
      block('character', 'anna'),
    ), true);
    expect([...Array(out.childCount)].map((_, i) => out.child(i).type.name))
      .toEqual(['sceneHeading', 'action', 'character']);
  });

  it('keeps the marks on the text it rewrites', () => {
    const { doc: out } = transform(doc(marked('action', 'shouting', 'bold')), true);
    expect(out.firstChild!.textContent).toBe('SHOUTING');
    expect(out.firstChild!.firstChild!.marks.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('keeps a hard break inside a line', () => {
    const { doc: out } = transform(doc(block('action', 'one', BR, 'two')), true);
    expect(out.childCount).toBe(1);
    expect(out.firstChild!.textContent).toBe('ONE\nTWO');
  });

  it('lowers as well as raises', () => {
    const { doc: out } = transform(doc(block('action', 'FIRST'), block('action', 'SECOND')), false);
    expect(out.childCount).toBe(2);
    expect(out.child(0).textContent).toBe('first');
  });

  it('reports no change when there is no case to change', () => {
    expect(transform(doc(block('action', '12345')), true).changed).toBe(false);
  });

  it('rewrites only the selected part of a line', () => {
    const state = EditorState.create({ schema: testSchema, doc: pmDoc(doc(block('action', 'abcdef'))) });
    const tr = state.tr;
    // Positions 2..4 = 'bc' (the block opens at 0, text starts at 1).
    applyCaseToRange(tr, state.doc, 2, 4, true);
    expect(state.apply(tr).doc.firstChild!.textContent).toBe('aBCdef');
  });

  it('survives a case change that is not length-preserving', () => {
    const { doc: out } = transform(doc(block('action', 'straße'), block('action', 'next')), true);
    expect(out.childCount).toBe(2);
    expect(out.child(0).textContent).toBe('STRASSE');
    expect(out.child(1).textContent).toBe('NEXT');
  });
});

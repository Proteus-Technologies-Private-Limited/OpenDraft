import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { isUppercaseElement, normalizeCapitalsJSON } from './capitals';
import { doc, block, marked, BR } from '../test/screenplaySchema';

const textOf = (node: JSONContent | undefined): string =>
  (node?.content || [])
    .map((child) => (child.type === 'text' ? child.text : child.type === 'hardBreak' ? '\n' : ''))
    .join('');

describe('normalizeCapitalsJSON', () => {
  it('knows which elements are printed in capitals', () => {
    expect(isUppercaseElement('sceneHeading')).toBe(true);
    expect(isUppercaseElement('character')).toBe(true);
    expect(isUppercaseElement('transition')).toBe(true);
    expect(isUppercaseElement('action')).toBe(false);
    expect(isUppercaseElement('dialogue')).toBe(false);
  });

  it('raises headings, cues, transitions and the other capitals elements', () => {
    const out = normalizeCapitalsJSON(doc(
      block('sceneHeading', 'int. casa - day'),
      block('character', 'margo (v.o.)'),
      block('transition', 'cut to:'),
      block('shot', 'close on the door'),
      block('newAct', 'act two'),
    ));
    expect(out.content?.map((b) => textOf(b))).toEqual([
      'INT. CASA - DAY',
      'MARGO (V.O.)',
      'CUT TO:',
      'CLOSE ON THE DOOR',
      'ACT TWO',
    ]);
  });

  it('leaves action and dialogue exactly as written', () => {
    const input = doc(
      block('action', 'The rain falls on the old house.'),
      block('character', 'margo'),
      block('dialogue', 'Is anyone home?'),
    );
    const out = normalizeCapitalsJSON(input);
    expect(textOf(out.content?.[0])).toBe('The rain falls on the old house.');
    expect(textOf(out.content?.[2])).toBe('Is anyone home?');
  });

  it('keeps marks and attributes', () => {
    const input = doc(marked('character', 'margo', 'bold'));
    input.content![0].attrs = { extension: '(V.O.)' };
    const out = normalizeCapitalsJSON(input);
    const node = out.content?.[0];
    expect(textOf(node)).toBe('MARGO');
    expect(node?.content?.[0].marks?.some((m) => m.type === 'bold')).toBe(true);
    expect(node?.attrs).toEqual({ extension: '(V.O.)' });
  });

  it('walks into dual dialogue columns', () => {
    const input = doc({
      type: 'dualDialogue',
      content: [{
        type: 'dualDialogueColumn',
        content: [block('character', 'margo'), block('dialogue', 'Hello.')],
      }],
    });
    const out = normalizeCapitalsJSON(input);
    const column = out.content?.[0].content?.[0];
    expect(textOf(column?.content?.[0])).toBe('MARGO');
    expect(textOf(column?.content?.[1])).toBe('Hello.');
  });

  it('keeps hard breaks and their neighbours', () => {
    const out = normalizeCapitalsJSON(doc(block('character', 'margo', BR, 'v.o.')));
    expect(out.content?.[0].content?.map((c) => c.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(textOf(out.content?.[0])).toBe('MARGO\nV.O.');
  });

  it('returns the same object when there is nothing to change', () => {
    const input = doc(block('sceneHeading', 'INT. CASA - DAY'), block('action', 'One.'));
    expect(normalizeCapitalsJSON(input)).toBe(input);
  });

  it('does not mutate the document it was given', () => {
    const input = doc(block('sceneHeading', 'int. casa - day'));
    normalizeCapitalsJSON(input);
    expect(textOf(input.content?.[0])).toBe('int. casa - day');
  });
});

import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { testSchema, block, doc, marked, BR } from '../test/screenplaySchema';
import { blockText, collectSpeeches, editLineTransaction, listSpeakers, speakerAt } from './dialogueTuner';

const script = doc(
  block('action', 'Cold open.'),
  block('sceneHeading', 'INT. KITCHEN - DAY'),
  block('character', 'SARAH'),
  block('dialogue', 'Morning.'),
  block('character', 'BOB'),
  block('dialogue', 'Is it?'),
  block('character', "Sarah (CONT'D)"),
  block('parenthetical', '(beat)'),
  block('dialogue', 'Fine.', BR, 'Afternoon.'),
  block('action', 'She leaves.'),
  block('sceneHeading', 'EXT. STREET - NIGHT'),
  {
    type: 'dualDialogue',
    content: [
      { type: 'dualDialogueColumn', content: [block('character', 'SARAH'), block('dialogue', 'Left.')] },
      { type: 'dualDialogueColumn', content: [block('character', 'BOB'), block('dialogue', 'Right.')] },
    ],
  },
);

const pm = testSchema.nodeFromJSON(script);
const state = () => EditorState.create({ schema: testSchema, doc: pm });

describe('dialogue tuner', () => {
  it('lists speakers by number of speeches', () => {
    expect(listSpeakers(pm)).toEqual([{ name: 'SARAH', speeches: 3 }, { name: 'BOB', speeches: 2 }]);
  });

  it('collects every speech of a character with its scene, lines and the line before', () => {
    const speeches = collectSpeeches(pm, 'sarah');
    expect(speeches.map((s) => [s.cue, s.scene, s.sceneIndex, s.lines.map((l) => `${l.type}:${l.text}`)])).toEqual([
      ['SARAH', 'INT. KITCHEN - DAY', 1, ['dialogue:Morning.']],
      ["Sarah (CONT'D)", 'INT. KITCHEN - DAY', 1, ['parenthetical:(beat)', 'dialogue:Fine.\nAfternoon.']],
      ['SARAH', 'EXT. STREET - NIGHT', 2, ['dialogue:Left.']],
    ]);
    expect(speeches[0].before).toEqual({ type: 'sceneHeading', text: 'INT. KITCHEN - DAY', speaker: '' });
    expect(speeches[1].before).toEqual({ type: 'dialogue', text: 'Is it?', speaker: 'BOB' });
  });

  it('positions point at the lines themselves', () => {
    for (const s of collectSpeeches(pm, 'SARAH')) {
      for (const l of s.lines) expect(blockText(pm.nodeAt(l.pos)!)).toBe(l.text);
    }
  });

  it('knows who is speaking at a position', () => {
    const [, second] = collectSpeeches(pm, 'SARAH');
    expect(speakerAt(pm, second.lines[1].pos + 2)).toBe('SARAH');
    expect(speakerAt(pm, 2)).toBe('');
  });

  it('writes an edit back as the smallest change, keeping line breaks', () => {
    const s = state();
    const line = collectSpeeches(pm, 'SARAH')[1].lines[1];
    const tr = editLineTransaction(s, line.pos, line.text, 'Fine.\nEvening.')!;
    const next = s.apply(tr);
    expect(blockText(next.doc.nodeAt(line.pos)!)).toBe('Fine.\nEvening.');
    expect(tr.steps).toHaveLength(1);
  });

  it('keeps marks on the part of the line that did not change', () => {
    const d = testSchema.nodeFromJSON(doc(block('character', 'A'), marked('dialogue', 'Hello there.', 'bold')));
    const s = EditorState.create({ schema: testSchema, doc: d });
    const pos = d.child(0).nodeSize;
    const next = s.apply(editLineTransaction(s, pos, 'Hello there.', 'Hello, there.')!);
    const para = next.doc.nodeAt(pos)!;
    expect(para.textContent).toBe('Hello, there.');
    para.forEach((child) => expect(child.marks.map((m) => m.type.name)).toEqual(['bold']));
  });

  it('handles deleting text and refuses a line that changed underneath', () => {
    const s = state();
    const line = collectSpeeches(pm, 'SARAH')[0].lines[0];
    const next = s.apply(editLineTransaction(s, line.pos, 'Morning.', 'Morn.')!);
    expect(blockText(next.doc.nodeAt(line.pos)!)).toBe('Morn.');
    expect(editLineTransaction(s, line.pos, 'Not what is there', 'x')).toBeNull();
    expect(editLineTransaction(s, line.pos, 'Morning.', 'Morning.')).toBeNull();
  });
});

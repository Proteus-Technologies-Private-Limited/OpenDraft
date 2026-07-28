import { describe, it, expect } from 'vitest';
import { exportFountain } from './fountainExporter';
import { doc, block, marked, BR } from '../test/screenplaySchema';

describe('Fountain export with hard breaks', () => {
  it('writes a break in Action as a real newline', () => {
    const out = exportFountain(doc(block('action', 'Line one', BR, 'Line two')));
    expect(out).toContain('Line one\nLine two');
  });

  it('does not glue the words either side of a break', () => {
    const out = exportFountain(doc(block('action', 'NIGHT', BR, 'FALL')));
    expect(out).not.toContain('NIGHTFALL');
  });

  it('keeps a dialogue block alive across a doubled break', () => {
    // A truly blank line would terminate the dialogue block, so an otherwise
    // empty line is written as the two-space "intentional blank" convention.
    const out = exportFountain(doc(block('dialogue', 'A', BR, BR, 'B')));
    expect(out).toContain('A\n  \nB');
  });

  it('collapses a break in a scene heading to a space', () => {
    const out = exportFountain(doc(block('sceneHeading', 'INT. HOUSE', BR, 'DAY')));
    expect(out).toContain('INT. HOUSE DAY');
    expect(out).not.toContain('INT. HOUSE\nDAY');
  });

  it('collapses a break in a character cue', () => {
    const out = exportFountain(doc(block('character', 'JOHN', BR, 'SMITH')));
    expect(out).toContain('JOHN SMITH');
  });

  it('keeps a transition on one line so its > prefix still applies', () => {
    const out = exportFountain(doc(block('transition', 'CUT', BR, 'TO:')));
    expect(out).toContain('> CUT TO:');
  });

  it('keeps the dual-dialogue ^ marker on the character line', () => {
    const out = exportFountain(doc({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [block('character', 'A'), block('dialogue', 'One.')] },
        {
          type: 'dualDialogueColumn',
          content: [block('character', 'B', BR, 'TWO'), block('dialogue', 'Two.')],
        },
      ],
    }));
    expect(out).toContain('B TWO ^');
  });

  it('still wraps marks around text', () => {
    const out = exportFountain(doc(marked('action', 'bold text', 'bold')));
    expect(out).toContain('**bold text**');
  });

  it('does not wrap a break in mark delimiters', () => {
    const out = exportFountain(doc({
      type: 'action',
      content: [
        { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      ],
    }));
    expect(out).toContain('**a**\n**b**');
  });
});

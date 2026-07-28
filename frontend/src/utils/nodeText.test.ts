import { describe, it, expect } from 'vitest';
import {
  jsonBlockText, jsonBlockLines, jsonHasBreak, jsonBlockRuns,
  blockContentRange, singleLine, characterKey,
} from './nodeText';
import { pmDoc, doc, block, BR } from '../test/screenplaySchema';

describe('jsonBlockText', () => {
  it('joins text runs', () => {
    expect(jsonBlockText(block('action', 'Hello ', 'world'))).toBe('Hello world');
  });

  it('renders a hard break as a newline instead of dropping it', () => {
    expect(jsonBlockText(block('action', 'Line one', BR, 'Line two'))).toBe('Line one\nLine two');
  });

  it('handles a break-only block', () => {
    expect(jsonBlockText(block('action', BR))).toBe('\n');
  });

  it('handles empty and missing content', () => {
    expect(jsonBlockText({ type: 'action', content: [] })).toBe('');
    expect(jsonBlockText({ type: 'action' })).toBe('');
    expect(jsonBlockText(null)).toBe('');
    expect(jsonBlockText(undefined)).toBe('');
  });

  it('recurses through nested containers', () => {
    const nested = {
      type: 'dualDialogue',
      content: [{
        type: 'dualDialogueColumn',
        content: [block('dialogue', 'A', BR, 'B')],
      }],
    };
    expect(jsonBlockText(nested)).toBe('A\nB');
  });

  it('ignores leaves that are neither text nor breaks', () => {
    expect(jsonBlockText({ type: 'action', content: [{ type: 'screenplayImage' }, { type: 'text', text: 'x' }] })).toBe('x');
  });
});

describe('jsonBlockLines', () => {
  it('splits on breaks', () => {
    expect(jsonBlockLines(block('action', 'a', BR, 'b', BR, 'c'))).toEqual(['a', 'b', 'c']);
  });

  it('yields an empty segment for a double break', () => {
    expect(jsonBlockLines(block('action', 'a', BR, BR, 'b'))).toEqual(['a', '', 'b']);
  });
});

describe('jsonHasBreak', () => {
  it('detects breaks at any depth', () => {
    expect(jsonHasBreak(block('action', 'x'))).toBe(false);
    expect(jsonHasBreak(block('action', 'x', BR))).toBe(true);
    expect(jsonHasBreak({ type: 'avCell', content: [block('avPara', 'x', BR, 'y')] })).toBe(true);
  });
});

describe('jsonBlockRuns', () => {
  it('returns one empty run for an empty block', () => {
    expect(jsonBlockRuns({ type: 'action', content: [] })).toEqual([
      { text: '', bold: false, italic: false, underline: false, strike: false, isBreak: false },
    ]);
  });

  it('flags break runs and keeps them in position', () => {
    const runs = jsonBlockRuns(block('action', 'a', BR, 'b'));
    expect(runs.map((r) => [r.text, r.isBreak])).toEqual([['a', false], ['', true], ['b', false]]);
  });

  it('preserves marks per run', () => {
    const runs = jsonBlockRuns({
      type: 'action',
      content: [
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'i', marks: [{ type: 'italic' }, { type: 'strike' }] },
      ],
    });
    expect(runs[0]).toMatchObject({ text: 'b', bold: true, italic: false });
    expect(runs[1].isBreak).toBe(true);
    expect(runs[2]).toMatchObject({ text: 'i', italic: true, strike: true, bold: false });
  });

  it('never marks a break run as styled', () => {
    const runs = jsonBlockRuns(block('character', 'X', BR));
    expect(runs[1]).toMatchObject({ bold: false, italic: false, underline: false, strike: false, text: '' });
  });
});

describe('blockContentRange', () => {
  it.each([0, 1, 2])('spans the whole inline content with %i breaks', (breaks) => {
    const parts: Array<string | typeof BR> = ['Start'];
    for (let i = 0; i < breaks; i++) { parts.push(BR); parts.push('more'); }
    const d = pmDoc(doc(block('action', ...parts)));
    const node = d.firstChild!;
    const { from, to } = blockContentRange(node, 0);
    expect(from).toBe(1);
    expect(to).toBe(1 + node.content.size);
    // The naive form this replaces is short by one per break.
    expect(to - from).toBe(node.textContent.length);
  });

  it('is correct for a non-zero node position', () => {
    const d = pmDoc(doc(block('action', 'first'), block('action', 'x', BR, 'y')));
    let found: { from: number; to: number } | null = null;
    d.forEach((node, offset, index) => {
      if (index === 1) found = blockContentRange(node, offset);
    });
    expect(found).not.toBeNull();
    const second = d.child(1);
    expect(found!.to - found!.from).toBe(second.content.size);
  });
});

describe('singleLine', () => {
  it('collapses breaks and surrounding whitespace', () => {
    expect(singleLine('a\nb')).toBe('a b');
    expect(singleLine('a \n b')).toBe('a b');
    expect(singleLine('a\n\nb')).toBe('a b');
  });

  it('trims the result', () => {
    expect(singleLine('\na\n')).toBe('a');
    expect(singleLine('  padded  ')).toBe('padded');
  });

  it('leaves single-line text alone', () => {
    expect(singleLine('INT. HOUSE - DAY')).toBe('INT. HOUSE - DAY');
  });
});

describe('characterKey', () => {
  it('normalizes a broken cue to the same key as an unbroken one', () => {
    expect(characterKey('JOHN\nSMITH')).toBe('JOHN SMITH');
    expect(characterKey('john smith')).toBe('JOHN SMITH');
  });

  it('strips extensions', () => {
    expect(characterKey("JOHN (CONT'D)")).toBe('JOHN');
    expect(characterKey('JOHN (V.O.)')).toBe('JOHN');
    expect(characterKey("JOHN\n(CONT'D)")).toBe('JOHN');
  });

  it('is stable across the normalization both sides of a comparison need', () => {
    expect(characterKey('  MARY  ')).toBe(characterKey('mary'));
  });
});

import { describe, it, expect } from 'vitest';
import { getTextLines, wordWrapRuns } from '../utils/wrapText';
import { jsonBlockText, jsonBlockRuns } from '../utils/nodeText';
import { block, BR } from '../test/screenplaySchema';

/** The runs a block contributes to wrapping, as the PDF exporter builds them. */
const extractRuns = jsonBlockRuns;

describe('getTextLines', () => {
  it('counts an empty block as one line', () => {
    expect(getTextLines('', 60)).toBe(1);
  });

  it('wraps by characters per line', () => {
    expect(getTextLines('a'.repeat(60), 60)).toBe(1);
    expect(getTextLines('a'.repeat(61), 60)).toBe(2);
    expect(getTextLines('a'.repeat(180), 60)).toBe(3);
  });

  it('forces a line boundary at a hard break', () => {
    expect(getTextLines('A\nB', 60)).toBe(2);
    expect(getTextLines('A\nB\nC', 60)).toBe(3);
  });

  it('counts a blank segment from a double break as its own line', () => {
    expect(getTextLines('A\n\nB', 60)).toBe(3);
  });

  it('counts a trailing break as opening a new line', () => {
    expect(getTextLines('A\n', 60)).toBe(2);
  });

  it('wraps each segment independently', () => {
    // 70 chars wraps to 2 at cpl 60; plus a 5-char segment = 3
    expect(getTextLines(`${'a'.repeat(70)}\nshort`, 60)).toBe(3);
  });
});

describe('getTextLines agrees with the PDF word wrapper', () => {
  // Editor pagination and PDF pagination must produce the same line count for
  // the same block, or page breaks land in different places in the two.
  //
  // Cases use ordinary prose (spaces present). See the "known divergence"
  // block below for the one shape where the two legitimately differ.
  const wrappable = 'the quick brown fox jumps over the lazy dog ';
  const cases: Array<[string, ReturnType<typeof block>]> = [
    ['plain', block('action', 'Just one line.')],
    ['single break', block('action', 'Line one', BR, 'Line two')],
    ['double break', block('action', 'A', BR, BR, 'B')],
    ['leading break', block('action', BR, 'After')],
    ['trailing break', block('action', 'Before', BR)],
    ['empty block', block('action')],
    ['many words', block('action', wrappable.repeat(3))],
    ['break between wrapped runs', block('action', wrappable.repeat(2), BR, wrappable.repeat(2))],
    ['break inside dialogue', block('dialogue', wrappable, BR, 'Short.')],
  ];

  it.each(cases)('%s', (_name, node) => {
    const cpl = 60;
    const counted = getTextLines(jsonBlockText(node), cpl);
    const wrapped = wordWrapRuns(extractRuns(node), cpl, false).length;
    expect(wrapped).toBe(counted);
  });
});

describe('known divergence: a single word longer than the line', () => {
  // PRE-EXISTING, not introduced with hard breaks: `wordWrapRuns` only ever
  // splits on spaces, so a word longer than the line stays on one line and
  // overflows the margin, while `getTextLines` counts it as ceil(len / cpl).
  //
  // Left as-is deliberately. Making the wrapper break mid-word would change
  // the line count of existing scripts and shift everyone's page breaks, which
  // does not belong in a hard-break change. Recorded here so the divergence is
  // visible rather than lurking, and so the agreement suite above is honest
  // about what it does and does not cover.
  it('counts differently for an unbroken 130-character token', () => {
    const node = block('action', 'y'.repeat(130));
    expect(getTextLines(jsonBlockText(node), 60)).toBe(3);
    expect(wordWrapRuns(extractRuns(node), 60, false).length).toBe(1);
  });

  it('still agrees on where the hard breaks fall around such a token', () => {
    const node = block('action', 'y'.repeat(130), BR, 'z'.repeat(130));
    // Two over-long tokens → two wrapped lines, one per break-delimited segment.
    expect(wordWrapRuns(extractRuns(node), 60, false).length).toBe(2);
  });
});

describe('wordWrapRuns with breaks', () => {
  const plain = (lines: ReturnType<typeof wordWrapRuns>) =>
    lines.map((l) => l.map((r) => r.text).join(''));

  it('starts a new line at a break', () => {
    expect(plain(wordWrapRuns(extractRuns(block('action', 'one', BR, 'two')), 60, false)))
      .toEqual(['one', 'two']);
  });

  it('produces a genuinely blank line for a double break', () => {
    expect(plain(wordWrapRuns(extractRuns(block('action', 'a', BR, BR, 'b')), 60, false)))
      .toEqual(['a', '', 'b']);
  });

  it('resumes wrapping after a break', () => {
    const tail = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet ';
    const node = block('action', 'x', BR, tail.repeat(2));
    const lines = plain(wordWrapRuns(extractRuns(node), 60, false));
    expect(lines[0]).toBe('x');
    // The tail wraps normally; the break did not disturb the wrapper's state.
    expect(lines.length).toBe(1 + getTextLines(tail.repeat(2), 60));
  });

  it('does not uppercase a break run', () => {
    const lines = wordWrapRuns(extractRuns(block('character', 'jo', BR, 'hn')), 60, true);
    expect(plain(lines)).toEqual(['JO', 'HN']);
  });
});

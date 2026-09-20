import { describe, it, expect } from 'vitest';
import {
  getTextLines, wordWrapRuns, textColumns, sliceColumns,
} from '../utils/wrapText';
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

  // The cases above are the shapes worth naming; this is the whole space.
  // `getTextLines` measures what `wordWrapRuns` would build without building
  // it, because pagination runs it over every block on every keystroke — so
  // the only thing keeping the two honest is that they are asked the same
  // question about a great many strings. Counting ceil(length / column)
  // instead is what made the editor and the exported PDF turn the page in
  // different places (issue #123).
  it('agrees on forty thousand random strings', () => {
    const runsFor = (text: string) => text.split('\n').flatMap((seg, i) => (
      i === 0
        ? [{ text: seg, bold: false, italic: false, underline: false }]
        : [
          { text: '', bold: false, italic: false, underline: false, isBreak: true },
          { text: seg, bold: false, italic: false, underline: false },
        ]
    ));
    // Mulberry32: the same strings every run, no fixtures on disk.
    let seed = 99;
    const rnd = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Words, runs of spaces, hard breaks, and tokens wider than any column.
    const pieces = ['a', 'bb', 'ccc', 'dddd', 'eeeee', 'ffffffff', 'g'.repeat(40), 'h'.repeat(100)];
    const bad: string[] = [];
    for (let n = 0; n < 40_000 && bad.length < 5; n++) {
      let text = '';
      const tokens = Math.floor(rnd() * 14);
      for (let t = 0; t < tokens; t++) {
        const roll = rnd();
        if (roll < 0.12) text += '\n';
        else if (roll < 0.3) text += ' ';
        else text += pieces[Math.floor(rnd() * pieces.length)];
      }
      const cpl = 1 + Math.floor(rnd() * 60);
      const counted = getTextLines(text, cpl);
      const wrapped = wordWrapRuns(runsFor(text), cpl, false).length;
      if (counted !== wrapped) {
        bad.push(`cpl=${cpl} ${JSON.stringify(text)} counted ${counted}, wrapped ${wrapped}`);
      }
    }
    expect(bad.join('\n')).toBe('');
  });
});

describe('a single word longer than the line', () => {
  // Used to be a documented divergence: `wordWrapRuns` only split on spaces, so
  // an unbroken token stayed on one line and ran past the right margin, while
  // `getTextLines` counted it as ceil(len / cpl). The editor overflowed too,
  // though the page thumbnail did not. The wrapper now breaks at the margin, so
  // all three agree and nothing overflows.
  const plain = (lines: ReturnType<typeof wordWrapRuns>) =>
    lines.map((l) => l.map((r) => r.text).join(''));

  it('breaks an unbroken 130-character token at the line width', () => {
    const node = block('action', 'y'.repeat(130));
    expect(getTextLines(jsonBlockText(node), 60)).toBe(3);
    expect(wordWrapRuns(extractRuns(node), 60, false).length).toBe(3);
  });

  it('never emits a line wider than the limit', () => {
    const node = block('action', 'y'.repeat(130));
    for (const line of plain(wordWrapRuns(extractRuns(node), 60, false))) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it('loses no characters when breaking', () => {
    const node = block('action', 'y'.repeat(130));
    expect(plain(wordWrapRuns(extractRuns(node), 60, false)).join('')).toBe('y'.repeat(130));
  });

  it('agrees around hard breaks', () => {
    const node = block('action', 'y'.repeat(130), BR, 'z'.repeat(130));
    expect(wordWrapRuns(extractRuns(node), 60, false).length)
      .toBe(getTextLines(jsonBlockText(node), 60));
  });

  it('breaks a token that starts partway along a line', () => {
    const node = block('action', `short ${'y'.repeat(130)}`);
    const lines = plain(wordWrapRuns(extractRuns(node), 60, false));
    expect(lines[0]).toBe('short');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
    expect(lines.join('').replace(/\s/g, '')).toBe(`short${'y'.repeat(130)}`);
  });

  it('lets a following word share the remainder line', () => {
    // The tail of a broken token is 10 characters, so "tail" fits beside it —
    // which is what keeps the count equal to ceil(total / cpl).
    const node = block('action', `${'y'.repeat(130)} tail`);
    const lines = plain(wordWrapRuns(extractRuns(node), 60, false));
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(`${'y'.repeat(10)} tail`);
  });

  it('carries the token\'s marks onto every broken line', () => {
    const node = {
      type: 'action',
      content: [{ type: 'text', text: 'y'.repeat(130), marks: [{ type: 'bold' }] }],
    };
    const lines = wordWrapRuns(extractRuns(node), 60, false);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.every((r) => r.bold)).toBe(true);
  });

  it('handles a token that is an exact multiple of the line width', () => {
    const node = block('action', 'y'.repeat(120));
    expect(wordWrapRuns(extractRuns(node), 60, false).length)
      .toBe(getTextLines(jsonBlockText(node), 60));
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

describe('wordWrapRuns keeps deliberate indentation', () => {
  const plain = (lines: ReturnType<typeof wordWrapRuns>) =>
    lines.map((l) => l.map((r) => r.text).join(''));

  it('preserves leading spaces at the start of a block', () => {
    // General exists to hold hand-aligned text — onscreen records, archival
    // entries. The PDF used to print this flush left while the editor showed it
    // indented.
    expect(plain(wordWrapRuns(extractRuns(block('general', '    Hello')), 60, false)))
      .toEqual(['    Hello']);
  });

  it('preserves leading spaces after a hard break', () => {
    expect(plain(wordWrapRuns(extractRuns(block('general', 'one', BR, '    two')), 60, false)))
      .toEqual(['one', '    two']);
  });

  it('preserves an indent split across runs', () => {
    // Marks fragment a line into several runs, so the indent and the first word
    // can arrive separately.
    const node = {
      type: 'general',
      content: [
        { type: 'text', text: '   ' },
        { type: 'text', text: 'Indented', marks: [{ type: 'bold' }] },
      ],
    };
    expect(plain(wordWrapRuns(extractRuns(node), 60, false))).toEqual(['   Indented']);
  });

  it('agrees with getTextLines once the indent counts toward the line', () => {
    // The two must not disagree, or the editor and the PDF break pages
    // differently. A 55-space indent plus "aaa bbb" is 62 characters, so it has
    // to wrap — and it only wraps if the indent is counted, which is the bug.
    const text = `${' '.repeat(55)}aaa bbb`;
    const lines = wordWrapRuns(extractRuns(block('general', text)), 60, false);
    expect(lines.length).toBe(2);
    expect(lines.length).toBe(getTextLines(text, 60));
  });

  it('still collapses a single separating space between words', () => {
    expect(plain(wordWrapRuns(extractRuns(block('action', 'one two')), 60, false)))
      .toEqual(['one two']);
  });
});

describe('double-width characters', () => {
  const run = (text: string) => ({ text, bold: false, italic: false, underline: false });

  it('counts Han, kana and hangul as two cells', () => {
    expect(textColumns('你好')).toBe(4);
    expect(textColumns('こんにちは')).toBe(10);
    expect(textColumns('안녕')).toBe(4);
  });

  it('counts everything else exactly as the character count, as it always did', () => {
    // The guarantee that makes this change safe for every script that already
    // worked: for text without a wide character in it, nothing moved.
    for (const text of [
      'INT. LIBRARY - DAY',
      'Привет, как дела',
      'नमस्ते दुनिया',
      'வணக்கம் உலகம்',
      'สวัสดีชาวโลก',
      "He said “no” — and left…",
      '',
    ]) {
      expect(textColumns(text)).toBe(text.length);
    }
  });

  it('counts a mixed line by what is actually drawn', () => {
    expect(textColumns('OK 你好')).toBe(3 + 4);
  });

  it('never cuts a wide character in half', () => {
    // Five cells asked for, and the third character cannot be halved, so the
    // slice stops one cell short rather than splitting a glyph.
    expect(sliceColumns('你好你', 5)).toBe('你好');
    expect(sliceColumns('你好你', 6)).toBe('你好你');
  });

  it('takes at least one character even when it will not fit', () => {
    // A prefix of nothing would leave the caller slicing the same string for
    // ever. One cell over the margin is the lesser evil, and only reachable
    // with a column limit of one.
    expect(sliceColumns('你好', 1)).toBe('你');
  });

  it('wraps a Chinese line at the margin instead of twice past it', () => {
    // Twenty characters at forty columns: one full line, since each is two
    // cells wide. Counting them as one cell each would have fitted forty
    // characters and run the line off the page.
    const line = '你'.repeat(20);
    expect(wordWrapRuns([run(line)], 40, false)).toHaveLength(1);
    expect(wordWrapRuns([run(`${line}你`)], 40, false)).toHaveLength(2);
  });

  it('agrees with getTextLines on Chinese, which has no spaces to break at', () => {
    // The contract this whole module exists for (issue #123), on the script
    // most likely to break it: CJK is one unbroken token, so it goes through
    // the over-long path in both functions and they have to cut it alike.
    for (const length of [1, 19, 20, 21, 40, 41, 99]) {
      const text = '好'.repeat(length);
      expect(getTextLines(text, 40)).toBe(wordWrapRuns([run(text)], 40, false).length);
    }
  });

  it('agrees with getTextLines on a line that mixes both widths', () => {
    for (const text of [
      'Tokyo 東京 at night',
      '你好 world 你好 world 你好 world 你好 world',
      'A 你 B 好 C 你 D 好 E 你 F 好 G 你 H 好 I 你 J 好',
    ]) {
      expect(getTextLines(text, 35)).toBe(wordWrapRuns([run(text)], 35, false).length);
    }
  });
});

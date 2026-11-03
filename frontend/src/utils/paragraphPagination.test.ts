import { describe, it, expect } from 'vitest';
import { getTextLines, textLineOffsets } from './wrapText';
import { paragraphLines, paragraphFragments, sliceParagraphRuns } from './paragraphPagination';
import { computeBreaks, getPageMetrics, computePageBlocks } from '../editor/pagination';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { block, doc, pmDoc, BR } from '../test/screenplaySchema';
const layout = {
  ...DEFAULT_PAGE_LAYOUT,
  pageHeight: 4,
  topMargin: 36,
  bottomMargin: 36,
};
describe('intra-paragraph page turns', () => {
  for (const text of [
    'one two three four five six seven eight',
    'x'.repeat(500),
    'hello\n\nworld\n',
    '你好世界'.repeat(80),
    '🙂'.repeat(100),
    '   indented words  '.repeat(30),
  ])
    it(`shares offsets with the line counter (${text.slice(0, 12)})`, () => {
      const starts = textLineOffsets(text, 12);
      expect(starts).toHaveLength(getTextLines(text, 12));
      expect(starts[0]).toBe(0);
      expect(starts.every((n, i) => i === 0 || n >= starts[i - 1])).toBe(true);
      expect(
        paragraphLines(text, 12)
          .map((l) => l.text)
          .join(''),
      ).toBe(text);
      for (const start of starts)
        expect(start === 0 || !/^[\uDC00-\uDFFF]$/.test(text[start] ?? '')).toBe(true);
    });
  it('paginates a single long action without changing any content', () => {
    const source = pmDoc(doc(block('action', 'A long action paragraph. '.repeat(300))));
    const before = source.toJSON();
    const result = computeBreaks(source, layout);
    expect(result.pageCount).toBeGreaterThan(2);
    expect(
      result.breaks.every(
        (b) =>
          b.nodeIndex === 0 &&
          b.contentOffset! > 0 &&
          b.linesOnPage <= getPageMetrics(layout).linesPerPage,
      ),
    ).toBe(true);
    expect(source.toJSON()).toEqual(before);
    expect(computePageBlocks(source, layout)).toHaveLength(result.pageCount);
  });
  it('splits a long single speech on its first page and repeats continuation metadata', () => {
    const source = pmDoc(
      doc(block('character', 'SARAH'), block('dialogue', 'A long spoken sentence. '.repeat(400))),
    );
    const result = computeBreaks(source, layout);
    expect(result.pageCount).toBeGreaterThan(3);
    expect(result.breaks.every((b) => b.isDialogueSplit && b.characterName === 'SARAH')).toBe(true);
    expect(result.breaks.every((b) => b.linesOnPage <= getPageMetrics(layout).linesPerPage)).toBe(
      true,
    );
    expect(result.breaks.some((b) => b.contentOffset! > 0)).toBe(true);
  });
  it('keeps hard breaks as original inline offsets', () => {
    const source = pmDoc(
      doc(block('action', ...Array.from({ length: 80 }, (_, i) => [String(i), BR]).flat())),
    );
    const result = computeBreaks(source, layout);
    expect(result.pageCount).toBeGreaterThan(3);
    for (const b of result.breaks)
      expect(source.child(0).textContent.slice(b.contentOffset)).toMatch(/^\d/);
  });
  it('slices marks without dropping characters or repeating a marker', () => {
    const runs = [
      { text: 'bold words', bold: true, marker: '1' },
      { text: ' plain text', bold: false },
    ];
    const a = sliceParagraphRuns(runs, 0, 10),
      b = sliceParagraphRuns(runs, 10, 21);
    expect(a.map((r) => r.text).join('') + b.map((r) => r.text).join('')).toBe(
      'bold words plain text',
    );
    expect(a[0].bold).toBe(true);
    expect([...a, ...b].filter((r) => r.marker)).toHaveLength(1);
  });
});

it('leaves paragraphs shorter than a page indivisible', () => {
  const lines = getPageMetrics(layout).linesPerPage;
  const source = pmDoc(
    doc(
      ...Array.from({ length: lines - 2 }, () => block('general', 'Filler')),
      block('action', 'An ordinary sentence that wraps over several lines. '.repeat(4)),
    ),
  );
  const result = computeBreaks(source, layout);
  expect(result.breaks.every((b) => b.contentOffset === undefined)).toBe(true);
});

it.each(['action', 'dialogue', 'lyrics', 'general'])(
  'keeps two lines on both sides in oversized %s',
  (type) => {
    const lineCount = getPageMetrics(layout).linesPerPage * 3 + 1;
    const text = Array.from({ length: lineCount }, (_, i) => [
      `L${i}`,
      ...(i < lineCount - 1 ? [BR] : []),
    ]).flat();
    const json =
      type === 'dialogue'
        ? doc(block('character', 'SARAH'), block(type, ...text))
        : doc(block(type, ...text));
    const nodeIndex = type === 'dialogue' ? 1 : 0;
    const source = pmDoc(json);
    const starts = textLineOffsets(
      source.child(nodeIndex).textContent,
      type === 'dialogue' ? 36 : 62,
    );
    const result = computeBreaks(source, layout);
    const boundaries = [
      0,
      ...result.breaks
        .filter((b) => b.contentOffset !== undefined)
        .map((b) => starts.indexOf(b.contentOffset!)),
      starts.length,
    ];
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i] - boundaries[i - 1]).toBeGreaterThanOrEqual(2);
      expect(boundaries[i] - boundaries[i - 1]).toBeLessThanOrEqual(
        getPageMetrics(layout).linesPerPage,
      );
    }
  },
);

it('never leaves a one-line fragment when preferring a sentence ending', () => {
  for (let length = 4; length < 80; length++) {
    const text = Array.from({ length }, (_, i) => i % 3 === 2 ? 'A sentence.' : 'A line').join('\n');
    const fragments = paragraphFragments(text, 62);
    expect(fragments.every(fragment => fragment.lines.length >= 2)).toBe(true);
    expect(fragments.map(fragment => fragment.text).join('')).toBe(text);
  }
});

it('prefers a sentence ending four lines beyond the minimum fragment', () => {
  const text = ['one', 'two', 'three', 'four', 'five', 'six.', 'seven', 'eight', 'nine', 'ten'].join('\n');
  expect(paragraphFragments(text, 62)[0].lines).toHaveLength(6);
});

it.each(['note', 'section'])('keeps the first printing preview block flush after a leading %s', type => {
  const source = pmDoc(doc(block(type, 'Nonprinting'), block('action', 'Visible')));
  const pages = computePageBlocks(source, layout, { forceBreakBefore: new Set(), lineHeightMultiplier: {}, spaceBefore: { action: 2 } });
  expect(pages[0].blocks.find(b => b.typeName === 'action')!.lineStart).toBe(0);
});

it('turns at available sentence endings across a long action', () => {
  const content = Array.from({ length: 120 }, (_, i) => [
    `Line ${i}${i % 5 === 4 ? '.' : ''}`,
    ...(i < 119 ? [BR] : []),
  ]).flat();
  const source = pmDoc(doc(block('action', ...content)));
  const result = computeBreaks(source, layout);
  for (const turn of result.breaks) {
    expect(source.child(0).textContent.slice(0, turn.contentOffset).trimEnd()).toMatch(/\.$/);
  }
});

it('uses a sentence in the preceding four lines whenever a page turn can retain two lines per side', () => {
  let seed = 1;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 100; trial++) {
    const lines = Array.from({ length: 120 }, (_, i) => `Line ${i}${random() < 0.2 ? '.' : ''}`);
    const source = pmDoc(doc(block('action', ...lines.flatMap((line, i) => i < 119 ? [line, BR] : [line]))));
    const offsets = textLineOffsets(source.child(0).textContent, 62);
    const result = computeBreaks(source, layout);
    let previous = 0;
    for (const turn of result.breaks) {
      const cut = offsets.indexOf(turn.contentOffset!);
      if (!lines[cut - 1].endsWith('.')) {
        const eligible = lines.slice(Math.max(previous + 1, cut - 5), cut - 1);
        expect(eligible.some(line => line.endsWith('.')), `trial ${trial}, line ${cut}`).toBe(false);
      }
      previous = cut;
    }
  }
});

it('cuts inside wrapped prose at a sentence and shares the resulting short lines with previews', () => {
  const text = Array.from({ length: 300 }, (_, i) => `Sentence ${i} has several words before it ends.`).join(' ');
  const source = pmDoc(doc(block('action', text)));
  const natural = new Set(textLineOffsets(text, 62));
  const result = computeBreaks(source, layout);
  expect(result.breaks.some(turn => !natural.has(turn.contentOffset!))).toBe(true);
  for (const turn of result.breaks) {
    expect(text.slice(0, turn.contentOffset).trimEnd()).toMatch(/\.$/);
  }
  const fragments = paragraphFragments(text, 62);
  expect(fragments.map(part => part.text).join('')).toBe(text);
  expect(fragments.every(part => part.lines.length >= 2)).toBe(true);
  const pages = computePageBlocks(source, layout);
  expect(pages.reduce((total, page) => total + page.blocks[0].lineCount, 0))
    .toBe(fragments.reduce((total, part) => total + part.lines.length, 0));
  expect(pages.every(page => page.blocks[0].lineCount <= page.linesPerPage)).toBe(true);
});

it('retains nearby mid-line sentence endings across varied prose', () => {
  let seed = 19;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 100; trial++) {
    const text = Array.from({ length: 100 }, (_, sentence) =>
      Array.from({ length: 2 + Math.floor(random() * 30) }, (_, word) =>
        `s${sentence}w${word}`,
      ).join(' ') + '.',
    ).join(' ');
    const source = pmDoc(doc(block('action', text)));
    const result = computeBreaks(source, layout);
    const lines = paragraphFragments(text, 62).flatMap(part => part.lines);
    let previous = 0;
    for (const turn of result.breaks) {
      const cut = lines.findIndex(line => line.from === turn.contentOffset);
      if (!text.slice(0, turn.contentOffset).trimEnd().endsWith('.')) {
        const eligible = lines.slice(Math.max(previous + 1, cut - 5), cut - 1);
        expect(eligible.some(line => /\.(?:\s|$)/.test(line.text)), `trial ${trial}, line ${cut}`).toBe(false);
      }
      previous = cut;
    }
  }
});

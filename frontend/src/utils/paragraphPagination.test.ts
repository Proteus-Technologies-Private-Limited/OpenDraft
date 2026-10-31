import { describe, it, expect } from 'vitest';
import { getTextLines, textLineOffsets } from './wrapText';
import { paragraphLines, sliceParagraphRuns } from './paragraphPagination';
import {
  computeBreaks,
  getPageMetrics,
  computePageBlocks,
} from '../editor/pagination';
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
        expect(
          start === 0 || !/^[\uDC00-\uDFFF]$/.test(text[start] ?? ''),
        ).toBe(true);
    });
  it('paginates a single long action without changing any content', () => {
    const source = pmDoc(
      doc(block('action', 'A long action paragraph. '.repeat(300))),
    );
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
      doc(
        block('character', 'SARAH'),
        block('dialogue', 'A long spoken sentence. '.repeat(400)),
      ),
    );
    const result = computeBreaks(source, layout);
    expect(result.pageCount).toBeGreaterThan(3);
    expect(
      result.breaks.every(
        (b) => b.isDialogueSplit && b.characterName === 'SARAH',
      ),
    ).toBe(true);
    expect(
      result.breaks.every(
        (b) => b.linesOnPage <= getPageMetrics(layout).linesPerPage,
      ),
    ).toBe(true);
    expect(result.breaks.some((b) => b.contentOffset! > 0)).toBe(true);
  });
  it('keeps hard breaks as original inline offsets', () => {
    const source = pmDoc(
      doc(
        block(
          'action',
          ...Array.from({ length: 80 }, (_, i) => [String(i), BR]).flat(),
        ),
      ),
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

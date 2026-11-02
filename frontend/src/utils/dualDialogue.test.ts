/**
 * Dual dialogue reaches the PDF, in two columns, and takes the same room on
 * the page as it does on screen.
 *
 * It used to reach the PDF not at all: the exporter asked `jsonBlockRuns` for
 * the text of a node whose children are columns, got an empty run back, and
 * drew a blank line where the exchange should have been. The paginator had its
 * own version of the same blindness — it measured `node.textContent`, which is
 * both columns run together as a single 62-character paragraph.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

interface Draw { text: string; x: number; y: number; page: number }
const draws: Draw[] = [];
let pageCount = 1;
let currentPage = 1;

vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    setFont(font: string) { this.font = font; }
    getFont() { return { fontName: this.font, fontStyle: 'normal' }; }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    line() {}
    rect() {}
    addPage() { pageCount++; currentPage = pageCount; }
    setPage(n: number) { currentPage = n; }
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, x: number, y: number) { draws.push({ text, x, y, page: currentPage }); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});

vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => true) }));

const { exportPDF } = await import('./pdfExporter');
const { computeBreaks, activeTemplateHints } = await import('../editor/pagination');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { pmDoc } = await import('../test/screenplaySchema');
const {
  dualCharsPerLine, dualDialogueLineCount, dualChildBounds, DUAL_COLUMN_WIDTH_IN,
} = await import('./dualDialogue');

const block = (type: string, text: string): JSONContent => ({
  type, content: [{ type: 'text', text }],
});
const column = (...children: JSONContent[]): JSONContent => ({
  type: 'dualDialogueColumn', content: children,
});
const dual = (left: JSONContent[], right: JSONContent[]): JSONContent => ({
  type: 'dualDialogue', content: [column(...left), column(...right)],
});

const LEFT = 'We should go before it gets dark out there tonight, all of us.';
const RIGHT = 'I am not going anywhere until she answers me.';

const script = (): JSONContent => ({
  type: 'doc',
  content: [
    block('action', 'They argue.'),
    dual(
      [block('character', 'MAYA'), block('dialogue', LEFT)],
      [block('character', 'DECLAN'), block('dialogue', RIGHT)],
    ),
    block('action', 'Silence.'),
  ],
});

const drawn = () => draws.map((d) => d.text).join('\n');

beforeEach(() => { draws.length = 0; pageCount = 1; currentPage = 1; });

describe('the geometry follows the stylesheet', () => {
  it('splits the text column in two', () => {
    expect(DUAL_COLUMN_WIDTH_IN).toBe(3);
  });

  it('gives each element the column width its padding leaves', () => {
    // 3in less the CSS padding, at Final Draft's 10.33 characters to the inch.
    expect(dualCharsPerLine('dialogue')).toBe(27);
    expect(dualCharsPerLine('parenthetical')).toBe(25);
    expect(dualCharsPerLine('character')).toBe(23);
  });

  it('puts the second column beside the first, not below it', () => {
    const [leftCol] = dualChildBounds(0, 'dialogue');
    const [rightCol] = dualChildBounds(1, 'dialogue');
    expect(rightCol - leftCol).toBe(DUAL_COLUMN_WIDTH_IN);
  });

  it('is as deep as the deeper column, never the sum', () => {
    const short = [{ type: 'character', text: 'MAYA' }, { type: 'dialogue', text: 'Go.' }];
    const long = [
      { type: 'character', text: 'DECLAN' },
      { type: 'dialogue', text: LEFT },
      { type: 'dialogue', text: RIGHT },
    ];
    const deep = dualDialogueLineCount([long]);
    expect(dualDialogueLineCount([short, long])).toBe(deep);
    expect(dualDialogueLineCount([short, long]))
      .toBeLessThan(dualDialogueLineCount([short]) + deep);
  });
});

describe('the PDF draws both speeches', () => {
  it('writes every word of both columns', async () => {
    await exportPDF(script(), 'Dual', DEFAULT_PAGE_LAYOUT);
    expect(drawn()).toContain('MAYA');
    expect(drawn()).toContain('DECLAN');
    // Wrapped across a 27-character column, so match on words rather than the
    // whole sentence.
    for (const word of ['should', 'dark', 'tonight', 'anywhere', 'answers']) {
      expect(drawn(), `"${word}" is missing from the PDF`).toContain(word);
    }
  });

  it('puts the two speakers side by side, on one line', async () => {
    await exportPDF(script(), 'Dual', DEFAULT_PAGE_LAYOUT);
    const maya = draws.find((d) => d.text.includes('MAYA'));
    const declan = draws.find((d) => d.text.includes('DECLAN'));
    expect(maya).toBeDefined();
    expect(declan).toBeDefined();
    expect(declan!.y).toBe(maya!.y);
    expect(declan!.x - maya!.x).toBeCloseTo(DUAL_COLUMN_WIDTH_IN * 72, 5);
  });

  it('keeps every line inside its own column', async () => {
    await exportPDF(script(), 'Dual', DEFAULT_PAGE_LAYOUT);
    const mid = (1.5 + 3) * 72; // the seam between the two columns
    const leftWords = draws.filter((d) => /should|dark|tonight/.test(d.text));
    const rightWords = draws.filter((d) => /anywhere|answers/.test(d.text));
    expect(leftWords.length).toBeGreaterThan(0);
    expect(rightWords.length).toBeGreaterThan(0);
    for (const d of leftWords) expect(d.x).toBeLessThan(mid);
    for (const d of rightWords) expect(d.x).toBeGreaterThanOrEqual(mid);
  });

  it('takes the same room in the file as the editor gives it', async () => {
    // A page filled to within a few lines of the foot, then the exchange: if
    // the two measured it differently they would disagree about whether it
    // fits, and the action after it would land on different pages.
    const filler = Array.from({ length: 52 }, (_, i) => block('general', `Line ${i}`));
    const json: JSONContent = {
      type: 'doc',
      content: [
        ...filler,
        dual(
          [block('character', 'MAYA'), block('dialogue', LEFT)],
          [block('character', 'DECLAN'), block('dialogue', RIGHT)],
        ),
        block('action', 'AFTER THE EXCHANGE.'),
      ],
    };
    const { pageCount: editorPages } = computeBreaks(
      pmDoc(json), DEFAULT_PAGE_LAYOUT, activeTemplateHints(),
    );
    await exportPDF(json, 'Dual', DEFAULT_PAGE_LAYOUT);
    expect(pageCount).toBe(editorPages);
    const after = draws.find((d) => d.text.includes('AFTER THE EXCHANGE'));
    expect(after?.page).toBe(editorPages);
  });
});

const { dualRows, dualRowRuns } = await import('./dualDialogue');
const { getTextLines } = await import('./wrapText');
const { getPageMetrics, computePageBlocks } = await import('../editor/pagination');
const { startPages, lockPlan } = await import('./lockedPages');
const { linesPerPage } = getPageMetrics(DEFAULT_PAGE_LAYOUT);
const longSpeech = (prefix: string, lines: number) =>
  Array.from(
    { length: lines },
    (_, i) => `${prefix}${String(i).padStart(4, '0')} ` + 'word '.repeat(3),
  ).join('\n');
const withBreaks = (text: string): JSONContent => ({
  type: 'dialogue',
  content: text
    .split('\n')
    .flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), { type: 'text', text: line }]),
});
const oversized = (left = 130, right = 90, fill = 0): JSONContent => ({
  type: 'doc',
  content: [
    ...Array.from({ length: fill }, (_, i) => block('general', `Filler ${i}`)),
    dual(
      [block('character', 'MAYA'), withBreaks(longSpeech('LEFT', left))],
      [block('character', 'DECLAN'), withBreaks(longSpeech('RIGHT', right))],
    ),
    block('action', 'AFTER EXCHANGE'),
  ],
});

describe('oversized dual dialogue', () => {
  it.each([
    [130, 90, 0],
    [150, 2, 20],
    [2, 160, 50],
    [110, 110, 52],
  ])(
    'splits %i/%i lines after %i filler lines without dropping or repeating text',
    async (left, right, fill) => {
      const json = oversized(left, right, fill);
      const before = JSON.stringify(json);
      const pm = pmDoc(json);
      const pagination = computeBreaks(pm, DEFAULT_PAGE_LAYOUT, activeTemplateHints());
      await exportPDF(json, 'Oversized', DEFAULT_PAGE_LAYOUT);
      expect(pageCount).toBe(pagination.pageCount);
      const internal = pagination.breaks.filter((b) => b.dualRow !== undefined);
      expect(internal.length).toBeGreaterThan(0);
      expect(internal.every((b) => b.linesOnPage <= linesPerPage)).toBe(true);
      const pages = startPages(pm.childCount, pagination.breaks);
      for (const [prefix, count] of [
        ['LEFT', left],
        ['RIGHT', right],
      ] as const) {
        for (let i = 0; i < count; i++) {
          const tag = `${prefix}${String(i).padStart(4, '0')}`;
          const hit = draws.filter((d) => d.text.includes(tag));
          expect(hit, tag).toHaveLength(1);
          expect(hit[0].y).toBeLessThanOrEqual(
            DEFAULT_PAGE_LAYOUT.pageHeight * 72 - DEFAULT_PAGE_LAYOUT.bottomMargin,
          );
          const row = i + 2;
          const expected =
            internal.filter((b) => b.dualRow! <= row).at(-1)?.pageNumber ?? pages[fill];
          expect(hit[0].page, tag).toBe(expected);
        }
      }
      expect(draws.find((d) => d.text.includes('AFTER EXCHANGE'))?.page).toBe(pages[fill + 1]);
      expect(JSON.stringify(json)).toBe(before);
      expect(computePageBlocks(pm, DEFAULT_PAGE_LAYOUT, activeTemplateHints())).toHaveLength(
        pageCount,
      );
    },
  );

  it('does not repeat a finished column or give it MORE / CONT’D', async () => {
    await exportPDF(oversized(140, 2), 'Unequal', DEFAULT_PAGE_LAYOUT);
    expect(draws.filter((d) => d.text.includes('DECLAN'))).toHaveLength(1);
    expect(draws.filter((d) => d.text.includes('MAYA')).length).toBeGreaterThan(1);
    const seam = dualChildBounds(1, 'character')[0] * 72;
    expect(draws.filter((d) => d.text.includes('(MORE)')).every((d) => d.x < seam)).toBe(true);
  });

  it('honours disabled continuation labels in both renderers', async () => {
    const layout = {
      ...DEFAULT_PAGE_LAYOUT,
      moresContds: { ...DEFAULT_PAGE_LAYOUT.moresContds!, dialogueBreakContd: false },
    };
    const json = oversized();
    await exportPDF(json, 'No labels', layout);
    expect(pageCount).toBe(computeBreaks(pmDoc(json), layout, activeTemplateHints()).pageCount);
    expect(draws.some((d) => /MORE|CONT'D/.test(d.text))).toBe(false);
  });

  it('preserves the first-page anchor when a dual block crosses multiple locked sheets', () => {
    const json = oversized();
    const state = computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT);
    expect(startPages(2, state.breaks)[0]).toBe(1);
    expect(lockPlan(2, state.breaks, String).filter((p) => p.nodeIndex === 0)).toHaveLength(1);
  });

  it('keeps row offsets exact across style boundaries, hard breaks and Unicode', () => {
    const text = '  This is a long word-heavy paragraph with 中文 and 😀 characters.\nNext line.\n';
    const columns = [[{ type: 'dialogue', text }]];
    const rows = dualRows(columns);
    expect(rows).toHaveLength(getTextLines(text, dualCharsPerLine('dialogue')));
    expect(
      rows
        .flat()
        .map((c) => c.text)
        .join(''),
    ).toBe(text);
    const runs = [
      { text: text.slice(0, 15), bold: true, italic: false, underline: false },
      { text: text.slice(15), bold: false, italic: true, underline: true },
    ];
    expect(
      rows
        .flat()
        .flatMap((c) => dualRowRuns(runs, c.from, c.to))
        .map((r) => r.text)
        .join(''),
    ).toBe(text);
  });
});

const { buildFootnotePlan } = await import('./footnotes');
type NoteInfo = import('../stores/editorStore').NoteInfo;
describe('printing notes in oversized columns', () => {
  it.each(['superscript', 'bracketed'] as const)(
    'keeps %s notes with their fragment',
    async (markerStyle) => {
      const json = oversized(140, 90, 8);
      const speech = json.content![8].content![0].content![1];
      const notedRun = speech.content![120]; // a line well into the second page
      notedRun.marks = [{ type: 'scriptNote', attrs: { noteId: 'late-note', color: '#f4d35e' } }];
      const layout = {
        ...DEFAULT_PAGE_LAYOUT,
        footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true, markerStyle },
      };
      const note: NoteInfo = {
        id: 'late-note',
        content: 'Footnote follows the second fragment.',
        anchorText: '',
        elementType: 'dialogue',
        contextLabel: '',
        color: 'Yellow',
        createdAt: '2026-01-01T00:00:00Z',
        sceneId: null,
        printInScript: true,
      };
      // Supply the public pagination/export plan explicitly. The existing note
      // scanner only visits top-level inline blocks; expanding that scanner is
      // independent of splitting dual dialogue.
      const anchorDoc = { type: 'doc', content: [{ type: 'dialogue', content: [notedRun] }] };
      const plan = buildFootnotePlan(anchorDoc, layout, [note], {
        assets: [],
        assetUrl: () => null,
      });
      if (plan) {
        const ref = plan.refs[0];
        ref.srcIndex = 8;
        ref.charOffset =
          'MAYA'.length +
          speech
            .content!.slice(0, 121)
            .reduce((n, run) => n + (run.type === 'hardBreak' ? 1 : run.text!.length), 0);
        plan.refsByNode.clear();
        plan.refsByNode.set(8, [ref]);
        plan.notesForNodes = (from, to) => (from <= 8 && to >= 8 ? ['late-note'] : []);
      }
      expect(plan).not.toBeNull();
      const state = computeBreaks(pmDoc(json), layout, activeTemplateHints(), plan);
      await exportPDF(json, 'Notes', layout, { footnotes: plan });
      expect(pageCount).toBe(state.pageCount);
      const label = draws.find((d) => d.text.includes('Footnote follows'));
      const anchor = draws.find((d) => d.text.includes(notedRun.text!.trim().split(' ')[0]));
      expect(label?.page).toBe(anchor?.page);
      expect(label!.page).toBeGreaterThan(1);
      expect(state.footnotePages!.find((p) => p.noteIds.includes('late-note'))!.pageNumber).toBe(
        label?.page,
      );
    },
  );
});

it('shares soft-wrap boundaries across inline styles without adding stored breaks', async () => {
  const json = oversized(2, 2);
  const words = Array.from({ length: 480 }, (_, i) => `WORD${String(i).padStart(4, '0')}`);
  const text = words.join(' ');
  json.content![0].content![0].content![1] = {
    type: 'dialogue',
    content: [
      { type: 'text', text: text.slice(0, 73), marks: [{ type: 'bold' }] },
      { type: 'text', text: text.slice(73), marks: [{ type: 'italic' }, { type: 'underline' }] },
    ],
  };
  const state = computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT);
  await exportPDF(json, 'Soft wrap', DEFAULT_PAGE_LAYOUT);
  const rows = dualRows([
    [
      { type: 'character', text: 'MAYA' },
      { type: 'dialogue', text },
    ],
  ]);
  expect(pageCount).toBe(state.pageCount);
  for (const word of words) {
    const row = rows.findIndex((r) => r.some((c) => c.text.includes(word)));
    const hits = draws.filter((d) => d.text.includes(word));
    // A mark can split a word between draw calls, but must not change its row.
    if (hits.length === 0 && text.indexOf(word) < 73 && text.indexOf(word) + word.length > 73)
      continue;
    expect(hits, word).toHaveLength(1);
    const page =
      state.breaks.filter((b) => b.dualRow !== undefined && b.dualRow <= row).at(-1)?.pageNumber ??
      1;
    expect(hits[0].page, word).toBe(page);
  }
  expect(json.content![0].content![0].content![1].content!.every((n) => n.type === 'text')).toBe(
    true,
  );
});

it('honours a forced page start before continuing an oversized exchange', async () => {
  const json = oversized(140, 120, 10);
  json.content![10].attrs = { startsNewPage: true };
  const state = computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT);
  await exportPDF(json, 'Forced', DEFAULT_PAGE_LAYOUT);
  expect(pageCount).toBe(state.pageCount);
  expect(draws.find((d) => d.text === 'MAYA')?.page).toBe(2);
  expect(state.breaks[0]).toMatchObject({ nodeIndex: 10, linesOnPage: 10 });
  expect(state.breaks[0].dualRow).toBeUndefined();
});

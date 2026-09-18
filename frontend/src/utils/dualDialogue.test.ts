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

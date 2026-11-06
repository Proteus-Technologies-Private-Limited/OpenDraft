/**
 * Text colour, highlight and strikethrough in the PDF (#226), and the
 * remembered "Text colors and highlights" choice that switches the first two.
 *
 * jsPDF is replaced by a recorder that keeps its colour state, so each word,
 * box and line is checked against the colour it was actually drawn in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

interface Text { text: string; x: number; y: number; color: string; page: number }
interface Box { x: number; y: number; w: number; h: number; fill: string; style?: string; page: number }
interface Line { x1: number; y1: number; x2: number; y2: number; color: string; page: number }
const texts: Text[] = [];
const boxes: Box[] = [];
const lines: Line[] = [];
const order: string[] = [];
let page = 1;
let pages: string[][] = [[], []];

const hex = (r: number | string, g?: number, b?: number): string => {
  if (typeof r === 'string') return r.toLowerCase();
  return '#' + [r, g ?? r, b ?? r].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
};

vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    private textColor = '#000000';
    private fillColor = '#000000';
    private drawColor = '#000000';
    internal = { get pages() { return pages; } };
    setFont(font: string) { this.font = font; }
    getFont() { return { fontName: this.font, fontStyle: 'normal' }; }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    setTextColor(r: number | string, g?: number, b?: number) { this.textColor = hex(r, g, b); }
    getTextColor() { return this.textColor; }
    setFillColor(r: number | string, g?: number, b?: number) { this.fillColor = hex(r, g, b); }
    getFillColor() { return this.fillColor; }
    setDrawColor(r: number | string, g?: number, b?: number) { this.drawColor = hex(r, g, b); }
    getDrawColor() { return this.drawColor; }
    line(x1: number, y1: number, x2: number, y2: number) {
      lines.push({ x1, y1, x2, y2, color: this.drawColor, page });
      order.push('line');
    }
    rect(x: number, y: number, w: number, h: number, style?: string) {
      boxes.push({ x, y, w, h, fill: this.fillColor, style, page });
      order.push('rect');
    }
    addPage() { page++; pages.push([]); }
    setPage(n: number) { page = n; }
    deletePage() {}
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, x: number, y: number) {
      texts.push({ text, x, y, color: this.textColor, page });
      order.push(`text:${text}`);
      pages[page]?.push(`T ${text}`);
    }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});
vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => true) }));

const { renderPDF } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');

const txt = (text: string, ...marks: JSONContent['marks'] & object): JSONContent =>
  marks.length ? { type: 'text', text, marks } : { type: 'text', text };
const red = { type: 'textStyle', attrs: { color: '#ff0000' } };
const yellow = { type: 'highlight', attrs: { color: '#ffff66' } };
const action = (...content: JSONContent[]): JSONContent => ({ type: 'action', content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

async function render(d: JSONContent, textColors?: boolean) {
  await renderPDF(d, 'Test', DEFAULT_PAGE_LAYOUT, {
    includeTitlePage: false,
    pageNumbers: false,
    ...(textColors === undefined ? {} : { textColors }),
  });
}

/** Every drawn word whose text contains `needle`. */
const drawn = (needle: string) => texts.filter((t) => t.text.includes(needle));
/** Boxes filled as highlights — not the page furniture. */
const highlights = () => boxes.filter((b) => b.style === 'F' && b.fill !== '#000000' && b.fill !== '#ffffff');

beforeEach(() => {
  texts.length = 0;
  boxes.length = 0;
  lines.length = 0;
  order.length = 0;
  page = 1;
  pages = [[], []];
});

describe('PDF text colour', () => {
  it('draws coloured text in its colour and goes back to black after it', async () => {
    await render(doc(action(txt('Plain '), txt('hot', red), txt(' after.'))));
    expect(drawn('hot').every((t) => t.color === '#ff0000')).toBe(true);
    expect(drawn('Plain').every((t) => t.color === '#000000')).toBe(true);
    expect(drawn('after').every((t) => t.color === '#000000')).toBe(true);
  });

  it('accepts the rgb() a paste leaves behind', async () => {
    await render(doc(action(txt('pasted', { type: 'textStyle', attrs: { color: 'rgb(0, 102, 255)' } }))));
    expect(drawn('pasted')[0].color).toBe('#0066ff');
  });

  it('underlines coloured text in the same colour', async () => {
    await render(doc(action(txt('combo', red, { type: 'bold' }, { type: 'underline' }))));
    const word = drawn('combo')[0];
    const under = lines.filter((l) => Math.abs(l.y1 - (word.y + 1.5)) < 0.01);
    expect(under).toHaveLength(1);
    expect(under[0].color).toBe('#ff0000');
  });
});

describe('PDF highlight', () => {
  it('fills a box in the highlight colour behind the words, before drawing them', async () => {
    await render(doc(action(txt('Before '), txt('marked words', yellow), txt(' after.'))));
    const hl = highlights();
    expect(hl.length).toBeGreaterThan(0);
    expect(hl.every((b) => b.fill === '#ffff66')).toBe(true);
    // Painted first, so the text sits on top of it.
    const firstBox = order.indexOf('rect');
    const markedText = order.findIndex((o) => o.startsWith('text:') && o.includes('marked'));
    expect(firstBox).toBeLessThan(markedText);
    // The box spans exactly the highlighted words, edge to edge.
    const start = drawn('marked')[0].x;
    const right = Math.max(...hl.map((b) => b.x + b.w));
    expect(Math.min(...hl.map((b) => b.x))).toBeCloseTo(start, 5);
    expect(right).toBeGreaterThan(start);
    expect(drawn('after')[0].x).toBeGreaterThanOrEqual(right - 0.01);
  });

  it('highlights every line a long highlight wraps onto', async () => {
    const long = 'this highlighted passage runs long enough to wrap onto a second line of action';
    await render(doc(action(txt(long, yellow))));
    const ys = new Set(highlights().map((b) => Math.round(b.y)));
    expect(ys.size).toBeGreaterThanOrEqual(2);
  });

  it('stops at the last letter, not over the plain space wrapping hung on the word', async () => {
    await render(doc(action(txt('marked', yellow), txt(' then '), txt('gone', { type: 'strike' }), txt(' plain.'))));
    // A Courier cell is about 7.2pt; the space after each word must stay bare.
    const marked = drawn('marked')[0];
    const [box] = highlights();
    expect(box.x).toBeCloseTo(marked.x, 5);
    expect(box.w).toBeGreaterThan(0);
    expect(box.x + box.w).toBeLessThan(drawn('then')[0].x - 5);
    const gone = drawn('gone')[0];
    const strike = lines.find((l) => l.y1 < gone.y && l.y1 > gone.y - 6)!;
    expect(strike.x1).toBeCloseTo(gone.x, 5);
    expect(strike.x2).toBeLessThan(drawn('plain')[0].x - 5);
  });

  it('leaves unhighlighted text with no box at all', async () => {
    await render(doc(action(txt('Nothing marked here.'))));
    expect(highlights()).toHaveLength(0);
  });
});

describe('PDF strikethrough', () => {
  it('strikes through struck text', async () => {
    await render(doc(action(txt('Keep '), txt('gone', { type: 'strike' }))));
    const word = drawn('gone')[0];
    const strikes = lines.filter((l) => l.y1 < word.y && l.y1 > word.y - 6);
    expect(strikes).toHaveLength(1);
    expect(strikes[0].x1).toBeCloseTo(word.x, 5);
  });
});

describe('PDF without text colours', () => {
  it('prints everything black on white when switched off', async () => {
    await render(doc(action(txt('hot', red), txt(' and '), txt('marked', yellow))), false);
    expect(texts.every((t) => t.color === '#000000')).toBe(true);
    expect(highlights()).toHaveLength(0);
  });

  it('still prints bold, underline and strikethrough', async () => {
    await render(doc(action(txt('struck', red, { type: 'strike' }), txt(' '), txt('under', red, { type: 'underline' }))), false);
    const s = drawn('struck')[0];
    const u = drawn('under')[0];
    expect(lines.some((l) => l.y1 < s.y && l.y1 > s.y - 6)).toBe(true);
    expect(lines.some((l) => Math.abs(l.y1 - (u.y + 1.5)) < 0.01)).toBe(true);
    expect(lines.every((l) => l.color === '#000000')).toBe(true);
  });

  it('prints colours when the option is not given at all', async () => {
    await render(doc(action(txt('hot', red))));
    expect(drawn('hot')[0].color).toBe('#ff0000');
  });
});

describe('the remembered choice', () => {
  const KEY = 'opendraft:pdfTextColors';
  async function freshStore() {
    vi.resetModules();
    return (await import('../stores/settingsStore')).useSettingsStore;
  }
  beforeEach(() => localStorage.removeItem(KEY));

  it('is on for a writer who has never chosen', async () => {
    expect((await freshStore()).getState().pdfTextColors).toBe(true);
  });

  it('comes back as the writer left it', async () => {
    (await freshStore()).getState().setPdfTextColors(false);
    expect(localStorage.getItem(KEY)).toBe('0');
    expect((await freshStore()).getState().pdfTextColors).toBe(false);
    (await freshStore()).getState().setPdfTextColors(true);
    expect((await freshStore()).getState().pdfTextColors).toBe(true);
  });

  it('falls back to on when storage cannot be read', async () => {
    const real = localStorage.getItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      if (key === KEY) throw new Error('blocked');
      return real(key);
    });
    try {
      expect((await freshStore()).getState().pdfTextColors).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

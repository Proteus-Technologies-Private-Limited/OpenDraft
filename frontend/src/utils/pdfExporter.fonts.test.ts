/**
 * PDF export and the document font.
 *
 * The point of these tests is the promise made when fonts were made
 * exportable: a script in Courier must come out of the exporter exactly as it
 * always did.  Every indent, centring and page break in OpenDraft is built on
 * Final Draft's 10.33-characters-per-inch cell, and that arithmetic must not
 * move because the code now knows about other typefaces.
 *
 * So rather than trusting the implementation, these drive a real export
 * through a recording jsPDF stub and check the draw calls against the FD
 * numbers computed independently here.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

// --- Recording jsPDF stub -------------------------------------------------

interface DrawCall {
  text: string;
  x: number;
  y: number;
  charSpace: number;
  font: string;
  style: string;
}

const draws: DrawCall[] = [];

/**
 * Widths the stub reports, chosen so a proportional face is unmistakably not
 * the 6.97pt Courier cell: 5pt per character, flat.
 */
const STUB_PROPORTIONAL_WIDTH_PER_CHAR = 5;
/** What jsPDF's own Courier measures 'M' at, before charSpace correction. */
const STUB_COURIER_M = 7.2;
/** And the embedded fallback, at a width of its own so the correction is visibly measured. */
const STUB_UNICODE_M = 7.5;

vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    private style = 'normal';
    constructor() {}
    setFont(font: string, style = 'normal') { this.font = font; this.style = style; }
    getFont() { return { fontName: this.font, fontStyle: this.style }; }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    line() {}
    addPage() {}
    setPage() {}
    addImage() {}
    getTextWidth(text: string) {
      if (this.font === 'courier') return STUB_COURIER_M * text.length;
      if (this.font === UNICODE_FONT_ID) return STUB_UNICODE_M * text.length;
      return STUB_PROPORTIONAL_WIDTH_PER_CHAR * text.length;
    }
    text(text: string, x: number, y: number, opts?: { charSpace?: number }) {
      draws.push({ text, x, y, charSpace: opts?.charSpace ?? 0, font: this.font, style: this.style });
    }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});

// saveFile reaches for Tauri; the bytes are irrelevant here.
vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => {}) }));

// The fallback is fetched from public/fonts; its bytes do not matter to the stub.
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => new Uint8Array([0, 1, 0, 0]).buffer,
})));

const { UNICODE_FONT_ID } = await import('./pdfUnicodeFont');

const { exportPDF } = await import('./pdfExporter');
const { pdfFontFor } = await import('./pdfExporter');

// --- Final Draft constants, restated independently of the exporter ---------

const PTS_PER_INCH = 72;
const FD_CPI = 10.33;
const FD_CHAR_WIDTH_PT = PTS_PER_INCH / FD_CPI;
const LINE_HEIGHT_PT = 12;

/** A run of text with an optional font mark. */
const text = (s: string, font?: string): JSONContent => ({
  type: 'text',
  text: s,
  ...(font ? { marks: [{ type: 'textStyle', attrs: { fontFamily: font } }] } : {}),
});

const script: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('INT. LIBRARY - DAY')] },
    { type: 'action', content: [text('A PROGRAMMER types.')] },
    { type: 'character', content: [text('PROGRAMMER')] },
    { type: 'dialogue', content: [text('Eureka.')] },
    { type: 'transition', content: [text('CUT TO:')] },
  ],
};

async function run(documentFont?: string, doc: JSONContent = script): Promise<DrawCall[]> {
  draws.length = 0;
  await exportPDF(doc, 'Test', DEFAULT_PAGE_LAYOUT, documentFont ? { documentFont } : undefined);
  return [...draws];
}

const bodyOf = (calls: DrawCall[]) => calls.filter((c) => script.content!.some(
  (n) => (n.content?.[0].text ?? '') === c.text,
));

beforeEach(() => { draws.length = 0; });

describe('a Courier script is exported exactly as before', () => {
  it('draws every element in Courier at the Final Draft cell', async () => {
    const calls = bodyOf(await run());

    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call.font).toBe('courier');
      // charSpace stretches jsPDF's Courier to the 10.33-CPI cell.
      expect(call.charSpace).toBeCloseTo(FD_CHAR_WIDTH_PT - STUB_COURIER_M, 10);
    }
  });

  it('places left-aligned elements at their Final Draft indents', async () => {
    const calls = bodyOf(await run());
    const at = (t: string) => calls.find((c) => c.text === t)!;

    expect(at('INT. LIBRARY - DAY').x).toBeCloseTo(1.50 * PTS_PER_INCH, 10);
    expect(at('A PROGRAMMER types.').x).toBeCloseTo(1.50 * PTS_PER_INCH, 10);
    expect(at('PROGRAMMER').x).toBeCloseTo(3.50 * PTS_PER_INCH, 10);
    expect(at('Eureka.').x).toBeCloseTo(2.50 * PTS_PER_INCH, 10);
  });

  it('right-aligns a transition on the character cell, not on measurement', async () => {
    const transition = bodyOf(await run()).find((c) => c.text === 'CUT TO:')!;
    // FD right indent for a transition is 7.50in.
    const expected = 7.50 * PTS_PER_INCH - 'CUT TO:'.length * FD_CHAR_WIDTH_PT;
    expect(transition.x).toBeCloseTo(expected, 10);
  });

  it('is unchanged when the document font is named as a Courier', async () => {
    const plain = await run();
    for (const name of ['Courier Prime', 'Courier New', 'Courier Final Draft', 'Courier Screenplay']) {
      expect(await run(name), name).toEqual(plain);
    }
  });
});

describe('a script in another face is exported in it', () => {
  it('draws the whole script in the mapped face, at its own advances', async () => {
    const calls = bodyOf(await run('Times New Roman'));

    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call.font).toBe('times');
      // Courier's cell correction would scatter a proportional face.
      expect(call.charSpace).toBe(0);
    }
  });

  it('keeps the Final Draft line boxes — same lines, same vertical rhythm', async () => {
    const courier = bodyOf(await run());
    const times = bodyOf(await run('Times New Roman'));

    expect(times.map((c) => c.y)).toEqual(courier.map((c) => c.y));
    expect(times.map((c) => c.x)).toEqual(courier.map((c) => c.x).map((x, i) =>
      // Only the right-aligned transition moves: it is measured now.
      times[i].text === 'CUT TO:' ? times[i].x : x));
  });

  it('right-aligns a transition on its measured width', async () => {
    const transition = bodyOf(await run('Times New Roman')).find((c) => c.text === 'CUT TO:')!;
    const expected = 7.50 * PTS_PER_INCH - 'CUT TO:'.length * STUB_PROPORTIONAL_WIDTH_PER_CHAR;
    expect(transition.x).toBeCloseTo(expected, 10);
  });
});

describe('a section styled with its own font', () => {
  const mixed: JSONContent = {
    type: 'doc',
    content: [
      { type: 'action', content: [text('Plain action.')] },
      { type: 'action', content: [text('Styled action.', 'Georgia')] },
    ],
  };

  it('draws only that run in its face, leaving the rest on the document font', async () => {
    const calls = await run(undefined, mixed);
    const plain = calls.find((c) => c.text === 'Plain action.')!;
    const styled = calls.find((c) => c.text === 'Styled action.')!;

    expect(plain.font).toBe('courier');
    expect(plain.charSpace).toBeCloseTo(FD_CHAR_WIDTH_PT - STUB_COURIER_M, 10);
    expect(styled.font).toBe('times'); // Georgia → the closest embedded face
    expect(styled.charSpace).toBe(0);
    // Both still start at the Action indent, on consecutive line boxes.
    expect(styled.x).toBeCloseTo(plain.x, 10);
    expect(styled.y - plain.y).toBeCloseTo(2 * LINE_HEIGHT_PT, 10); // 1 blank line before Action
  });

  it('overrides a non-Courier document font for that run', async () => {
    const calls = await run('Times New Roman', {
      type: 'doc',
      content: [{ type: 'action', content: [text('Sans run.', 'Arial')] }],
    });
    expect(calls.find((c) => c.text === 'Sans run.')!.font).toBe('helvetica');
  });
});


/**
 * A script in Cyrillic (issue #71).
 *
 * The built-in faces cannot encode it, so it is drawn in the embedded
 * fallback — and, since that fallback is monospace, on the very same Final
 * Draft cell.  The proof is the Latin script above: character for character,
 * the two must land in identical places.
 */
describe('a script the built-in faces cannot write', () => {
  const cyrillic: JSONContent = {
    type: 'doc',
    content: [
      { type: 'sceneHeading', content: [text('ИНТ. БИБЛИОТЕКА')] },
      { type: 'action', content: [text('ПРОГРАММИСТ печатает.')] },
      { type: 'transition', content: [text('УХОД:')] },
    ],
  };
  /** The same script, character for character, in Latin. */
  const transliterated: JSONContent = {
    type: 'doc',
    content: [
      { type: 'sceneHeading', content: [text('INT. BIBLIOTEKAA')] },
      { type: 'action', content: [text('PROGRAMMIST pechataet.')] },
      { type: 'transition', content: [text('UHOD:')] },
    ],
  };
  const drawnText = (calls: DrawCall[]) => calls.filter((c) => c.text.trim().length > 0);

  it('draws it in the embedded face, at that face\'s own cell correction', async () => {
    const calls = drawnText(await run(undefined, cyrillic));

    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call.font).toBe(UNICODE_FONT_ID);
      expect(call.charSpace).toBeCloseTo(FD_CHAR_WIDTH_PT - STUB_UNICODE_M, 10);
    }
  });

  it('lands on exactly the Final Draft geometry the Latin script does', async () => {
    const cyr = drawnText(await run(undefined, cyrillic));
    const lat = drawnText(await run(undefined, transliterated));

    expect(cyr.map((c) => c.x)).toEqual(lat.map((c) => c.x));
    expect(cyr.map((c) => c.y)).toEqual(lat.map((c) => c.y));
  });

  it('keeps the type styles — a scene heading is still bold', async () => {
    const heading = drawnText(await run(undefined, cyrillic))[0];
    expect(heading.style).toBe('bold');
  });

  it('leaves the Latin parts of a mixed script in the document face', async () => {
    const mixed: JSONContent = {
      type: 'doc',
      content: [
        { type: 'action', content: [text('A Latin line.')] },
        { type: 'action', content: [text('Строка кириллицей.')] },
      ],
    };
    const calls = await run(undefined, mixed);
    const latin = calls.find((c) => c.text === 'A Latin line.')!;
    const cyr = calls.find((c) => c.text === 'Строка кириллицей.')!;

    expect(latin.font).toBe('courier');
    expect(latin.charSpace).toBeCloseTo(FD_CHAR_WIDTH_PT - STUB_COURIER_M, 10);
    expect(cyr.font).toBe(UNICODE_FONT_ID);
    expect(cyr.x).toBeCloseTo(latin.x, 10);
  });

  it('right-aligns a Cyrillic transition on the cell, as Final Draft does', async () => {
    const transition = drawnText(await run(undefined, cyrillic)).find((c) => c.text === 'УХОД:')!;
    const expected = 7.50 * PTS_PER_INCH - 'УХОД:'.length * FD_CHAR_WIDTH_PT;
    expect(transition.x).toBeCloseTo(expected, 10);
  });
});

describe('pdfFontFor', () => {
  it('keeps every Courier — and an unnamed font — on Courier', () => {
    for (const name of [undefined, '', 'Courier', 'Courier Prime', 'Courier New',
      'Courier Final Draft', 'Courier Screenplay', 'DejaVu Sans Mono']) {
      expect(pdfFontFor(name), String(name)).toBe('courier');
    }
  });

  it('maps serif faces to Times and everything else to Helvetica', () => {
    expect(pdfFontFor('Times New Roman')).toBe('times');
    expect(pdfFontFor('Georgia')).toBe('times');
    expect(pdfFontFor('Noto Serif')).toBe('times');
    expect(pdfFontFor('Arial')).toBe('helvetica');
    expect(pdfFontFor('Verdana')).toBe('helvetica');
    expect(pdfFontFor('Trebuchet MS')).toBe('helvetica');
  });
});

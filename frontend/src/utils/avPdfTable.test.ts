/**
 * AV table geometry and pagination for the PDF.
 *
 * The rule that matters here is row-level pagination: a shot whose video and
 * audio are split across a page boundary is unreadable on set, so a row that
 * does not fit moves whole. The exception is a row taller than a page, which
 * has nowhere to move and must be allowed to draw where it stands rather than
 * loop forever.
 */
import { describe, it, expect, vi } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { layoutAvColumns, wrapCell, drawAvBody, avRowNodes, avFrameKey, type AvPdfContext } from './avPdfTable';
import { extractAvBodies } from './avDocument';

const cell = (side: 'video' | 'audio', ...lines: string[]): JSONContent => ({
  type: 'avCell',
  attrs: { side },
  content: lines.map(l => ({ type: 'avPara', content: l ? [{ type: 'text', text: l }] : [] })),
});

const row = (opts: { video?: string[]; audio?: string[]; duration?: string | null; image?: Record<string, unknown> | null }): JSONContent => ({
  type: 'avRow',
  attrs: { duration: opts.duration ?? null, shot: null, start: null },
  content: [
    cell('video', ...(opts.video ?? [''])),
    cell('audio', ...(opts.audio ?? [''])),
    ...(opts.image ? [{ type: 'avImage', attrs: opts.image } as JSONContent] : []),
  ],
});

const block = (rows: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
  type: 'avBlock', ...(attrs ? { attrs } : {}), content: rows,
});

const bodyOf = (b: JSONContent) => extractAvBodies({ type: 'doc', content: [b] })[0];

const WIDTHS = { cue: 0.5, video: 2, audio: 2, image: 1.5 };

/** A context that records what was drawn instead of touching jsPDF. */
function makeCtx(overrides?: Partial<AvPdfContext>) {
  let y = 72;
  const drawn: { text: string; x: number; y: number }[] = [];
  const pages: number[] = [];
  const ctx: AvPdfContext = {
    pdf: { setLineWidth: vi.fn(), line: vi.fn(), rect: vi.fn(), addImage: vi.fn() } as never,
    drawLine: (line, x, yy) => drawn.push({ text: line.map(r => r.text || '').join(''), x, y: yy }),
    charWidthPt: 7,
    lineHeightPt: 12,
    leftPt: 72,
    contentWidthPt: 468,
    topMarginPt: 72,
    bottomMarginPt: 72,
    pageHeightPt: 792,
    getY: () => y,
    setY: (v) => { y = v; },
    newPage: () => { pages.push(y); y = 72; },
    ...overrides,
  };
  return { ctx, drawn, pages, getY: () => y };
}

describe('layoutAvColumns', () => {
  it('lays out only the columns that are on, left to right', () => {
    const body = bodyOf(block([row({})]));
    const cols = layoutAvColumns(body, WIDTHS, 72, 468);
    expect(cols.map(c => c.key)).toEqual(['cue', 'video', 'audio']);
    expect(cols[0].xPt).toBe(72);
    // Columns advance and never overlap.
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i].xPt).toBeGreaterThan(cols[i - 1].xPt + cols[i - 1].widthPt - 0.01);
    }
  });

  it('adds the storyboard column when the body has one', () => {
    const body = bodyOf(block([row({})], { columns: { cue: true, image: true } }));
    expect(layoutAvColumns(body, WIDTHS, 72, 468).map(c => c.key))
      .toEqual(['cue', 'video', 'audio', 'image']);
  });

  it('widens the remaining columns when one is switched off, leaving no gap', () => {
    const withCue = layoutAvColumns(bodyOf(block([row({})])), WIDTHS, 72, 468);
    const noCue = layoutAvColumns(
      bodyOf(block([row({})], { columns: { cue: false, image: false } })), WIDTHS, 72, 468,
    );
    const videoWith = withCue.find(c => c.key === 'video')!.widthPt;
    const videoWithout = noCue.find(c => c.key === 'video')!.widthPt;
    expect(videoWithout).toBeGreaterThan(videoWith);
    // Total still fills the content width (allowing for inter-column gaps).
    const last = noCue[noCue.length - 1];
    expect(last.xPt + last.widthPt).toBeCloseTo(72 + 468, 1);
  });

  it('uses the header labels from the body', () => {
    const body = bodyOf(block([row({})], { headers: { video: 'Visual' } }));
    expect(layoutAvColumns(body, WIDTHS, 72, 468).find(c => c.key === 'video')!.header).toBe('Visual');
  });
});

describe('wrapCell', () => {
  it('wraps to the column width and keeps paragraphs apart', () => {
    const c = cell('video', 'one two three four five six', 'second para');
    const lines = wrapCell(c, 10);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.map(l => l.map(r => r.text).join('')).join(' ')).toContain('second');
  });

  it('uppercases a shot line, as the editor renders it', () => {
    const c: JSONContent = {
      type: 'avCell', attrs: { side: 'video' },
      content: [{ type: 'avShot', content: [{ type: 'text', text: 'wide on street' }] }],
    };
    expect(wrapCell(c, 40)[0].map(r => r.text).join('')).toBe('WIDE ON STREET');
  });

  it('returns nothing for an empty or missing cell', () => {
    expect(wrapCell(null, 40)).toEqual([]);
    expect(wrapCell(cell('video', ''), 40)).toEqual([]);
  });
});

describe('avFrameKey', () => {
  it('prefers the asset id so preload and draw agree', () => {
    expect(avFrameKey({ assetId: 'a1', src: 's.png' })).toBe('a1');
    expect(avFrameKey({ src: 's.png' })).toBe('s.png');
    expect(avFrameKey(null)).toBe('');
  });

  it('keys a scratch-stored frame by its scratch id', () => {
    // A frame added before the document has a project has no asset id and no
    // src at all. Falling through to '' meant the preload pass keyed it one way
    // and the draw pass another, and every such frame printed as an empty slot.
    expect(avFrameKey({ scratchId: 's1' })).toBe('s1');
    expect(avFrameKey({ assetId: 'a1', scratchId: 's1' })).toBe('a1');
  });
});

describe('drawAvBody', () => {
  it('draws a header row then one block per shot', () => {
    const b = block([row({ video: ['WIDE'], audio: ['V.O.'], duration: '0:05' })]);
    const { ctx, drawn } = makeCtx();
    drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: true });
    const texts = drawn.map(d => d.text);
    expect(texts).toContain('Video');
    expect(texts).toContain('Audio');
    expect(texts).toContain('WIDE');
    expect(texts).toContain('V.O.');
    // Cue column carries the derived shot number and start.
    expect(texts).toContain('1.');
    expect(texts).toContain('0:00');
  });

  it('wraps a header into its own column instead of printing over the next one', () => {
    // "Shot / Time" is wider than the cue column it labels — the cue track is
    // 0.5 units against video and audio's 2 — so drawn as one unwrapped line it
    // printed straight over the "Video" header beside it.
    const b = block(
      [row({ video: ['WIDE'], audio: ['V.O.'], duration: '0:05' })],
      { columns: { cue: true, image: true } },
    );
    const body = bodyOf(b);
    const { ctx, drawn } = makeCtx();
    drawAvBody(ctx, body, avRowNodes(b), { widths: WIDTHS, repeatHeaders: true });

    const cols = layoutAvColumns(body, WIDTHS, ctx.leftPt, ctx.contentWidthPt);
    const cue = cols.find(c => c.key === 'cue')!;
    // The setup only means anything if the label really cannot fit on one line.
    expect(body.headers.cue.length * ctx.charWidthPt).toBeGreaterThan(cue.widthPt);
    expect(drawn.map(d => d.text)).not.toContain(body.headers.cue);

    // Nothing drawn in a column may reach the next column's x. The total
    // runtime is excluded: it sits UNDER the table and is meant to run full
    // width, so it starts at the first column's x without belonging to it.
    for (const d of drawn) {
      if (d.text.startsWith('Total runtime:')) continue;
      const i = cols.findIndex(c => Math.abs(c.xPt - d.x) < 0.001);
      if (i < 0) continue;
      const room = cols[i + 1] ? cols[i + 1].xPt - cols[i].xPt : cols[i].widthPt;
      expect(d.text.length * ctx.charWidthPt).toBeLessThanOrEqual(room);
    }
  });

  it('keeps a row whole: it breaks the page rather than splitting a shot', () => {
    // Rows tall enough that the third cannot fit on the first page.
    const tall = () => row({ video: Array.from({ length: 30 }, (_, i) => `line ${i}`) });
    const b = block([tall(), tall(), tall()]);
    const { ctx, pages } = makeCtx();
    drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: true });
    expect(pages.length).toBeGreaterThan(0);
  });

  it('repeats the header on each new page when asked', () => {
    const tall = () => row({ video: Array.from({ length: 30 }, (_, i) => `line ${i}`) });
    const b = block([tall(), tall(), tall()]);
    const { ctx, drawn } = makeCtx();
    drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: true });
    expect(drawn.filter(d => d.text === 'Video').length).toBeGreaterThan(1);
  });

  it('does not repeat the header when told not to', () => {
    const tall = () => row({ video: Array.from({ length: 30 }, (_, i) => `line ${i}`) });
    const b = block([tall(), tall(), tall()]);
    const { ctx, drawn } = makeCtx();
    drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: false });
    expect(drawn.filter(d => d.text === 'Video')).toHaveLength(1);
  });

  it('draws a row taller than a page where it stands instead of looping forever', () => {
    const huge = row({ video: Array.from({ length: 400 }, (_, i) => `line ${i}`) });
    const b = block([huge]);
    const { ctx, pages } = makeCtx();
    // The real assertion is that this returns at all.
    expect(() => drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: true })).not.toThrow();
    expect(pages.length).toBeLessThan(3);
  });

  it('places a loaded storyboard frame, and outlines an empty slot', () => {
    const b = block(
      [row({ video: ['V'], image: { src: 'f.png', aspect: '16:9' } }), row({ video: ['V2'], image: { src: null, aspect: '16:9' } })],
      { columns: { cue: true, image: true } },
    );
    const images = new Map([['f.png', { dataUrl: 'data:image/png;base64,AA', width: 160, height: 90 }]]);
    const { ctx } = makeCtx({ images });
    drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: true });
    expect(ctx.pdf.addImage).toHaveBeenCalledTimes(1);
    // The empty frame still reserves its slot rather than collapsing the row.
    expect(ctx.pdf.rect).toHaveBeenCalled();
  });

  it('writes the total runtime under the table', () => {
    const b = block([row({ video: ['V'], duration: '0:30' }), row({ video: ['V'], duration: '0:30' })]);
    const { ctx, drawn } = makeCtx();
    drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: true });
    expect(drawn.map(d => d.text)).toContain('Total runtime: 1:00');
  });

  it('omits the total when nothing is timed', () => {
    const b = block([row({ video: ['V'] })]);
    const { ctx, drawn } = makeCtx();
    drawAvBody(ctx, bodyOf(b), avRowNodes(b), { widths: WIDTHS, repeatHeaders: true });
    expect(drawn.some(d => d.text.startsWith('Total runtime'))).toBe(false);
  });
});

describe('avRowNodes', () => {
  it('pairs each row’s video, audio and frame nodes', () => {
    const b = block([row({ video: ['V'], audio: ['A'], image: { src: 'f.png' } })]);
    const n = avRowNodes(b);
    expect(n).toHaveLength(1);
    expect(n[0].video?.attrs?.side).toBe('video');
    expect(n[0].audio?.attrs?.side).toBe('audio');
    expect(n[0].image?.type).toBe('avImage');
  });

  it('reports no frame for a legacy two-cell row', () => {
    expect(avRowNodes(block([row({ video: ['V'] })]))[0].image).toBeNull();
  });
});

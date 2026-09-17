/**
 * AV export — extraction, CSV, XLSX and plain text.
 *
 * The spreadsheet is the interchange format because the industry has no
 * structured AV/shot-list standard: FDX, Fountain and OSF are built around
 * screenplay elements, while production tools (Movie Magic Scheduling,
 * StudioBinder) exchange CSV and xlsx. These pin that the grid every writer
 * emits is the same one, so a PDF and a spreadsheet cannot disagree about what
 * a row says.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { extractAvBodies, hasAvContent, avBodyToGrid, AV_DEFAULT_HEADERS } from './avDocument';
import {
  avDocumentToCsv,
  avDocumentToXlsx,
  avDocumentToText,
  gridToCsv,
  columnName,
  safeSheetName,
} from './avSpreadsheet';

const cell = (side: 'video' | 'audio', ...lines: string[]) => ({
  type: 'avCell',
  attrs: { side },
  content: lines.map(l => ({ type: 'avPara', content: l ? [{ type: 'text', text: l }] : [] })),
});

const row = (opts: {
  video?: string[]; audio?: string[]; duration?: string | null; shot?: string | null; start?: string | null;
  image?: Record<string, unknown> | null;
}): JSONContent => ({
  type: 'avRow',
  attrs: { duration: opts.duration ?? null, shot: opts.shot ?? null, start: opts.start ?? null },
  content: [
    cell('video', ...(opts.video ?? [''])),
    cell('audio', ...(opts.audio ?? [''])),
    ...(opts.image ? [{ type: 'avImage', attrs: opts.image }] : []),
  ],
});

const doc = (rows: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
  type: 'doc',
  content: [{ type: 'avBlock', ...(attrs ? { attrs } : {}), content: rows }],
});

describe('extractAvBodies', () => {
  it('resolves cue values the same way the editor does', () => {
    const b = extractAvBodies(doc([
      row({ video: ['WIDE'], audio: ['V.O.'], duration: '0:05' }),
      row({ video: ['CU'], audio: ['SFX'], duration: '0:10' }),
    ]))[0];
    expect(b.rows.map(r => r.shot)).toEqual(['1.', '2.']);
    expect(b.rows.map(r => r.start)).toEqual(['0:00', '0:05']);
    expect(b.totalFormatted).toBe('0:15');
  });

  it('joins a multi-paragraph cell with newlines and drops trailing blanks', () => {
    const b = extractAvBodies(doc([row({ video: ['one', 'two', ''] })]))[0];
    expect(b.rows[0].video).toBe('one\ntwo');
  });

  it('defaults a legacy body to cue on, storyboard off', () => {
    const b = extractAvBodies(doc([row({})]))[0];
    expect(b.columns).toEqual({ cue: true, image: false });
    expect(b.headers).toEqual(AV_DEFAULT_HEADERS);
  });

  it('reads custom headers when a body sets them', () => {
    const b = extractAvBodies(doc([row({})], { headers: { video: 'Visual' } }))[0];
    expect(b.headers.video).toBe('Visual');
    expect(b.headers.audio).toBe('Audio');
  });

  it('finds every AV body in a document, not just the first', () => {
    const d = {
      type: 'doc',
      content: [
        { type: 'avBlock', content: [row({ video: ['a'] })] },
        { type: 'action', content: [{ type: 'text', text: 'interlude' }] },
        { type: 'avBlock', content: [row({ video: ['b'] })] },
      ],
    };
    expect(extractAvBodies(d)).toHaveLength(2);
  });

  it('reports whether a document has AV content at all', () => {
    expect(hasAvContent(doc([row({})]))).toBe(true);
    expect(hasAvContent({ type: 'doc', content: [{ type: 'action' }] })).toBe(false);
    expect(hasAvContent(null)).toBe(false);
  });

  it('survives a malformed document without throwing', () => {
    expect(() => extractAvBodies({ type: 'doc', content: [{ type: 'avBlock' }] })).not.toThrow();
    expect(() => extractAvBodies(undefined)).not.toThrow();
  });
});

describe('avBodyToGrid', () => {
  it('emits only the columns that are on', () => {
    const b = extractAvBodies(doc([row({ video: ['V'], audio: ['A'], duration: '0:05' })]))[0];
    const grid = avBodyToGrid(b);
    expect(grid[0]).toEqual(['Shot / Time', 'Duration', 'Video', 'Audio']);
    expect(grid[1]).toEqual(['1. 0:00', '0:05', 'V', 'A']);
  });

  it('carries a frame’s whole asset reference, not just its id', () => {
    // The exporters resolve a frame from these fields and key their preloaded
    // images off them; an id without its project resolves to nothing.
    const b = extractAvBodies(doc(
      [row({ video: ['V'], image: { assetId: 'a1', projectId: 'p1', filename: 'frame.png', aspect: '4:3' } })],
      { columns: { cue: true, image: true } },
    ))[0];
    expect(b.rows[0].image).toEqual({
      src: null, alt: null, assetId: 'a1', projectId: 'p1', scratchId: null, filename: 'frame.png', aspect: '4:3',
    });

    const scratch = extractAvBodies(doc(
      [row({ video: ['V'], image: { scratchId: 's1', filename: 'frame.png' } })],
      { columns: { cue: true, image: true } },
    ))[0];
    expect(scratch.rows[0].image!.scratchId).toBe('s1');
    expect(scratch.rows[0].image!.aspect).toBe('16:9');
  });

  it('adds the storyboard column when the body has one', () => {
    const b = extractAvBodies(
      doc([row({ video: ['V'], image: { src: 'f.png', alt: 'Frame 1', aspect: '16:9' } })], { columns: { cue: true, image: true } }),
    )[0];
    const grid = avBodyToGrid(b);
    expect(grid[0]).toContain('Storyboard');
    expect(grid[1][grid[1].length - 1]).toBe('Frame 1');
  });

  it('drops the cue columns when the cue column is off', () => {
    const b = extractAvBodies(doc([row({ video: ['V'], audio: ['A'] })], { columns: { cue: false, image: false } }))[0];
    expect(avBodyToGrid(b)[0]).toEqual(['Video', 'Audio']);
  });
});

describe('CSV', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    expect(gridToCsv([['plain', 'a,b', 'say "hi"', 'one\ntwo']]))
      .toBe('plain,"a,b","say ""hi""","one\ntwo"');
  });

  it('writes a header row and one row per shot', () => {
    const csv = avDocumentToCsv(doc([
      row({ video: ['WIDE'], audio: ['V.O. Hello'], duration: '0:05' }),
    ]));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Shot / Time,Duration,Video,Audio');
    expect(lines[1]).toBe('1. 0:00,0:05,WIDE,V.O. Hello');
  });

  it('separates multiple bodies rather than implying one continuous list', () => {
    const d = {
      type: 'doc',
      content: [
        { type: 'avBlock', content: [row({ video: ['a'] })] },
        { type: 'avBlock', content: [row({ video: ['b'] })] },
      ],
    };
    expect(avDocumentToCsv(d)).toContain('\r\n\r\n');
  });

  it('returns empty string for a document with no AV content', () => {
    expect(avDocumentToCsv({ type: 'doc', content: [] })).toBe('');
  });
});

describe('XLSX', () => {
  it('names columns the way a spreadsheet does', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
  });

  it('keeps sheet names legal for Excel', () => {
    expect(safeSheetName('A/B:C', 'x')).toBe('A B C');
    expect(safeSheetName('', 'fallback')).toBe('fallback');
    expect(safeSheetName('x'.repeat(50), 'f')).toHaveLength(31);
  });

  it('returns null when there is no AV content, rather than an empty workbook', async () => {
    expect(await avDocumentToXlsx({ type: 'doc', content: [] })).toBeNull();
  });

  it('writes a zip carrying the parts Excel requires', async () => {
    const blob = await avDocumentToXlsx(doc([row({ video: ['WIDE'], audio: ['V.O.'], duration: '0:05' })]));
    expect(blob).toBeTruthy();
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(zip.file(part), `missing ${part}`).toBeTruthy();
    }
  });

  it('puts the cell text in the sheet, XML-escaped', async () => {
    const blob = await avDocumentToXlsx(doc([row({ video: ['A & B <fast>'], audio: ['"quoted"'] })]));
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer());
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('A &amp; B &lt;fast&gt;');
    expect(sheet).toContain('&quot;quoted&quot;');
    // Header row present and frozen so headers survive scrolling.
    expect(sheet).toContain('Video');
    expect(sheet).toContain('state="frozen"');
  });

  it('gives each AV body its own uniquely named sheet', async () => {
    const d = {
      type: 'doc',
      content: [
        { type: 'avBlock', content: [row({ video: ['a'] })] },
        { type: 'avBlock', content: [row({ video: ['b'] })] },
      ],
    };
    const zip = await JSZip.loadAsync(await (await avDocumentToXlsx(d))!.arrayBuffer());
    expect(zip.file('xl/worksheets/sheet1.xml')).toBeTruthy();
    expect(zip.file('xl/worksheets/sheet2.xml')).toBeTruthy();
    const wb = await zip.file('xl/workbook.xml')!.async('string');
    expect(wb).toContain('AV 1');
    expect(wb).toContain('AV 2');
  });
});

describe('plain text', () => {
  it('writes a labelled block per shot rather than fragile column art', () => {
    const txt = avDocumentToText(doc([
      row({ video: ['WIDE ON STREET'], audio: ['NARRATOR: Hello'], duration: '0:05' }),
    ]));
    expect(txt).toContain('1.  0:00  (0:05)');
    expect(txt).toContain('VIDEO: WIDE ON STREET');
    expect(txt).toContain('AUDIO: NARRATOR: Hello');
    expect(txt).toContain('Total runtime: 0:05');
  });

  it('returns empty string with no AV content', () => {
    expect(avDocumentToText({ type: 'doc', content: [] })).toBe('');
  });
});

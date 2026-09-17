/**
 * AV import — CSV, xlsx and the fuzzy column mapping.
 *
 * The mapping is the part that earns its keep. A sheet from another production
 * will not use OpenDraft's header names, so requiring an exact match would
 * reject nearly every real file; these pin that the common synonyms land in the
 * right columns and that an unrecognisable one is dropped rather than guessed.
 */
import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  columnIndex,
  readXlsxGrid,
  guessColumnRoles,
  looksLikeHeader,
  splitCueCell,
  splitGridSections,
  gridToAvBlock,
  importAvCsv,
  importAvXlsx,
} from './avImport';
import { avDocumentToXlsx, avDocumentToCsv } from './avSpreadsheet';
import { extractAvBodies } from './avDocument';

describe('parseCsv', () => {
  it('reads a plain grid', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps a newline inside a quoted cell as one cell', () => {
    // A line of narration wrapped over two lines is one cell, not two rows.
    expect(parseCsv('a,"one\ntwo"\nc,d')).toEqual([['a', 'one\ntwo'], ['c', 'd']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a,"say ""hi"""')).toEqual([['a', 'say "hi"']]);
  });

  it('handles CRLF and a missing final newline', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
  });

  it('keeps empty cells, which are meaningful in an AV sheet', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv(null as never)).toEqual([]);
  });
});

describe('columnIndex', () => {
  it('maps spreadsheet refs to indices', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('B2')).toBe(1);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('')).toBe(0);
  });
});

describe('guessColumnRoles', () => {
  it('maps OpenDraft’s own headers', () => {
    expect(guessColumnRoles(['Shot / Time', 'Duration', 'Video', 'Audio', 'Storyboard']))
      .toEqual(['shot', 'duration', 'video', 'audio', 'image']);
  });

  it('maps another production’s synonyms', () => {
    expect(guessColumnRoles(['Visual', 'Sound'])).toEqual(['video', 'audio']);
    expect(guessColumnRoles(['Picture', 'Narration'])).toEqual(['video', 'audio']);
    expect(guessColumnRoles(['VISION', 'VO'])).toEqual(['video', 'audio']);
  });

  it('reads a duration column however it is labelled', () => {
    expect(guessColumnRoles(['Length'])[0]).toBe('duration');
    expect(guessColumnRoles(['Run Time'])[0]).toBe('duration');
    expect(guessColumnRoles(['Secs'])[0]).toBe('duration');
  });

  it('does not assign the same role twice', () => {
    const roles = guessColumnRoles(['Video', 'Video Notes', 'Audio']);
    expect(roles.filter(r => r === 'video')).toHaveLength(1);
  });

  it('falls back to video/audio when nothing is recognisable', () => {
    // A two-column sheet with opaque headers is almost certainly classic AV.
    expect(guessColumnRoles(['Col1', 'Col2'])).toEqual(['video', 'audio']);
  });
});

describe('looksLikeHeader', () => {
  it('accepts a row of column names', () => {
    expect(looksLikeHeader(['Shot', 'Video', 'Audio'])).toBe(true);
  });

  it('rejects a row that carries data', () => {
    expect(looksLikeHeader(['1.', '0:05', 'WIDE', 'V.O.'])).toBe(false);
  });

  it('rejects an empty row', () => {
    expect(looksLikeHeader([])).toBe(false);
  });

  it('rejects a headerless sheet’s first row of content', () => {
    // The video/audio fallback in guessColumnRoles assigns those two roles to
    // columns that matched nothing, and counting its guesses here made any
    // two-column row look like a header — so importing a headerless sheet ate
    // the first shot.
    expect(looksLikeHeader(['Wide street', 'Piano solo'])).toBe(false);
    expect(looksLikeHeader(['Establishing shot of the harbour', 'Gulls'])).toBe(false);
  });
});

describe('splitCueCell', () => {
  it('splits our own combined shot/start cell', () => {
    expect(splitCueCell('1. 0:00')).toEqual({ shot: '1.', start: '0:00' });
    expect(splitCueCell('2. 1:02:03')).toEqual({ shot: '2.', start: '1:02:03' });
  });

  it('leaves a shot label that merely contains a number alone', () => {
    expect(splitCueCell('22c')).toEqual({ shot: '22c', start: '' });
    expect(splitCueCell('SHOT 2')).toEqual({ shot: 'SHOT 2', start: '' });
    expect(splitCueCell('')).toEqual({ shot: '', start: '' });
  });
});

describe('gridToAvBlock', () => {
  const grid = [
    ['Shot', 'Duration', 'Video', 'Audio'],
    ['1.', '0:05', 'WIDE ON STREET', 'NARRATOR: Hello'],
    ['2.', '10', 'CU HANDS', 'SFX: whoosh'],
  ];

  it('builds rows with cue values and both cells', () => {
    const r = gridToAvBlock(grid);
    expect(r.rowCount).toBe(2);
    const rows = r.block.content!;
    expect(rows[0].attrs!.duration).toBe('0:05');
    expect(rows[0].content![0].attrs!.side).toBe('video');
    expect(rows[0].content![1].attrs!.side).toBe('audio');
  });

  it('normalises a bare-seconds duration to a timecode', () => {
    // "10" in someone else's sheet means ten seconds.
    expect(gridToAvBlock(grid).block.content![1].attrs!.duration).toBe('0:10');
  });

  it('leaves a purely sequential shot number derived rather than pinned', () => {
    // Storing "1." would stop the row renumbering when one is inserted above.
    expect(gridToAvBlock(grid).block.content![0].attrs!.shot).toBeNull();
  });

  it('keeps a real shot number like 22c', () => {
    const r = gridToAvBlock([['Shot', 'Video'], ['22c', 'WIDE']]);
    expect(r.block.content![0].attrs!.shot).toBe('22c');
  });

  it('keeps numbering that is not simply sequential', () => {
    // 10/20/30 is someone's deliberate scheme; renumbering it to 1/2/3 loses it.
    const r = gridToAvBlock([['Shot', 'Video'], ['10', 'a'], ['20', 'b'], ['30', 'c']]);
    expect(r.block.content!.map(x => x.attrs!.shot)).toEqual(['10', '20', '30']);
  });

  it('keeps the first row of a headerless two-column sheet', () => {
    const r = gridToAvBlock([['Wide street', 'Piano solo'], ['CU hands', 'SFX: whoosh']]);
    expect(r.rowCount).toBe(2);
    expect(r.header).toBeNull();
    expect(r.block.content![0].content![0].content![0].content![0].text).toBe('Wide street');
  });

  it('splits our own combined cue cell rather than pinning it as a shot', () => {
    const r = gridToAvBlock([
      ['Shot / Time', 'Duration', 'Video', 'Audio'],
      ['1. 0:00', '0:05', 'a', 'b'],
      ['2. 0:05', '0:05', 'c', 'd'],
    ]);
    // Both values restate what the editor derives from the durations, so both
    // stay derived and the rows still renumber when one is inserted above.
    expect(r.block.content!.map(x => x.attrs!.shot)).toEqual([null, null]);
    expect(r.block.content!.map(x => x.attrs!.start)).toEqual([null, null]);
  });

  it('pins a start that the durations above would not have produced', () => {
    const r = gridToAvBlock([
      ['Shot', 'Start', 'Duration', 'Video'],
      ['1.', '0:00', '0:05', 'a'],
      ['2.', '2:00', '0:05', 'b'],
    ]);
    expect(r.block.content![0].attrs!.start).toBeNull();
    expect(r.block.content![1].attrs!.start).toBe('2:00');
  });

  it('splits a multi-line cell into paragraphs', () => {
    const r = gridToAvBlock([['Video', 'Audio'], ['one\ntwo', 'x']]);
    expect(r.block.content![0].content![0].content).toHaveLength(2);
  });

  it('switches on the columns the sheet actually had', () => {
    const withCue = gridToAvBlock(grid).block.attrs!.columns as { cue: boolean; image: boolean };
    expect(withCue.cue).toBe(true);
    expect(withCue.image).toBe(false);

    const noCue = gridToAvBlock([['Video', 'Audio'], ['a', 'b']]).block.attrs!.columns as { cue: boolean };
    expect(noCue.cue).toBe(false);
  });

  it('carries the sheet’s own header labels onto the body', () => {
    const r = gridToAvBlock([['Cue', 'Visual', 'Sound'], ['1', 'a', 'b']]);
    const headers = r.block.attrs!.headers as { video: string; audio: string };
    expect(headers.video).toBe('Visual');
    expect(headers.audio).toBe('Sound');
  });

  it('drops blank trailing rows instead of importing empty shots', () => {
    expect(gridToAvBlock([['Video', 'Audio'], ['a', 'b'], ['', ''], ['', '']]).rowCount).toBe(1);
  });

  it('honours an explicit role override', () => {
    const r = gridToAvBlock([['X', 'Y'], ['a', 'b']], { roles: ['audio', 'video'], hasHeader: true });
    expect(r.block.content![0].content![0].content![0].content![0].text).toBe('b'); // video cell holds Y
  });

  it('survives junk', () => {
    expect(gridToAvBlock([]).rowCount).toBe(0);
    expect(() => gridToAvBlock(null as never)).not.toThrow();
  });
});

describe('splitGridSections', () => {
  const header = ['Shot / Time', 'Duration', 'Video', 'Audio'];

  it('keeps a single body in one section', () => {
    expect(splitGridSections([header, ['1. 0:00', '0:05', 'a', 'b']])).toHaveLength(1);
  });

  it('breaks at a blank row that a header follows', () => {
    const sections = splitGridSections([
      header, ['1. 0:00', '0:05', 'a', 'b'],
      ['', '', '', ''],
      header, ['1. 0:00', '0:05', 'c', 'd'],
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[1][1][2]).toBe('c');
  });

  it('does NOT break on a stray blank row inside one body', () => {
    // Splitting here would cut a single shot list in two and lose the column
    // mapping for everything below the cut — far more likely than a second body.
    const sections = splitGridSections([
      header,
      ['1. 0:00', '0:05', 'a', 'b'],
      ['', '', '', ''],
      ['2. 0:05', '0:05', 'c', 'd'],
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toHaveLength(3);
  });

  it('survives junk', () => {
    expect(splitGridSections([])).toEqual([]);
    expect(splitGridSections([['', '']])).toEqual([]);
    expect(() => splitGridSections(null as never)).not.toThrow();
  });
});

describe('round trip', () => {
  const cell = (side: 'video' | 'audio', ...l: string[]) => ({
    type: 'avCell', attrs: { side },
    content: l.map(t => ({ type: 'avPara', content: t ? [{ type: 'text', text: t }] : [] })),
  });
  const doc = {
    type: 'doc',
    content: [{
      type: 'avBlock', attrs: { columns: { cue: true, image: false } },
      content: [
        { type: 'avRow', attrs: { duration: '0:05', shot: null, start: null }, content: [cell('video', 'WIDE ON STREET'), cell('audio', 'NARRATOR: Hello, world')] },
        { type: 'avRow', attrs: { duration: '1:30', shot: null, start: null }, content: [cell('video', 'CU, with a comma'), cell('audio', 'She says "hi"')] },
      ],
    }],
  };

  it('survives export to CSV and back', () => {
    const csv = avDocumentToCsv(doc);
    const r = importAvCsv(csv);
    expect(r.rowCount).toBe(2);
    const body = extractAvBodies({ type: 'doc', content: r.blocks })[0];
    expect(body.rows[0].video).toBe('WIDE ON STREET');
    expect(body.rows[0].audio).toBe('NARRATOR: Hello, world');
    expect(body.rows[0].duration).toBe('0:05');
    // Commas and quotes come back intact.
    expect(body.rows[1].video).toBe('CU, with a comma');
    expect(body.rows[1].audio).toBe('She says "hi"');
    expect(body.totalFormatted).toBe('1:35');
  });

  it('survives export to xlsx and back', async () => {
    const blob = await avDocumentToXlsx(doc);
    const r = await importAvXlsx(await blob!.arrayBuffer());
    expect(r.rowCount).toBe(2);
    const body = extractAvBodies({ type: 'doc', content: r.blocks })[0];
    expect(body.rows[0].video).toBe('WIDE ON STREET');
    expect(body.rows[1].audio).toBe('She says "hi"');
    expect(body.totalFormatted).toBe('1:35');
  });

  it('comes back with its cue values still derived, not pinned', () => {
    // The cue column exports as one cell — "1. 0:00" — and taking that back in
    // whole froze every shot number as a manual override, so inserting a row
    // no longer renumbered anything below it.
    const r = importAvCsv(avDocumentToCsv(doc));
    expect(r.blocks[0].content!.map(x => x.attrs!.shot)).toEqual([null, null]);
    expect(r.blocks[0].content!.map(x => x.attrs!.start)).toEqual([null, null]);
    const body = extractAvBodies({ type: 'doc', content: r.blocks })[0];
    expect(body.rows.map(x => x.shot)).toEqual(['1.', '2.']);
    expect(body.rows.map(x => x.start)).toEqual(['0:00', '0:05']);
  });
});

describe('readXlsxGrid', () => {
  it('returns nothing for a zip with no worksheet', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('hello.txt', 'not a workbook');
    expect(await readXlsxGrid(await zip.generateAsync({ type: 'arraybuffer' }))).toEqual([]);
  });

  it('reads shared strings, which is what Excel itself writes', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('xl/sharedStrings.xml',
      '<sst><si><t>Video</t></si><si><t>Audio</t></si><si><t>WIDE &amp; CLOSE</t></si></sst>');
    zip.file('xl/worksheets/sheet1.xml',
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>V.O.</t></is></c></row>' +
      '</sheetData></worksheet>');
    const grid = await readXlsxGrid(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(grid).toEqual([['Video', 'Audio'], ['WIDE & CLOSE', 'V.O.']]);
  });

  it('fills gaps so a row with a skipped cell stays aligned', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml',
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>' +
      '</sheetData></worksheet>');
    expect(await readXlsxGrid(await zip.generateAsync({ type: 'arraybuffer' }))).toEqual([['a', '', 'c']]);
  });
});

describe('a document with two AV bodies', () => {
  const cell = (side: 'video' | 'audio', ...l: string[]) => ({
    type: 'avCell', attrs: { side },
    content: l.map(t => ({ type: 'avPara', content: t ? [{ type: 'text', text: t }] : [] })),
  });
  const body = (video: string, audio: string) => ({
    type: 'avBlock', attrs: { columns: { cue: true, image: false } },
    content: [{
      type: 'avRow', attrs: { duration: '0:05', shot: null, start: null },
      content: [cell('video', video), cell('audio', audio)],
    }],
  });
  const doc = { type: 'doc', content: [body('TEASER WIDE', 'V.O. one'), body('ACT ONE WIDE', 'V.O. two')] };

  it('comes back from CSV as two bodies, not one with a header in the middle', () => {
    const r = importAvCsv(avDocumentToCsv(doc));
    expect(r.blocks).toHaveLength(2);
    expect(r.rowCount).toBe(2);
    const bodies = extractAvBodies({ type: 'doc', content: r.blocks });
    expect(bodies.map(b => b.rows.map(x => x.video))).toEqual([['TEASER WIDE'], ['ACT ONE WIDE']]);
    // The second body's header must not have arrived as a shot.
    expect(bodies[1].rows).toHaveLength(1);
  });

  it('comes back from xlsx as two bodies, one per worksheet', async () => {
    const blob = await avDocumentToXlsx(doc);
    const r = await importAvXlsx(await blob!.arrayBuffer());
    expect(r.blocks).toHaveLength(2);
    const bodies = extractAvBodies({ type: 'doc', content: r.blocks });
    expect(bodies.map(b => b.rows.map(x => x.audio))).toEqual([['V.O. one'], ['V.O. two']]);
  });
});

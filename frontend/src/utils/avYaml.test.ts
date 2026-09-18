/**
 * OpenDraft AV YAML — round trip, self-identification and versioning.
 *
 * The point of this format over the spreadsheet is that it keeps structure the
 * spreadsheet flattens: per-paragraph styles, blank cells, cue metadata and the
 * document's own settings. The point over `.odraft` is that a human can read
 * and edit it. Both of those are what these tests pin.
 */
import { describe, it, expect } from 'vitest';
import { load as yamlLoad } from 'js-yaml';
import type { JSONContent } from '@tiptap/react';
import {
  avDocumentToYaml,
  importAvYaml,
  AvYamlError,
  AV_YAML_FORMAT,
  AV_YAML_SCHEMA_VERSION,
} from './avYaml';
import { extractAvBodies } from './avDocument';

const para = (text: string) => ({ type: 'avPara', content: text ? [{ type: 'text', text }] : [] });
const shot = (text: string) => ({ type: 'avShot', content: [{ type: 'text', text }] });
const graphic = (text: string) => ({ type: 'avGraphic', content: [{ type: 'text', text }] });
const cell = (side: 'video' | 'audio', ...c: unknown[]): JSONContent =>
  ({ type: 'avCell', attrs: { side }, content: c as never });

const doc = (rows: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
  type: 'doc',
  content: [{ type: 'avBlock', ...(attrs ? { attrs } : {}), content: rows }],
});

const row = (opts: {
  duration?: string | null; shot?: string | null;
  video?: unknown[]; audio?: unknown[]; image?: Record<string, unknown> | null;
}): JSONContent => ({
  type: 'avRow',
  attrs: { duration: opts.duration ?? null, shot: opts.shot ?? null, start: null },
  content: [
    cell('video', ...(opts.video ?? [para('')])),
    cell('audio', ...(opts.audio ?? [para('')])),
    ...(opts.image ? [{ type: 'avImage', attrs: opts.image } as JSONContent] : []),
  ],
});

const SAMPLE = doc(
  [
    row({ duration: '0:05', video: [shot('WIDE ON STREET'), graphic('SUPER: Summer')], audio: [para('NARRATOR (V.O.): Hello')] }),
    row({ duration: '1:30', shot: '22c', video: [para('CU, with a comma')], audio: [para('She says "hi"')],
          image: { src: 'f.png', alt: 'Frame 1', assetId: 'a1', aspect: '4:3' } }),
  ],
  { columns: { cue: true, image: true }, headers: { video: 'Visual' }, repeatHeaders: true },
);

describe('writing', () => {
  it('identifies itself and carries a schema version', () => {
    const y = yamlLoad(avDocumentToYaml(SAMPLE)!) as Record<string, unknown>;
    expect(y.format).toBe(AV_YAML_FORMAT);
    expect(y.schemaVersion).toBe(AV_YAML_SCHEMA_VERSION);
  });

  it('returns null when the document has no AV content', () => {
    expect(avDocumentToYaml({ type: 'doc', content: [] })).toBeNull();
  });

  it('is human-readable plain text, not a blob', () => {
    const text = avDocumentToYaml(SAMPLE)!;
    expect(text).toContain('format: opendraft-av');
    expect(text).toContain('WIDE ON STREET');
    // No base64 image payloads — that is the whole reason images stay out.
    expect(text).not.toMatch(/base64|data:image/);
  });

  it('records each paragraph’s style, which a spreadsheet cannot', () => {
    const y = yamlLoad(avDocumentToYaml(SAMPLE)!) as never as { av: [{ rows: [{ video: { style: string }[] }] }] };
    expect(y.av[0].rows[0].video.map(p => p.style)).toEqual(['shot', 'onscreen']);
  });

  it('names a storyboard frame without embedding it', () => {
    const y = yamlLoad(avDocumentToYaml(SAMPLE)!) as never as { av: [{ rows: [unknown, { storyboard: Record<string, string> }] }] };
    const sb = y.av[0].rows[1].storyboard;
    expect(sb.description).toBe('Frame 1');
    expect(sb.aspect).toBe('4:3');
    expect(sb.asset).toBe('a1');
    expect(JSON.stringify(sb)).not.toContain('f.png');
  });

  it('stores only cue values the writer set, leaving derived ones to recompute', () => {
    const y = yamlLoad(avDocumentToYaml(SAMPLE)!) as never as { av: [{ rows: { cue?: Record<string, string> }[] }] };
    // Row 0 has a duration but no manual shot number.
    expect(y.av[0].rows[0].cue).toEqual({ duration: '0:05' });
    expect(y.av[0].rows[1].cue).toEqual({ shot: '22c', duration: '1:30' });
  });

  it('carries document-level settings when given them', () => {
    const y = yamlLoad(avDocumentToYaml(SAMPLE, { title: 'Summer Campaign', draft: 'Draft 3' })!) as never as
      { document: Record<string, string> };
    expect(y.document.title).toBe('Summer Campaign');
    expect(y.document.draft).toBe('Draft 3');
  });
});

describe('reading', () => {
  it('round-trips a document through YAML', () => {
    const result = importAvYaml(avDocumentToYaml(SAMPLE, { title: 'Summer Campaign' })!);
    expect(result.rowCount).toBe(2);
    expect(result.document?.title).toBe('Summer Campaign');

    const body = extractAvBodies({ type: 'doc', content: result.blocks })[0];
    expect(body.rows[0].video).toBe('WIDE ON STREET\nSUPER: Summer');
    expect(body.rows[0].audio).toBe('NARRATOR (V.O.): Hello');
    expect(body.rows[0].duration).toBe('0:05');
    // Commas and quotes survive.
    expect(body.rows[1].video).toBe('CU, with a comma');
    expect(body.rows[1].audio).toBe('She says "hi"');
    // Manual shot number preserved; derived one still derived.
    expect(body.rows[1].shot).toBe('22c');
    expect(body.totalFormatted).toBe('1:35');
  });

  it('restores paragraph styles, not just text', () => {
    const result = importAvYaml(avDocumentToYaml(SAMPLE)!);
    const videoCell = (result.blocks[0].content![0].content as JSONContent[])[0];
    expect(videoCell.content!.map(p => p.type)).toEqual(['avShot', 'avGraphic']);
  });

  it('restores the storyboard column and each frame’s shape', () => {
    const result = importAvYaml(avDocumentToYaml(SAMPLE)!);
    const cols = result.blocks[0].attrs!.columns as { image: boolean };
    expect(cols.image).toBe(true);
    const frame = (result.blocks[0].content![1].content as JSONContent[]).find(c => c.type === 'avImage');
    expect(frame!.attrs!.alt).toBe('Frame 1');
    expect(frame!.attrs!.aspect).toBe('4:3');
    // The pixels are gone by design; the slot is not.
    expect(frame!.attrs!.src).toBeNull();
  });

  it('keeps custom column names', () => {
    const result = importAvYaml(avDocumentToYaml(SAMPLE)!);
    expect((result.blocks[0].attrs!.headers as { video: string }).video).toBe('Visual');
  });

  it('accepts a bare string for a cell, as a hand-edited file would have', () => {
    const text = [
      `format: ${AV_YAML_FORMAT}`,
      'schemaVersion: 1',
      'av:',
      '  - columns:',
      '      - id: video',
      '      - id: audio',
      '    rows:',
      '      - video: [WIDE ON STREET]',
      '        audio: ["NARRATOR: Hello"]',
    ].join('\n');
    const body = extractAvBodies({ type: 'doc', content: importAvYaml(text).blocks })[0];
    expect(body.rows[0].video).toBe('WIDE ON STREET');
    expect(body.rows[0].audio).toBe('NARRATOR: Hello');
  });

  it('recovers an unquoted line whose colon YAML turned into a map', () => {
    // `- NARRATOR: Hello` parses as {NARRATOR: "Hello"}. Nearly every AV audio
    // line has a colon, so dropping these would lose most of a hand-edited file.
    const text = [
      `format: ${AV_YAML_FORMAT}`,
      'schemaVersion: 1',
      'av:',
      '  - rows:',
      '      - video:',
      '          - WIDE ON STREET',
      '        audio:',
      '          - NARRATOR: Hello there',
      '          - SFX: whoosh',
    ].join('\n');
    const body = extractAvBodies({ type: 'doc', content: importAvYaml(text).blocks })[0];
    expect(body.rows[0].video).toBe('WIDE ON STREET');
    expect(body.rows[0].audio).toBe('NARRATOR: Hello there\nSFX: whoosh');
  });

  it('normalises a hand-written bare-seconds duration', () => {
    const text = `format: ${AV_YAML_FORMAT}\nschemaVersion: 1\nav:\n  - rows:\n      - cue: {duration: 5}\n        video: [x]`;
    const body = extractAvBodies({ type: 'doc', content: importAvYaml(text).blocks })[0];
    expect(body.rows[0].duration).toBe('0:05');
  });
});

describe('refusing bad input rather than guessing', () => {
  it('rejects a file that is not YAML at all', () => {
    expect(() => importAvYaml('{{ not: [valid')).toThrow(AvYamlError);
    expect(() => importAvYaml('{{ not: [valid')).toThrow(/not valid YAML/);
  });

  it('rejects YAML that is not an OpenDraft AV document', () => {
    expect(() => importAvYaml('name: something else\nvalue: 3')).toThrow(/not an OpenDraft AV document/);
  });

  it('rejects a file with no schema version', () => {
    expect(() => importAvYaml(`format: ${AV_YAML_FORMAT}\nav: []`)).toThrow(/which AV schema version/);
  });

  it('refuses a newer schema version by name instead of misreading it', () => {
    const text = `format: ${AV_YAML_FORMAT}\nschemaVersion: 99\nav:\n  - rows:\n      - video: [x]`;
    expect(() => importAvYaml(text)).toThrow(/version 99.*reads up to 1/s);
  });

  it('rejects a file with no av section', () => {
    expect(() => importAvYaml(`format: ${AV_YAML_FORMAT}\nschemaVersion: 1`)).toThrow(/no `av:` section/);
  });

  it('rejects a section with no rows', () => {
    expect(() => importAvYaml(`format: ${AV_YAML_FORMAT}\nschemaVersion: 1\nav:\n  - columns: []`))
      .toThrow(/section 1 has no rows/);
  });

  it('accepts its own current version', () => {
    expect(() => importAvYaml(avDocumentToYaml(SAMPLE)!)).not.toThrow();
  });
});

describe('column widths', () => {
  it('round-trips each column’s width', () => {
    const withWidths = doc(
      [row({ video: [para('v')], audio: [para('a')] })],
      { columns: { cue: true, image: false, widths: { cue: 0.8, video: 3, audio: 1.5, image: 1.5 } } },
    );
    const yaml = avDocumentToYaml(withWidths)!;
    expect(yaml).toContain('width: 3');
    const back = importAvYaml(yaml);
    const w = (back.blocks[0].attrs!.columns as { widths: Record<string, number> }).widths;
    expect(w.video).toBe(3);
    expect(w.audio).toBe(1.5);
    expect(w.cue).toBe(0.8);
  });

  it('clamps a nonsense width from a hand-edited file', () => {
    const text = [
      `format: ${AV_YAML_FORMAT}`, 'schemaVersion: 1', 'av:',
      '  - columns:', '      - id: video', '        width: 0',
      '      - id: audio', '    rows:', '      - video: [x]',
    ].join('\n');
    const w = (importAvYaml(text).blocks[0].attrs!.columns as { widths: Record<string, number> }).widths;
    expect(w.video).toBe(1);
  });
});

describe('screenplay elements inside a cell', () => {
  const el = (type: string, text: string) => ({ type, content: [{ type: 'text', text }] });

  const MIXED = doc([row({
    duration: '0:08',
    video: [el('avShot', 'WIDE ON THE FACTORY FLOOR.'), el('action', 'A welder looks up.')],
    audio: [el('character', 'MARIA'), el('parenthetical', '(to camera)'), el('dialogue', 'We build them by hand.')],
  })]);

  type YamlFile = { av: { rows: { video: { style: string; text: string }[]; audio: { style: string; text: string }[] }[] }[] };

  it('names each element type in the file, rather than flattening to body', () => {
    const y = yamlLoad(avDocumentToYaml(MIXED)!) as never as YamlFile;
    expect(y.av[0].rows[0].video).toEqual([
      { style: 'shot', text: 'WIDE ON THE FACTORY FLOOR.' },
      { style: 'action', text: 'A welder looks up.' },
    ]);
    expect(y.av[0].rows[0].audio).toEqual([
      { style: 'character', text: 'MARIA' },
      { style: 'parenthetical', text: '(to camera)' },
      { style: 'dialogue', text: 'We build them by hand.' },
    ]);
  });

  it('round-trips every element type back to the node it came from', () => {
    const result = importAvYaml(avDocumentToYaml(MIXED)!);
    const cells = result.blocks[0].content![0].content as JSONContent[];
    expect(cells[0].content!.map(p => p.type)).toEqual(['avShot', 'action']);
    expect(cells[1].content!.map(p => p.type)).toEqual(['character', 'parenthetical', 'dialogue']);
  });

  it('keeps the two "shot"s apart', () => {
    // `shot` has meant the video column's shot line since the format was
    // written; the screenplay element of the same name is a camera instruction.
    // Reading one as the other would silently restyle every AV file ever saved.
    const both = doc([row({
      video: [el('avShot', 'WIDE.'), el('shot', 'CRANE DOWN.')],
      audio: [para('x')],
    })]);
    const y = yamlLoad(avDocumentToYaml(both)!) as never as YamlFile;
    expect(y.av[0].rows[0].video.map(p => p.style)).toEqual(['shot', 'camera-shot']);

    const result = importAvYaml(avDocumentToYaml(both)!);
    const cells = result.blocks[0].content![0].content as JSONContent[];
    expect(cells[0].content!.map(p => p.type)).toEqual(['avShot', 'shot']);
  });

  it('still reads a file written before these styles existed', () => {
    const legacy = [
      `format: ${AV_YAML_FORMAT}`,
      `schemaVersion: ${AV_YAML_SCHEMA_VERSION}`,
      'av:',
      '  - rows:',
      '      - video:',
      '          - style: shot',
      '            text: WIDE.',
      '        audio:',
      '          - style: body',
      '            text: Narration.',
    ].join('\n');
    const result = importAvYaml(legacy);
    const cells = result.blocks[0].content![0].content as JSONContent[];
    expect(cells[0].content![0].type).toBe('avShot');
    expect(cells[1].content![0].type).toBe('avPara');
  });

  it('falls back to body for a style it does not know', () => {
    const odd = [
      `format: ${AV_YAML_FORMAT}`,
      `schemaVersion: ${AV_YAML_SCHEMA_VERSION}`,
      'av:',
      '  - rows:',
      '      - video:',
      '          - style: interpretive-dance',
      '            text: Hmm.',
      '        audio: []',
    ].join('\n');
    const result = importAvYaml(odd);
    const cells = result.blocks[0].content![0].content as JSONContent[];
    expect(cells[0].content![0].type).toBe('avPara');
  });
});

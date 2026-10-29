/**
 * WriterDuet (.wdz) import: a zip holding script.json, an operation log that
 * is replayed into lines. The fixtures follow the layout described in
 * writerDuetParser.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { parseWriterDuet, parseWriterDuetJson } from './writerDuetParser';
import { titleNodeOf, bodyTypesOf } from '../test/titlePage';

const bold = (s: string) => `\x01${s}\x02`;
const italic = (s: string) => `\x03${s}\x04`;
const underline = (s: string) => `\x05${s}\x06`;

/** A line whose text is one insert change set, as WriterDuet stores a typed line. */
const line = (type: string, text: string, extra: Record<string, unknown> = {}) => ({
  type,
  content: { c1: [0, [['i', [1, '', 0, text]]], 1] },
  ...extra,
});

/** A branch built from a snapshot, a batch update, then any extra ops. */
const branch = (lines: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  h: {
    '-': { a: 's', l: '', v: JSON.stringify({ data: {} }) },
    '-M001': { a: 'u', l: 'data', v: JSON.stringify(lines) },
    ...extra,
  },
});

async function wdz(scriptJson: unknown, name = 'script.json'): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(name, typeof scriptJson === 'string' ? scriptJson : JSON.stringify(scriptJson));
  return zip.generateAsync({ type: 'arraybuffer' });
}

const SCRIPT = {
  b: {
    '-': branch(
      {
        a0: line('Slugline', 'INT. HOUSE - DAY'),
        a1: line('Action', `${bold('FADE IN:')} then ${italic('slowly')}.`),
        a2: line('EditDialogName', 'JANE'),
        a3: line('EditDialogParen', '(softly)'),
        a4: line('EditDialogContent', `Hello ${underline('world')}.`),
        a5: line('Transition', 'CUT TO:'),
        a6: line('Shot', 'CLOSE ON JANE'),
        a7: line('Hologram', 'Mystery line'),
        a8: line('Action', 'Gone', { removed: true }),
      },
      // A later leaf-set: a page break before the transition.
      { '-M002': { l: 'data/a5/pb', v: '1' } },
    ),
    titlePage: branch({
      z0: line('Title', 'BIG FISH'),
      z1: line('Text', 'Written by'),
      z2: line('Text', 'John August'),
      z3: line('Text', ''),
      z4: line('Text', 'First Draft'),
      z5: line('Text', 'jane@example.com'),
    }),
  },
};

describe('parseWriterDuet', () => {
  it('replays the log and maps each line type in reading order', async () => {
    const { doc } = await parseWriterDuet(await wdz(SCRIPT));
    expect(bodyTypesOf(doc as JSONContent)).toEqual([
      'sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'action',
    ]);
  });

  it('turns the style control characters into marks', async () => {
    const { doc } = await parseWriterDuet(await wdz(SCRIPT));
    const body = (doc.content ?? []).filter((n) => n.type !== 'titlePage');
    expect(body[1].content).toEqual([
      { type: 'text', text: 'FADE IN:', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' then ' },
      { type: 'text', text: 'slowly', marks: [{ type: 'italic' }] },
      { type: 'text', text: '.' },
    ]);
    expect(body[4].content?.[1]).toEqual({ type: 'text', text: 'world', marks: [{ type: 'underline' }] });
  });

  it('keeps a page break and reports unknown types', async () => {
    const { doc, warnings } = await parseWriterDuet(await wdz(SCRIPT));
    const transition = (doc.content ?? []).find((n) => n.type === 'transition');
    expect(transition?.attrs?.startsNewPage).toBe(true);
    expect(warnings.join(' ')).toMatch(/Hologram/);
  });

  it('recovers the title page fields from its lines', async () => {
    const { doc, title } = await parseWriterDuet(await wdz(SCRIPT));
    const attrs = titleNodeOf(doc as JSONContent)?.attrs ?? {};
    expect(title).toBe('BIG FISH');
    expect(attrs.tpTitle).toBe('BIG FISH');
    expect(attrs.tpCredit).toBe('Written by');
    expect(attrs.tpWrittenBy).toBe('John August');
    expect(attrs.tpDraft).toBe('First Draft');
    expect(attrs.tpContact).toBe('jane@example.com');
  });

  it('composes a line edited after it was typed', () => {
    const { doc } = parseWriterDuetJson({
      b: {
        '-': branch({
          a0: {
            type: 'Slugline',
            content: { o1: [0, [['i', [0, '', 0, 'Untitled']]], 10] },
            '.c': {
              e1: [9, [['d', [9, 'x', 0, 3]]], 20], // "Untitled" → "itled"
              e2: [9, [['i', [9, 'x', 0, 'EXT. ']]], 21], // → "EXT. itled"
              e3: [9, [['d', [9, 'x', 5, 5]]], 22], // → "EXT. "
              e4: [9, [['i', [9, 'x', 5, 'PARK - DAY']]], 23], // → "EXT. PARK - DAY"
            },
          },
        }),
      },
    });
    expect(doc.content?.[0].content?.[0].text).toBe('EXT. PARK - DAY');
  });

  it('reads a script.json that is already a snapshot', () => {
    const { doc } = parseWriterDuetJson({ data: { a: line('Action', 'Line one\nLine two') } });
    expect(doc.content?.[0]).toEqual({
      type: 'action',
      content: [{ type: 'text', text: 'Line one' }, { type: 'hardBreak' }, { type: 'text', text: 'Line two' }],
    });
  });

  it('rejects a file that is not a zip', async () => {
    const buf = new TextEncoder().encode('{"b":{}}').buffer;
    await expect(parseWriterDuet(buf)).rejects.toThrow(/not a valid \.wdz archive/);
  });

  it('rejects an archive without script.json', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'hello');
    const buf = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(parseWriterDuet(buf)).rejects.toThrow(/no script\.json.*readme\.txt/);
  });

  it('rejects script.json that is not JSON', async () => {
    await expect(parseWriterDuet(await wdz('{not json'))).rejects.toThrow(/not readable JSON/);
  });

  it('rejects JSON with no script in it', async () => {
    await expect(parseWriterDuet(await wdz({ hello: 'world' }))).rejects.toThrow(/no script in it/);
  });
});

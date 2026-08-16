/**
 * Issue #75, end to end: write a real `.fountain` file to disk, read it back,
 * and check the screenplay survived.
 *
 * The suite in frontend/src/utils already round-trips in memory. This goes one
 * step further and puts the file on disk, because the reported failure is not
 * an export bug or an import bug — it is what happens when a `.fountain` opened
 * *in place* is saved with ⌘S and then reopened. MenuBar routes that save
 * through `exportFountain` and the reopen through `parseFountain`, so this pair
 * is the real code path, run over a document shaped the way the FDX and Fade In
 * importers actually produce one: bold scene headings, scene numbers, and runs
 * that were never coalesced.
 *
 * Output lands in test-script/output/ (gitignored).
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONContent } from '@tiptap/react';
import { exportFountain } from '../frontend/src/utils/fountainExporter';
import { parseFountain } from '../frontend/src/utils/fountainParser';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'output');
const OUT_FILE = join(OUT_DIR, 'roundtrip.fountain');

/** A scene heading as the FDX / Fade In importers build one: bold, unmerged runs. */
const importedHeading = (number: string, text: string): JSONContent => ({
  type: 'sceneHeading',
  attrs: { sceneNumber: number },
  content: [
    { type: 'text', text: text.slice(0, 4), marks: [{ type: 'bold' }] },
    { type: 'text', text: text.slice(4), marks: [{ type: 'bold' }] },
  ],
});

const plain = (type: string, text: string): JSONContent => ({
  type,
  content: [{ type: 'text', text }],
});

const SOURCE: JSONContent = {
  type: 'doc',
  content: [
    importedHeading('47', 'EXT. THE OLD PIER - NIGHT'),
    plain('action', 'Rain hammers the boards.'),
    plain('action', 'A FIGURE WAITS AT THE RAILING.'),
    plain('character', 'MARLOW'),
    plain('dialogue', "You're late."),
    plain('general', '    ARCHIVE RECORD 12 — SEALED'),
    plain('sceneHeading', 'BLACK SCREEN'),
    plain('action', 'He counts 5 * 3 * 2 in his head.'),
  ],
};

let reparsed: JSONContent;
let onDisk: string;

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, exportFountain(SOURCE), 'utf8');
  onDisk = readFileSync(OUT_FILE, 'utf8');
  reparsed = parseFountain(onDisk);
});

const types = () => (reparsed.content ?? []).map((n) => n.type as string);
const textAt = (i: number) =>
  ((reparsed.content ?? [])[i]?.content ?? []).map((c) => c.text ?? '').join('');

describe('Fountain file round trip on disk', () => {
  it('writes a file that still reads as a screenplay', () => {
    expect(onDisk.length).toBeGreaterThan(0);
    expect(types()).toEqual([
      'sceneHeading', 'action', 'action', 'character', 'dialogue',
      'action', 'sceneHeading', 'action',
    ]);
  });

  it('leaves no literal emphasis markers in the text', () => {
    const allText = (reparsed.content ?? [])
      .flatMap((n) => (n.content ?? []).map((c) => c.text ?? ''))
      .join('\n');
    // The arithmetic line is the one legitimate asterisk, and it is escaped in
    // the file, so it comes back as typed rather than as italics.
    expect(allText).toContain('5 * 3 * 2');
    expect(allText.replace('5 * 3 * 2', '')).not.toContain('*');
    expect(allText).not.toContain('**');
  });

  it('keeps the numbered heading a heading, with its number', () => {
    expect(textAt(0)).toBe('EXT. THE OLD PIER - NIGHT');
    expect(onDisk).toContain('#47#');
  });

  it('does not turn an all-caps action line into a character cue', () => {
    expect(textAt(2)).toBe('A FIGURE WAITS AT THE RAILING.');
    // One cue in, one cue out.
    expect(types().filter((t) => t === 'character')).toHaveLength(1);
  });

  it('keeps the real cue and its dialogue', () => {
    expect(textAt(3)).toBe('MARLOW');
    expect(textAt(4)).toBe("You're late.");
  });

  it('preserves deliberate indentation in General', () => {
    expect(textAt(5)).toBe('    ARCHIVE RECORD 12 — SEALED');
  });

  it('keeps a heading that does not start with INT./EXT.', () => {
    expect(textAt(6)).toBe('BLACK SCREEN');
  });

  it('is stable across repeated saves', () => {
    // The failure this guards is cumulative drift: each ⌘S re-serializes the
    // document the previous save produced, so anything the pair does not
    // preserve exactly gets worse every time the writer hits save rather than
    // showing up once. Two more cycles must be byte-identical.
    const second = exportFountain(parseFountain(onDisk));
    const third = exportFountain(parseFountain(second));
    expect(second).toBe(onDisk);
    expect(third).toBe(second);
  });
});

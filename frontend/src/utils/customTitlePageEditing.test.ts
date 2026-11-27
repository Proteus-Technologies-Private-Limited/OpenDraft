/**
 * Editing a custom title page in the Title Page dialog.
 *
 * - An image chosen in the dialog is measured before the page is laid out, so
 *   the spacing and the overflow check use its real height rather than the
 *   node's 8-line default (which the NodeView would later correct, pushing
 *   lines off the page).
 * - Standard-form edits made after leaving the custom page are carried back
 *   into it, never dropped for the older custom draft.
 * - "Move to line" puts a block's first line on the line chosen, whatever the
 *   block's height and whichever way it moves.
 * - Typing into a line keeps the formatting of the text it did not touch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSchema, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { testExtensions } from '../test/screenplaySchema';
import { customTitleBlockLines, moveCustomTitleBlock, readCustomTitleFields, replaceBlockText } from './customTitlePage';
import { imageHeightLines, measureImageFile, naturalImageLayout } from './imageLines';
import {
  applyStandardEdits, buildTitlePageBlocks, customizeTitlePageBlocks, padCustomTitlePage,
  trimCustomTitlePage, type StandardTitlePage, type TpData,
} from './titlePageDialogBlocks';

// The real ScreenplayImage pulls in services/api; these tests need only its
// attributes.
const ImageStub = Node.create({
  name: 'screenplayImage',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    scratchId: { default: null },
    width: { default: null },
    align: { default: 'center' },
    heightLines: { default: 8 },
    tpCustom: { default: false },
  }),
});
const schema = getSchema([...testExtensions, ImageStub]);

const WIDTH = 6; // US Letter content width, inches
const LINES = 54;

const EMPTY: TpData = {
  tpTitle: '', tpCredit: '', tpWrittenBy: '', tpBasedOn: '', tpDraft: '',
  tpDraftDate: '', tpContact: '', tpCopyright: '', tpWgaRegistration: '',
  tpNotes: '', tpTitleFontSize: 12,
};

const spacer = () => schema.nodes.titlePage.create({ field: 'blank', tpCustom: true });
const isSpacer = (node: PMNode) => node.type.name === 'titlePage' && node.attrs.field === 'blank' && !node.textContent;
const text = (field: string, value: string, attrs: Record<string, unknown> = {}) =>
  schema.nodes.titlePage.create({ field, tpCustom: true, ...attrs }, value ? schema.text(value) : null);
const image = (heightLines: number) => schema.nodes.screenplayImage.create({ scratchId: 'x', width: 200, heightLines, tpCustom: true });
const blanks = (count: number) => Array.from({ length: count }, spacer);
const page = (...nodes: PMNode[]) => padCustomTitlePage(nodes, schema, LINES, WIDTH);

/** The line each row starts on, as the dialog numbers them. */
function startLines(rows: readonly PMNode[]): number[] {
  let next = 1;
  return rows.map(node => {
    const line = Math.ceil(next);
    next += customTitleBlockLines(node, WIDTH);
    return line;
  });
}
const lineOf = (rows: readonly PMNode[], node: PMNode) => startLines(rows)[rows.indexOf(node)];
const totalLines = (rows: readonly PMNode[]) => rows.reduce((sum, node) => sum + customTitleBlockLines(node, WIDTH), 0);
/** Line of every non-spacer row, so a test can see what else moved. */
const contentLines = (rows: readonly PMNode[]) => {
  const starts = startLines(rows);
  return rows.flatMap((node, i) => (isSpacer(node) ? [] : [[node.type.name === 'screenplayImage' ? 'image' : node.textContent, starts[i]]]));
};

describe('measuring a title-page image', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives the size the NodeView would record, from one shared formula', () => {
    // 400 x 600 px in a 576px column: natural width (under 90% of the column),
    // 600px tall = 37.5 lines, rounded up, plus one for the margins.
    expect(naturalImageLayout(400, 600, 576)).toEqual({ width: 400, heightLines: 39 });
    // Wider than the column: capped at 90% of it, height scaled to match.
    expect(naturalImageLayout(2000, 1000, 576)).toEqual({ width: 518, heightLines: imageHeightLines(518, 0.5) });
    // A stored width wins, as it does on reload.
    expect(naturalImageLayout(2000, 1000, 576, 100)).toEqual({ width: 100, heightLines: 5 });
    expect(imageHeightLines(0, 1)).toBe(1);
  });

  it('decodes the chosen file before it is laid out', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:image', revokeObjectURL: revoke });
    vi.stubGlobal('Image', class {
      naturalWidth = 400;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) { queueMicrotask(() => this.onload?.()); }
    });
    await expect(measureImageFile(new Blob(['x']), 576)).resolves.toEqual({ width: 400, heightLines: 39 });
    expect(revoke).toHaveBeenCalledWith('blob:image');
  });

  it('fails with a message the writer can read when the file is not an image it can decode', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:bad', revokeObjectURL: () => {} });
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_url: string) { queueMicrotask(() => this.onerror?.()); }
    });
    await expect(measureImageFile(new Blob(['x']), 576)).rejects.toThrow(/./);
  });

  it('lets the overflow check and the Standard spacing see the real height', () => {
    const tall = naturalImageLayout(400, 600, 576);
    const measured = schema.nodes.screenplayImage.create({ ...tall, tpCustom: true });
    const unmeasured = schema.nodes.screenplayImage.create({ tpCustom: true });
    const rest = [text('title', 'A QUIET BEACON'), ...blanks(15), text('draft', 'Revision 2')];
    const lines = (nodes: PMNode[]) => totalLines(trimCustomTitlePage(nodes));
    expect(lines([unmeasured, ...rest])).toBeLessThanOrEqual(LINES); // the 8-line default hid it
    expect(lines([measured, ...rest])).toBeGreaterThan(LINES); // the dialog now refuses it

    const source = { state: { schema, doc: schema.nodes.doc.create(null, schema.nodes.action.create()) } };
    const data = { ...EMPTY, tpTitle: 'A QUIET BEACON' };
    const small = naturalImageLayout(200, 160, 576); // 11 lines
    const built = buildTitlePageBlocks(source, data, [{ scratchId: 'x', ...small }], [], LINES);
    const title = built.findIndex(node => node.attrs.field === 'title');
    // The title sits ~⅓ down whatever the image's height: the spacers above it
    // shrink by the image's real line count.
    const linesAbove = built.slice(0, title).reduce((sum, node) => sum + (node.type.name === 'screenplayImage' ? node.attrs.heightLines : 1), 0);
    expect(small.heightLines).toBe(11);
    expect(linesAbove).toBe(Math.round(LINES / 3.6) - 1);
  });
});

describe('carrying Standard edits back into the custom page', () => {
  const source = { state: { schema, doc: schema.nodes.doc.create(null, schema.nodes.action.create()) } };
  const data = { ...EMPTY, tpTitle: 'A Quiet Beacon', tpWrittenBy: 'Taylor Example', tpDraft: 'Revision 2' };
  /** A custom draft with a hand-placed, right-aligned title, and what Standard showed for it. */
  function customDraft() {
    const custom = customizeTitlePageBlocks(buildTitlePageBlocks(source, data, [], [], LINES), schema, data);
    const t = custom.findIndex(node => node.attrs.field === 'title');
    custom[t] = custom[t].type.create({ ...custom[t].attrs, tpAlign: 'right' }, custom[t].content);
    const base: StandardTitlePage = {
      data: { ...EMPTY, ...readCustomTitleFields(custom.map(node => node.toJSON())) },
      images: { imagesAbove: [], imagesBelow: [] },
    };
    return { custom, base };
  }

  it('keeps the draft exactly when Standard was not edited', () => {
    const { custom, base } = customDraft();
    const merged = applyStandardEdits(custom, schema, base, { data: { ...base.data }, images: { imagesAbove: [], imagesBelow: [] } });
    expect(merged?.every((node, i) => node.eq(custom[i]))).toBe(true);
  });

  it('writes an edited title into the custom page, keeping its place and alignment', () => {
    const { custom, base } = customDraft();
    const merged = applyStandardEdits(custom, schema, base, {
      data: { ...base.data, tpTitle: 'A Louder Beacon', tpTitleFontSize: 24 },
      images: base.images,
    });
    expect(merged).not.toBeNull();
    const before = custom.findIndex(node => node.attrs.field === 'title');
    const after = merged!.findIndex(node => node.attrs.field === 'title');
    expect(after).toBe(before);
    expect(merged![after].textContent).toBe('A Louder Beacon');
    expect(merged![after].attrs).toMatchObject({ tpAlign: 'right', tpTitleFontSize: 24 });
    expect(readCustomTitleFields(merged!.map(node => node.toJSON()))).toMatchObject({
      tpTitle: 'A Louder Beacon', tpWrittenBy: 'Taylor Example', tpDraft: 'Revision 2',
    });
  });

  it('asks for a rebuild when an image was added in Standard, rather than dropping it', () => {
    const { custom, base } = customDraft();
    expect(applyStandardEdits(custom, schema, base, {
      data: base.data,
      images: { imagesAbove: [{ scratchId: 'x', width: 200, heightLines: 9 }], imagesBelow: [] },
    })).toBeNull();
  });

  it('asks for a rebuild when an edit has no single block to go into', () => {
    const { custom, base } = customDraft();
    // No contact block on this custom page.
    expect(applyStandardEdits(custom, schema, base, { data: { ...base.data, tpContact: 'agent@example.com' }, images: base.images })).toBeNull();
    // Notes spread over two free lines.
    const notes = [...custom, text('blank', 'First note'), text('blank', 'Second note')];
    const notesBase = { ...base, data: { ...base.data, tpNotes: 'First note\nSecond note' } };
    expect(applyStandardEdits(notes, schema, notesBase, { data: { ...notesBase.data, tpNotes: 'Changed' }, images: base.images })).toBeNull();
  });
});

describe('Move to line', () => {
  const title = text('title', 'A QUIET BEACON', { tpTitleFontSize: 24 }); // 2 lines
  const wrapped = text('blank', 'This free line of notes is long enough that it has to wrap onto a second line of the page.');

  it('measures the blocks it is tested with', () => {
    expect(customTitleBlockLines(title, WIDTH)).toBe(2);
    expect(customTitleBlockLines(wrapped, WIDTH)).toBe(2);
    expect(customTitleBlockLines(image(6), WIDTH)).toBe(6);
  });

  it('moves a multi-line block down onto blank lines without moving anything else', () => {
    const img = image(6);
    const rows = page(...blanks(4), title, ...blanks(4), img, text('draft', 'Revision 2'));
    const { rows: moved, index } = moveCustomTitleBlock(rows, rows.indexOf(img), 30, WIDTH, isSpacer);
    expect(moved[index]).toBe(img);
    expect(lineOf(moved, img)).toBe(30);
    expect(contentLines(moved).filter(([name]) => name !== 'image')).toEqual(contentLines(rows).filter(([name]) => name !== 'image'));
    expect(totalLines(moved)).toBe(totalLines(rows));
  });

  it('moves a 2-line title up onto blank lines without moving anything else', () => {
    const rows = page(...blanks(20), title, text('author', 'Taylor Example'));
    const { rows: moved, index } = moveCustomTitleBlock(rows, rows.indexOf(title), 3, WIDTH, isSpacer);
    expect(moved[index]).toBe(title);
    expect(lineOf(moved, title)).toBe(3);
    expect(contentLines(moved).find(([name]) => name === 'Taylor Example')?.[1]).toBe(23);
  });

  it('lands a block moved down past other content on the chosen line, not its height - 1 above it', () => {
    const img = image(6);
    const author = text('author', 'Taylor Example');
    const rows = page(img, ...blanks(3), author, ...blanks(10), text('draft', 'Revision 2'));
    // Line 16 is the draft line itself, so there is no blank run to swap with.
    expect(lineOf(rows, rows.find(node => node.textContent === 'Revision 2')!)).toBe(21);
    const { rows: moved, index } = moveCustomTitleBlock(rows, 0, 21, WIDTH, isSpacer);
    expect(moved[index]).toBe(img);
    expect(lineOf(moved, img)).toBe(21);
  });

  it('lands a wrapped line and a title moved down onto content on the chosen line', () => {
    for (const block of [wrapped, title]) {
      const rows = page(block, text('author', 'Taylor Example'), ...blanks(5), text('draft', 'Revision 2'));
      const target = lineOf(rows, rows.find(node => node.textContent === 'Revision 2')!);
      const { rows: moved, index } = moveCustomTitleBlock(rows, 0, target, WIDTH, isSpacer);
      expect(moved[index]).toBe(block);
      expect(lineOf(moved, block)).toBe(target);
    }
  });

  it('lands a block moved up onto content on the chosen line', () => {
    const img = image(6);
    const author = text('author', 'Taylor Example');
    const rows = page(...blanks(2), author, ...blanks(10), wrapped, ...blanks(5), img);
    const { rows: moved, index } = moveCustomTitleBlock(rows, rows.indexOf(img), 3, WIDTH, isSpacer);
    expect(moved[index]).toBe(img);
    expect(lineOf(moved, img)).toBe(3);
    expect(lineOf(moved, author)).toBe(9);
    const { rows: moved2 } = moveCustomTitleBlock(rows, rows.indexOf(wrapped), 3, WIDTH, isSpacer);
    expect(lineOf(moved2, wrapped)).toBe(3);
  });

  it('keeps a block moved to the last line on the page', () => {
    const img = image(6);
    const rows = page(img, text('author', 'Taylor Example'));
    const { rows: moved } = moveCustomTitleBlock(rows, 0, startLines(rows).at(-1)!, WIDTH, isSpacer);
    expect(totalLines(moved)).toBeLessThanOrEqual(LINES);
    expect(lineOf(moved, img) + 6 - 1).toBe(LINES);
  });
});

describe('typing into a custom title-page line', () => {
  const italic = schema.marks.italic.create();
  const bold = schema.marks.bold.create();
  const line = () => schema.nodes.titlePage.create({ field: 'blank', tpCustom: true }, [
    schema.text('Based on '),
    schema.text('The Lighthouse', [italic]),
    schema.text(' by ', []),
    schema.text('R. Keeper', [bold]),
  ]);
  const runs = (node: PMNode) => {
    const out: [string, string[]][] = [];
    node.forEach(child => out.push([child.text ?? '', child.marks.map(m => m.type.name)]));
    return out;
  };

  it('keeps an italic word and a bold name when another part of the line changes', () => {
    const edited = replaceBlockText(line(), 'Inspired by The Lighthouse by R. Keeper', schema);
    expect(runs(edited)).toEqual([
      ['Inspired by ', []],
      ['The Lighthouse', ['italic']],
      [' by ', []],
      ['R. Keeper', ['bold']],
    ]);
  });

  it('gives typed text the formatting of the character before it', () => {
    const edited = replaceBlockText(line(), 'Based on The Old Lighthouse by R. Keeper', schema);
    expect(runs(edited)).toEqual([
      ['Based on ', []],
      ['The Old Lighthouse', ['italic']],
      [' by ', []],
      ['R. Keeper', ['bold']],
    ]);
  });

  it('removes text across runs and keeps the rest', () => {
    const edited = replaceBlockText(line(), 'Based on R. Keeper', schema);
    expect(runs(edited)).toEqual([['Based on ', []], ['R. Keeper', ['bold']]]);
    expect(edited.attrs).toMatchObject({ field: 'blank', tpCustom: true });
  });

  it('empties the line when every character is deleted, and returns it untouched when nothing changed', () => {
    expect(replaceBlockText(line(), '', schema).childCount).toBe(0);
    const node = line();
    expect(replaceBlockText(node, node.textContent, schema)).toBe(node);
  });

  it('formats the first character typed into an empty line plainly', () => {
    const empty = schema.nodes.titlePage.create({ field: 'blank', tpCustom: true });
    expect(runs(replaceBlockText(empty, 'Hello', schema))).toEqual([['Hello', []]]);
  });
});

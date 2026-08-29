/**
 * Printing notes in the Word and Final Draft exports, read back out of the
 * files they produce.
 *
 * Word is given REAL footnotes — it numbers them, places them and reflows them
 * itself — so what is asserted here is that the reference lands in the right
 * paragraph and the note body reaches `footnotes.xml`. Final Draft has no
 * footnote at all, so the citation travels as a ScriptNote instead; that is a
 * deliberate limitation and it is pinned here so it cannot be mistaken for
 * parity later.
 *
 * The last block is the one that matters most: with nothing printing, both
 * files must be exactly what they were before this feature existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import {
  DEFAULT_PAGE_LAYOUT,
  type GeneralNote,
  type NoteInfo,
  type PageLayout,
  type FootnoteSettings,
} from '../stores/editorStore';
import { buildFootnotePlan } from './footnotes';
import { exportFDX } from './fdxExporter';

const saved: { buf: Uint8Array | null } = { buf: null };
vi.mock('./fileOps', () => ({
  saveFile: (data: Uint8Array) => { saved.buf = data; return Promise.resolve(); },
}));

const CTX = { assets: [], assetUrl: () => null };

const note = (id: string, content = 'Davis, M. (1990). City of Quartz.', over: Partial<NoteInfo> = {}): NoteInfo => ({
  id, content, anchorText: '', elementType: 'action', contextLabel: '',
  color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z', sceneId: null,
  printInScript: true, ...over,
});

const layout = (over: Partial<FootnoteSettings> = {}): PageLayout => ({
  ...DEFAULT_PAGE_LAYOUT,
  footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true, ...over },
});

/** An action block whose middle phrase carries a script note. */
const anchored = (before: string, marked: string, after: string, noteId: string): JSONContent => ({
  type: 'action',
  content: [
    ...(before ? [{ type: 'text', text: before }] : []),
    { type: 'text', text: marked, marks: [{ type: 'scriptNote', attrs: { noteId } }] },
    ...(after ? [{ type: 'text', text: after }] : []),
  ],
});
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });

const SCRIPT = doc(
  { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LAB - DAY' }] },
  anchored('one small ', 'step', ' for a man', 'n1'),
);

const general = (id: string, content = 'A file-level reference.', over: Partial<GeneralNote> = {}): GeneralNote => ({
  id, title: '', content, color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z',
  printInScript: true, ...over,
});

async function docxParts(
  json: JSONContent, notes: NoteInfo[] | null, l: PageLayout,
  generals: GeneralNote[] = [],
) {
  const { exportDocx } = await import('./docxExporter');
  const plan = notes ? buildFootnotePlan(json, l, notes, CTX, generals) : null;
  await exportDocx(json, 'Test', l, { footnotes: plan });
  const zip = await JSZip.loadAsync(saved.buf!.slice());
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
  return {
    document: await read('word/document.xml'),
    footnotes: await read('word/footnotes.xml'),
    endnotes: await read('word/endnotes.xml'),
  };
}

beforeEach(() => { saved.buf = null; });

describe('Word gets real footnotes', () => {
  it('writes the note body into footnotes.xml', async () => {
    const parts = await docxParts(SCRIPT, [note('n1')], layout());
    expect(parts.footnotes).toContain('Davis, M. (1990). City of Quartz.');
  });

  it('places the reference in the paragraph the note is anchored to', async () => {
    const parts = await docxParts(SCRIPT, [note('n1')], layout());
    expect(parts.document).toContain('w:footnoteReference');
    // The reference goes after the annotated phrase and before what follows.
    // The phrase itself stays split across runs, exactly as it was authored.
    const order = (needle: string) => parts.document.indexOf(needle);
    expect(order('>step<')).toBeGreaterThan(-1);
    expect(order('w:footnoteReference')).toBeGreaterThan(order('>step<'));
    expect(order(' for a man')).toBeGreaterThan(order('w:footnoteReference'));
  });

  it('writes endnotes instead when that is the placement', async () => {
    const parts = await docxParts(SCRIPT, [note('n1')], layout({ placement: 'endnote' }));
    expect(parts.endnotes).toContain('Davis, M. (1990). City of Quartz.');
    expect(parts.document).toContain('w:endnoteReference');
  });

  it('writes nothing when no note prints', async () => {
    const parts = await docxParts(SCRIPT, [note('n1', 'x', { printInScript: false })], layout());
    expect(parts.document).not.toContain('w:footnoteReference');
  });

  it('writes nothing when exports are excluded', async () => {
    const parts = await docxParts(SCRIPT, [note('n1')], layout({ includeInExports: false }));
    expect(parts.document).not.toContain('w:footnoteReference');
  });
});

describe('Final Draft carries the citation as a note, not a footnote', () => {
  const fdx = (notes: NoteInfo[] | null, l: PageLayout) => exportFDX(
    SCRIPT, 'Test', undefined, undefined, undefined, undefined, undefined, l, undefined,
    notes ? buildFootnotePlan(SCRIPT, l, notes, CTX) : null,
  );

  it('writes a ScriptNote on the paragraph holding the anchor', () => {
    const xml = fdx([note('n1')], layout());
    expect(xml).toContain('<ScriptNote>');
    expect(xml).toContain('Davis, M. (1990). City of Quartz.');
  });

  it('writes nothing when no note prints', () => {
    expect(fdx([note('n1', 'x', { printInScript: false })], layout())).not.toContain('<ScriptNote>');
  });

  it('writes nothing when exports are excluded', () => {
    expect(fdx([note('n1')], layout({ includeInExports: false }))).not.toContain('<ScriptNote>');
  });
});

describe('general notes, which nothing references', () => {
  it('close the Word document under a NOTES heading rather than as footnotes', async () => {
    // A Word footnote exists because a reference points at it; a general note
    // has nothing to point from, so it is written as ordinary paragraphs.
    const parts = await docxParts(SCRIPT, [], layout(), [general('g1')]);
    expect(parts.document).toContain('NOTES');
    expect(parts.document).toContain('A file-level reference.');
    expect(parts.document).not.toContain('w:footnoteReference');
  });

  it('carry their title into Word', async () => {
    const parts = await docxParts(SCRIPT, [], layout(),
      [general('g1', 'A file-level reference.', { title: 'Sources' })]);
    expect(parts.document).toContain('Sources');
  });

  it('sit alongside real footnotes when both are printing', async () => {
    const parts = await docxParts(SCRIPT, [note('n1')], layout(), [general('g1')]);
    expect(parts.footnotes).toContain('Davis, M. (1990). City of Quartz.');
    expect(parts.document).toContain('w:footnoteReference');
    expect(parts.document).toContain('A file-level reference.');
  });

  it('ride the last paragraph in Final Draft, which has nowhere else to put them', () => {
    const l = layout();
    const xml = exportFDX(
      SCRIPT, 'Test', undefined, undefined, undefined, undefined, undefined, l, undefined,
      buildFootnotePlan(SCRIPT, l, [], CTX, [general('g1')]),
    );
    expect(xml).toContain('<ScriptNote>');
    expect(xml).toContain('A file-level reference.');
  });

  it('are excluded from every file when exports are turned off', async () => {
    const l = layout({ includeInExports: false });
    const parts = await docxParts(SCRIPT, [], l, [general('g1')]);
    expect(parts.document).not.toContain('A file-level reference.');
    const xml = exportFDX(
      SCRIPT, 'Test', undefined, undefined, undefined, undefined, undefined, l, undefined,
      buildFootnotePlan(SCRIPT, l, [], CTX, [general('g1')]),
    );
    expect(xml).not.toContain('<ScriptNote>');
  });
});

describe('the off contract', () => {
  it('produces an identical FDX when nothing prints', () => {
    const plain = exportFDX(SCRIPT, 'Test', undefined, undefined, undefined, undefined, undefined, DEFAULT_PAGE_LAYOUT);
    const withOffNotes = exportFDX(
      SCRIPT, 'Test', undefined, undefined, undefined, undefined, undefined, DEFAULT_PAGE_LAYOUT, undefined,
      buildFootnotePlan(SCRIPT, layout(), [note('n1', 'x', { printInScript: false })], CTX),
    );
    expect(withOffNotes).toBe(plain);
  });

  it('produces an identical document.xml when nothing prints', async () => {
    const plain = (await docxParts(SCRIPT, null, DEFAULT_PAGE_LAYOUT)).document;
    const off = (await docxParts(SCRIPT, [note('n1', 'x', { printInScript: false })], layout())).document;
    expect(off).toBe(plain);
  });
});

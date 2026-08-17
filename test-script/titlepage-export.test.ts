/**
 * Issue #52, re-opened: "title-page content lands on screenplay page 1".
 *
 * The editor was checked by hand on the iPad simulator and gets this right —
 * Format ▸ Title Page ▸ Apply puts the title page on its own page, and that
 * survives save → close → reopen. So this asks the question of the *exported*
 * file instead, which is the artefact a writer judges the result by, and covers
 * the two title pages the editor renders happily but the exporters treat
 * differently:
 *
 *   1. A full title page — every field filled, the shape `buildTitlePageBlocks`
 *      produces (TitlePageEditor.tsx:163). Does the whole thing fit the page?
 *   2. A title page with no Title. `hasTitlePage` (pdfExporter.ts:340,
 *      docxExporter.ts:384) is gated on a non-empty `tpTitle`, so this is the
 *      case where the exporter decides there is no title page at all.
 *
 * Output lands in test-script/output/ (gitignored) so the PDFs can be read back
 * with pdftotext.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../frontend/src/stores/editorStore';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'frontend', 'public');
const OUT_DIR = join(HERE, 'output');

const saved: Uint8Array[] = [];
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const bytes = readFileSync(join(PUBLIC_DIR, url));
      return {
        ok: true,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    } catch {
      return { ok: false };
    }
  }));
});

const text = (s: string): JSONContent => ({ type: 'text', text: s });

interface TpData { [k: string]: string }

/**
 * The node run Format ▸ Title Page produces.
 *
 * Mirrors `buildTitlePageBlocks` (TitlePageEditor.tsx:163-207) exactly — the
 * spacer arithmetic is the point of the test, so it is reproduced rather than
 * approximated.
 */
function titlePageBlocks(data: TpData): JSONContent[] {
  const blank = (): JSONContent => ({ type: 'titlePage', attrs: { field: 'blank' }, content: [] });
  const field = (f: string, t: string): JSONContent => ({
    type: 'titlePage',
    attrs: f === 'title' ? { field: 'title', ...data } : { field },
    content: t ? [text(t)] : [],
  });

  const TITLE_LINE = 15;
  const PAGE_LINES = 50;
  const byLine = data.tpWrittenBy ? `Written by ${data.tpWrittenBy}` : '';
  const draftLine = [data.tpDraft, data.tpDraftDate].filter(Boolean).join(' - ');

  const blocks: JSONContent[] = [];
  const topSpacers = Math.max(2, TITLE_LINE - 1);
  for (let i = 0; i < topSpacers; i++) blocks.push(blank());
  blocks.push(field('title', data.tpTitle || ''));
  let used = topSpacers + 1;
  if (byLine) { blocks.push(blank(), blank(), field('author', byLine)); used += 3; }

  const bottom: [string, string][] = [];
  if (draftLine) bottom.push(['draft', draftLine]);
  if (data.tpContact) bottom.push(['contact', data.tpContact]);
  if (data.tpCopyright) bottom.push(['copyright', data.tpCopyright]);
  if (data.tpNotes) bottom.push(['date', data.tpNotes]);
  const bottomLines = bottom.reduce((s, [, t]) => s + t.split('\n').length, 0);
  if (bottom.length) {
    const gap = Math.max(2, PAGE_LINES - used - bottomLines);
    for (let i = 0; i < gap; i++) blocks.push(blank());
    for (const [f, t] of bottom) blocks.push(field(f, t));
  }
  return blocks;
}

const BODY: JSONContent[] = [
  { type: 'sceneHeading', content: [text('INT. LAB - DAY')] },
  { type: 'action', content: [text('A car pulls up outside.')] },
];

const FULL: TpData = {
  tpTitle: 'THE LONG GOODBYE',
  tpWrittenBy: 'Jane Writer',
  tpDraft: 'Second Draft',
  tpDraftDate: '2026-08-17',
  tpContact: 'Jane Writer',
  tpCopyright: 'Copyright 2026 Jane Writer',
  tpNotes: 'CONFIDENTIAL',
};

/** Same title page with the Title field left blank — everything else filled. */
const NO_TITLE: TpData = { ...FULL, tpTitle: '' };

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');

async function exportPages(
  data: TpData,
  filename: string,
  lead: JSONContent[] = [],
): Promise<string[]> {
  saved.length = 0;
  const doc: JSONContent = { type: 'doc', content: [...lead, ...titlePageBlocks(data), ...BODY] };
  await exportPDF(doc, data.tpTitle || 'Untitled', DEFAULT_PAGE_LAYOUT);
  expect(saved.length, 'exporter produced a file').toBe(1);
  const path = join(OUT_DIR, filename);
  writeFileSync(path, saved[0]);
  // -layout keeps each PDF page a separate \f-delimited chunk.
  const out = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  return out.split('\f').filter((p) => p.trim().length > 0 || true);
}

describe('issue #52 — the exported title page', () => {
  it('keeps the body off the title page', async () => {
    const pages = await exportPages(FULL, 'titlepage-full.pdf');
    expect(pages[0]).not.toContain('INT. LAB');
    expect(pages[1] ?? '').toContain('INT. LAB');
  });

  it('carries every field the writer entered', async () => {
    const pages = await exportPages(FULL, 'titlepage-full.pdf');
    const titlePage = pages[0];
    for (const expected of [
      'THE LONG GOODBYE',
      'Written by Jane Writer',
      'Second Draft - 2026-08-17',
      'Copyright 2026 Jane Writer',
      'CONFIDENTIAL',
    ]) {
      expect(titlePage, `title page should carry "${expected}"`).toContain(expected);
    }
  });

  it('still makes a title page when only the Title field is empty', async () => {
    const pages = await exportPages(NO_TITLE, 'titlepage-no-title.pdf');
    expect(pages[0]).toContain('Written by Jane Writer');
    expect(pages[0]).not.toContain('INT. LAB');
  });

  it('does not let the title page consume a page number', async () => {
    // Default header is `{page}.` starting on page 2. The title page is not a
    // script page, so the first *script* page must stay unnumbered and the one
    // after it must be "2." — the same count the editor's status bar shows.
    // Numbering ran off the physical sheet index, so both were one too high.
    const long: JSONContent[] = [];
    for (let i = 0; i < 70; i++) long.push({ type: 'action', content: [text(`Line ${i}.`)] });

    saved.length = 0;
    const doc: JSONContent = { type: 'doc', content: [...titlePageBlocks(FULL), ...long] };
    await exportPDF(doc, FULL.tpTitle, DEFAULT_PAGE_LAYOUT);
    const path = join(OUT_DIR, 'titlepage-numbering.pdf');
    writeFileSync(path, saved[0]);
    const pages = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' }).split('\f');

    expect(pages[0], 'title page carries no number').not.toMatch(/^\s*\d+\.\s*$/m);
    expect(pages[1], 'first script page is unnumbered').not.toMatch(/^\s*\d+\.\s*$/m);
    expect(pages[2], 'second script page is numbered 2').toMatch(/^\s*2\.\s*$/m);
  });

  it('survives one stray line above it', async () => {
    // The title-page region is recognised only as the *leading* run of nodes
    // (pdfExporter.ts:334, docxExporter.ts:381). One element above it — a blank
    // Action the writer made by pressing Enter at the very top of the title —
    // and every title-page node is reclassified as body content.
    const lead: JSONContent[] = [{ type: 'action', content: [] }];
    const pages = await exportPages(FULL, 'titlepage-stray-line-above.pdf', lead);
    expect(pages[0], 'the body must not share page 1 with the title page')
      .not.toContain('INT. LAB');
  });
});

/**
 * The other half of the same bug: what the *importers* hand the exporters.
 *
 * Each of the three structured importers used to emit a single `titlePage` node
 * carrying the fields as attributes, with no laid-out run behind it. Nothing
 * expanded it on load, so an imported title page exported as one nearly-blank
 * page and lost every field but the title — until the writer happened to open
 * Format ▸ Title Page and press Apply.
 *
 * These go the whole way — file → parser → exportPDF → pdftotext — because that
 * is the path a writer actually takes, and the intermediate node shape is an
 * implementation detail that `titlePageRegion.test.ts` already pins.
 */
describe('issue #52 — an imported title page', () => {
  beforeAll(() => {
    if (typeof globalThis.DOMParser === 'undefined') {
      (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDOMParser;
    }
  });

  /** Every field the fixtures carry, as it should read on the exported page. */
  const EXPECTED = ['THE LONG GOODBYE', 'Written by Jane Writer', 'Copyright 2026 Jane Writer'];

  async function exportParsed(doc: JSONContent, filename: string): Promise<string[]> {
    saved.length = 0;
    await exportPDF(doc, 'Imported', DEFAULT_PAGE_LAYOUT);
    expect(saved.length, 'exporter produced a file').toBe(1);
    const path = join(OUT_DIR, filename);
    writeFileSync(path, saved[0]);
    return execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' }).split('\f');
  }

  function assertTitlePage(pages: string[], label: string): void {
    for (const expected of EXPECTED) {
      expect(pages[0], `${label}: title page should carry "${expected}"`).toContain(expected);
    }
    expect(pages[0], `${label}: body must not share the title page`).not.toContain('INT. LAB');
    expect(pages[1] ?? '', `${label}: body starts on the next page`).toContain('INT. LAB');
  }

  it('survives a .fountain round trip', async () => {
    const { parseFountain } = await import('../frontend/src/utils/fountainParser');
    const source = [
      'Title: THE LONG GOODBYE',
      'Author: Jane Writer',
      'Copyright: Copyright 2026 Jane Writer',
      '',
      'INT. LAB - DAY',
      '',
      'A car pulls up outside.',
      '',
    ].join('\n');
    assertTitlePage(
      await exportParsed(parseFountain(source) as JSONContent, 'imported-fountain.pdf'),
      'fountain',
    );
  });

  // No .fdx case here on purpose. fdxParser is built on querySelector, which
  // @xmldom/xmldom does not implement, so the node suite cannot drive it — the
  // same constraint recorded in test-script/fdx-font-roundtrip.mjs and
  // src/utils/fdxFonts.test.ts, which is why FDX round trips are staged in a
  // real browser instead. The FDX-specific part of this change is that it lays
  // the title page out for the page size the *file* declares rather than the
  // page size the editor happens to be showing; that is
  // `buildTitlePageBlocks(fields, layout)`, covered without a DOM in
  // frontend/src/utils/titlePageBlocks.test.ts.

  it('survives an .osf round trip', async () => {
    const { parseOSF } = await import('../frontend/src/utils/osfParser');
    const source = `<?xml version="1.0" encoding="utf-8"?>
<document type="Open Screenplay Format document" version="12">
  <info title="THE LONG GOODBYE" written_by="Jane Writer" copyright="Copyright 2026 Jane Writer"/>
  <styles><style name="Normal Text" builtin="1" builtin_index="0"/></styles>
  <paragraphs>
    <para><style basestylename="Scene Heading"/><text>INT. LAB - DAY</text></para>
    <para><style basestylename="Normal Text"/><text>A car pulls up outside.</text></para>
  </paragraphs>
</document>`;
    assertTitlePage(
      await exportParsed(parseOSF(source).doc as JSONContent, 'imported-osf.pdf'),
      'osf',
    );
  });

});

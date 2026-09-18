/**
 * Does a real script paginate the same on screen and in the PDF?
 *
 * Point it at an .fdx (or a saved .odraft) and it imports the file through the
 * app's own parser, lays it out through the editor's paginator and through the
 * PDF exporter, and reports the page counts plus the first element the two put
 * on different pages. That is the reported symptom of issue #123 — "the editor
 * says 33 pages, the PDF comes out 35" — reduced to something reproducible.
 *
 * Run from `frontend/`:
 *   FDX_FILE=~/path/to/script.fdx \
 *     npx vitest run --config ../test-script/vitest.config.ts fdx-pagination-check \
 *     --disable-console-intercept
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { JSONContent } from '@tiptap/react';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';

// The FDX parser reads XML with the platform DOMParser; node has none.
(globalThis as unknown as { DOMParser: unknown }).DOMParser = XmldomDOMParser;

interface Draw { text: string; page: number; y: number }
const draws: Draw[] = [];
let pageCount = 1;
let currentPage = 1;

vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    setFont(font: string) { this.font = font; }
    getFont() { return { fontName: this.font, fontStyle: 'normal' }; }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    line() {}
    rect() {}
    addPage() { pageCount++; currentPage = pageCount; }
    setPage(n: number) { currentPage = n; }
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, _x: number, y: number) { draws.push({ text, page: currentPage, y }); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});

vi.mock('../frontend/src/utils/fileOps', () => ({ saveFile: vi.fn(async () => true) }));

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');
const { computeBreaks, activeTemplateHints } = await import('../frontend/src/editor/pagination');
const { DEFAULT_PAGE_LAYOUT } = await import('../frontend/src/stores/editorStore');
const { pmDoc } = await import('../frontend/src/test/screenplaySchema');
const { parseFDXFull } = await import('../frontend/src/utils/fdxParser');
const { parseOdraft } = await import('../frontend/src/utils/odraftFormat');
const { stripSaveMetadata } = await import('../frontend/src/utils/saveContent');

const FILE = process.env.FDX_FILE;

/** The document and the page setup the file asks for. */
function load(path: string): { doc: JSONContent; layout: typeof DEFAULT_PAGE_LAYOUT } {
  const text = readFileSync(path.replace(/^~/, process.env.HOME ?? '~'), 'utf-8');
  if (path.endsWith('.odraft')) {
    const parsed = parseOdraft(text);
    const { pmDoc: content, metadata } = stripSaveMetadata(parsed.content);
    return {
      doc: content as JSONContent,
      layout: { ...DEFAULT_PAGE_LAYOUT, ...((metadata._pageLayout as object) ?? {}) },
    };
  }
  const parsed = parseFDXFull(text);
  return {
    doc: parsed.doc as unknown as JSONContent,
    layout: { ...DEFAULT_PAGE_LAYOUT, ...(parsed.pageLayout ?? {}) },
  };
}

describe('an imported script', () => {
  if (!FILE) {
    it.skip('needs FDX_FILE', () => {});
    return;
  }

  it('paginates the same on screen and in the PDF', async () => {
    const { doc, layout } = load(FILE);
    const nodes = doc.content ?? [];

    const state = computeBreaks(pmDoc(doc), layout, activeTemplateHints());
    const editor: number[] = new Array(nodes.length).fill(1);
    {
      let page = 1;
      let b = 0;
      for (let i = 0; i < nodes.length; i++) {
        while (b < state.breaks.length && state.breaks[b].nodeIndex === i) {
          page = state.breaks[b].pageNumber; b++;
        }
        editor[i] = page;
      }
    }

    draws.length = 0; pageCount = 1; currentPage = 1;
    await exportPDF(doc, 'FDX check', layout);

    // Which sheet each element was drawn on. Elements are matched by their own
    // text, so nothing has to be tagged first — a line is attributed to the
    // last element whose opening text it matches.
    const hasTitlePage = state.breaks.some((b) => b.isTitlePage);
    const pdf: number[] = new Array(nodes.length).fill(-1);
    {
      const key = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 24).toUpperCase();
      const byText = new Map<string, number[]>();
      nodes.forEach((n, i) => {
        const t = key(plainOf(n));
        if (!t) return;
        const list = byText.get(t);
        if (list) list.push(i); else byText.set(t, [i]);
      });
      const used = new Set<number>();
      for (const d of draws) {
        const hit = byText.get(key(d.text));
        if (!hit) continue;
        const idx = hit.find((i) => !used.has(i));
        if (idx === undefined) continue;
        used.add(idx);
        pdf[idx] = d.page - (hasTitlePage ? 1 : 0);
      }
    }

    const pdfPages = pageCount - (hasTitlePage ? 1 : 0);
    const disagree = editor
      .map((p, i) => ({ i, type: String(nodes[i].type), editor: p, pdf: pdf[i] }))
      .filter((r) => r.pdf !== -1 && r.pdf !== r.editor);

    console.log(`${FILE}`);
    console.log(`  elements ${nodes.length}`);
    console.log(`  editor pages ${state.pageCount}   pdf pages ${pdfPages}`);
    const kinds = new Map<string, number>();
    for (const n of nodes) kinds.set(String(n.type), (kinds.get(String(n.type)) ?? 0) + 1);
    console.log(`  elements by type: ${[...kinds].map(([k, v]) => `${k}=${v}`).join(' ')}`);
    const undrawn = pdf.filter((p, i) => p === -1 && plainOf(nodes[i]).trim() !== '').length;
    if (undrawn) console.log(`  ${undrawn} element(s) never matched a drawn line`);
    if (disagree.length) {
      const first = disagree[0];
      console.log(`  first divergence: element ${first.i} (${first.type})`
        + ` — editor page ${first.editor}, pdf page ${first.pdf}`);
      for (let k = Math.max(0, first.i - 12); k <= first.i + 2 && k < nodes.length; k++) {
        console.log(`  ${String(k).padStart(5)} ${String(nodes[k].type).padEnd(16)}`
          + ` editor p${editor[k]} pdf p${pdf[k]}  ${JSON.stringify(plainOf(nodes[k]).slice(0, 44))}`);
      }
    }

    expect(pdfPages, 'the PDF has as many pages as the editor shows').toBe(state.pageCount);
    expect(disagree.slice(0, 5)).toEqual([]);
  }, 300_000);
});

/** All the text under a node, however deeply it is nested. */
function plainOf(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(plainOf).join('');
}

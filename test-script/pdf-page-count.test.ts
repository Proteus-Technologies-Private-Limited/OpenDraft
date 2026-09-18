/**
 * End to end, through the real jsPDF: the file has as many pages as the editor
 * says the script has.
 *
 * The parity suite in frontend/src/utils/pdfPagination.test.ts fakes jsPDF so
 * it can see which sheet every element landed on. This one takes the other
 * half of the check — it writes a real PDF to test-script/output/ and counts
 * its pages — so the answer is read off the file a writer would actually send.
 * Before issue #123 was fixed this script came out one page longer than the
 * editor showed.
 *
 * Run from `frontend/`:
 *   npx vitest run --config ../test-script/vitest.config.ts pdf-page-count
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';

const saved: Uint8Array[] = [];
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const w = globalThis.window as unknown as Record<string, unknown> | undefined;
if (w && typeof w.atob !== 'function') { w.atob = atob; w.btoa = btoa; }

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');
const { computeBreaks, activeTemplateHints } = await import('../frontend/src/editor/pagination');
const { DEFAULT_PAGE_LAYOUT } = await import('../frontend/src/stores/editorStore');
const { pmDoc } = await import('../frontend/src/test/screenplaySchema');

const OUT = join(__dirname, 'output');
beforeAll(() => { mkdirSync(OUT, { recursive: true }); });

const b = (type: string, text: string): JSONContent => ({ type, content: [{ type: 'text', text }] });

describe('real jsPDF', () => {
  it('writes a PDF whose page count matches the editor', async () => {
    const content: JSONContent[] = [];
    const line = 'the quick brown fox jumps over the lazy dog and keeps running until dawn';
    for (let s = 0; s < 12; s++) {
      content.push(b('sceneHeading', `INT. WAREHOUSE ${s} - NIGHT`));
      for (let k = 0; k < 4; k++) content.push(b('action', `${line} ${line}`));
      content.push(b('character', 'MAYA'));
      for (let k = 0; k < 3; k++) content.push(b('dialogue', line));
    }
    const json = { type: 'doc', content };
    const { pageCount } = computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT, activeTemplateHints());

    saved.length = 0;
    await exportPDF(json, 'Issue 123 check', DEFAULT_PAGE_LAYOUT);
    expect(saved).toHaveLength(1);
    const bytes = saved[0];
    const out = join(OUT, 'issue-123-parity.pdf');
    writeFileSync(out, bytes);

    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    const pdfPages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    console.log(`editor pageCount=${pageCount}  pdf pages=${pdfPages}  -> ${out}`);
    expect(pdfPages).toBe(pageCount);
  }, 60_000);
});

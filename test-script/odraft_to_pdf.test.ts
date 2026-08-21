/**
 * Render a converted .odraft back to PDF with OpenDraft's own exporter.
 *
 * The schema check in validate_odraft.test.ts proves the file *loads*. This
 * proves it *reads* — it lays the document out through the same code path the
 * app's File ▸ Export uses, so the result can be put side by side with the
 * source PDF and compared page for page. A conversion that mislabels an element
 * still loads cleanly; it only looks wrong once something paginates it.
 *
 * Output lands in test-script/output/ (gitignored). Run from `frontend/`:
 *   ODRAFT_FILE="../test-script/output/NAME.odraft" \
 *     npx vitest run --config ../test-script/vitest.odraft.config.ts
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOdraft } from '../frontend/src/utils/odraftFormat';
import { stripSaveMetadata } from '../frontend/src/utils/saveContent';
import { DEFAULT_PAGE_LAYOUT } from '../frontend/src/stores/editorStore';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'frontend', 'public');
const OUT_DIR = join(HERE, 'output');
const FILE = process.env.ODRAFT_FILE;

/** saveFile reaches for Tauri or the DOM; capture the bytes instead. */
const saved: Uint8Array[] = [];
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

/** jsPDF binds atob/btoa off `window` at module load. */
const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

/** Serve the bundled fonts off disk, as the app serves them from /fonts. */
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

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');

describe('converted .odraft, rendered back to PDF', () => {
  if (!FILE) {
    it.skip('needs ODRAFT_FILE', () => {});
    return;
  }

  it('lays out through the real exporter', async () => {
    const parsed = parseOdraft(readFileSync(FILE, 'utf-8'));
    const { pmDoc, metadata } = stripSaveMetadata(parsed.content);
    const layout = { ...DEFAULT_PAGE_LAYOUT, ...(metadata._pageLayout as object ?? {}) };

    saved.length = 0;
    await exportPDF(pmDoc, parsed.meta.title, layout);
    expect(saved.length, 'exporter produced a file').toBe(1);

    const out = join(OUT_DIR, `${basename(FILE, '.odraft')} (round-trip).pdf`);
    writeFileSync(out, saved[0]);
    expect(readFileSync(out).toString('latin1').startsWith('%PDF-')).toBe(true);
    console.log(`wrote ${out}`);
  }, 120_000);
});

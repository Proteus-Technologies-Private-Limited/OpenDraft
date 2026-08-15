/**
 * Issue #71, end to end: export a Cyrillic screenplay to a real PDF on disk.
 *
 * The suite in frontend/src/utils already reads the produced bytes and checks
 * the ToUnicode CMap. This goes one step further and writes the file out, so
 * an independent reader (poppler's pdftotext) can be asked the question the
 * reporter actually asked: does the text come back out as the Cyrillic that
 * was typed, or as the Latin run `" ' B > C B` that the bug produced?
 *
 * Output lands in test-script/output/ (gitignored).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../frontend/src/stores/editorStore';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', 'frontend', 'public');
const OUT_DIR = join(HERE, 'output');

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

const text = (s: string): JSONContent => ({ type: 'text', text: s });

/** The reporter's scenario: a screenplay written in Cyrillic. */
const cyrillic: JSONContent = {
  type: 'doc',
  content: [
    { type: 'titlePage', attrs: { field: 'title', tpTitle: true }, content: [text('Тихий Дон')] },
    { type: 'titlePage', attrs: { field: 'author' }, content: [text('Михаил Шолохов')] },
    { type: 'sceneHeading', content: [text('ИНТ. БИБЛИОТЕКА — ДЕНЬ')] },
    { type: 'action', content: [text('ПРОГРАММИСТ печатает.')] },
    { type: 'character', content: [text('ПРОГРАММИСТ')] },
    { type: 'dialogue', content: [text('Что бы я ни пытался, ничего не выходит.')] },
  ],
};

/** The other scripts the fix claims to cover. */
const multiScript: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('ИНТ. АРХИВ — НОЧЬ')] },
    { type: 'action', content: [text('Ελληνικά: Καλημέρα κόσμε.')] },
    { type: 'action', content: [text('Հայերեն: Բարև աշխարհ։')] },
    { type: 'action', content: [text('ქართული: გამარჯობა მსოფლიო.')] },
  ],
};

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');

async function exportToDisk(doc: JSONContent, title: string, filename: string): Promise<string> {
  saved.length = 0;
  await exportPDF(doc, title, DEFAULT_PAGE_LAYOUT);
  expect(saved.length, 'exporter produced a file').toBe(1);
  const path = join(OUT_DIR, filename);
  writeFileSync(path, saved[0]);
  return path;
}

describe('issue #71 — Cyrillic PDF export, written to disk', () => {
  it('writes a Cyrillic screenplay whose text reads back as Cyrillic', async () => {
    const path = await exportToDisk(cyrillic, 'Тихий Дон', 'cyrillic-screenplay.pdf');
    // The assertion the reporter would make: open it and read the text.
    // pdftotext is run separately by the harness script; here assert the file
    // is a real PDF carrying an embedded font program rather than a
    // Standard-14 reference that no reader can decode.
    const raw = readFileSync(path).toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('/FontFile2');
    expect(raw).toMatch(/\/BaseFont\s*\/[A-Za-z+]*DejaVuSansMono/);
  });

  it('writes Greek, Armenian and Georgian too', async () => {
    const path = await exportToDisk(multiScript, 'Скрипты', 'multi-script.pdf');
    const raw = readFileSync(path).toString('latin1');
    expect(raw).toContain('/FontFile2');
  });

  it('keeps a Latin screenplay on the built-in Courier, unchanged', async () => {
    const latin: JSONContent = {
      type: 'doc',
      content: [
        { type: 'sceneHeading', content: [text('INT. LIBRARY - DAY')] },
        { type: 'action', content: [text('A PROGRAMMER types.')] },
      ],
    };
    const path = await exportToDisk(latin, 'Latin', 'latin-screenplay.pdf');
    const raw = readFileSync(path).toString('latin1');
    // No embedded font program: the regression guard that the fix did not
    // change what already worked.
    expect(raw).not.toContain('/FontFile2');
  });
});

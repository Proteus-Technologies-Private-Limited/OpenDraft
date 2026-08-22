/**
 * Worked example: replay a browser-parsed .fdx through the real PDF exporter.
 *
 * The document under test was produced by the real `parseFDXFull` running in a
 * real browser DOM (see README) and posted back to `out/parsed-doc.json`. This
 * file picks it up from there, so the chain actually exercised is
 * `.fdx` bytes → fdxParser in Chrome → pdfExporter → a real PDF → text.
 *
 * Regenerate the input by serving the harness and running:
 *
 *   const rt = await window.h.roundTrip('titlepage.fdx', 'THE LONG GOODBYE');
 *   await window.h.save('parsed-doc.json',
 *     { doc: rt.first.doc, pageLayout: rt.first.pageLayout });
 *
 * Skips itself when that file is absent, so it cannot fail a CI run that has no
 * browser step.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../../frontend/src/stores/editorStore';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(HERE, '..', '..', 'frontend', 'public');
const OUT_DIR = join(HERE, '..', 'output');
const PARSED = join(HERE, 'out', 'parsed-doc.json');

const saved: Uint8Array[] = [];
vi.mock('../../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

const available = existsSync(PARSED);

describe.skipIf(!available)('an .fdx parsed in a browser, exported to PDF', () => {
  let pages: string[] = [];

  beforeAll(async () => {
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

    const parsed = JSON.parse(readFileSync(PARSED, 'utf8')) as {
      doc: JSONContent; pageLayout: Record<string, number> | null;
    };
    const { exportPDF } = await import('../../frontend/src/utils/pdfExporter');

    saved.length = 0;
    await exportPDF(parsed.doc, 'THE LONG GOODBYE', { ...DEFAULT_PAGE_LAYOUT, ...(parsed.pageLayout ?? {}) });
    expect(saved.length, 'exporter produced a file').toBe(1);

    const path = join(OUT_DIR, 'fdx-browser-harness.pdf');
    writeFileSync(path, saved[0]);
    pages = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' }).split('\f');
  });

  it('puts the title page on its own page', () => {
    expect(pages[0]).toContain('THE LONG GOODBYE');
    expect(pages[0], 'the script must not share page 1').not.toContain('INT. LAB');
    expect(pages[1]).toContain('INT. LAB - DAY');
  });

  it('carries every title-page field the file held', () => {
    for (const expected of [
      'THE LONG GOODBYE',
      'Written by Jane Writer',
      'Second Draft',
      'jane@example.com',
      'Copyright 2026 Jane Writer',
    ]) {
      expect(pages[0], `title page should carry "${expected}"`).toContain(expected);
    }
  });

  it('leaves the first script page unnumbered', () => {
    expect(pages[0]).not.toMatch(/^\s*\d+\.\s*$/m);
    expect(pages[1]).not.toMatch(/^\s*\d+\.\s*$/m);
  });

  it('keeps the script itself intact', () => {
    expect(pages[1]).toContain('A car pulls up outside.');
    expect(pages[1]).toContain('JANE');
    expect(pages[1]).toContain('We are live.');
  });
});

/**
 * A Cyrillic screenplay, exported.
 *
 * Issue #71: jsPDF's built-in faces are WinAnsi-encoded, so a Cyrillic script
 * went out as two-byte UTF-16 that a reader printed one Latin character per
 * byte — `Что бы` became `" ' B > C B`. These tests run the real jsPDF, read
 * the produced bytes, and check the Cyrillic is written through an embedded
 * font with a ToUnicode map that names the code points the writer typed.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

/** saveFile reaches for Tauri or the DOM; capture the bytes instead. */
const saved: Uint8Array[] = [];
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

/** jsPDF binds atob/btoa off `window` at module load — see exportFonts.integration.test.ts. */
const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

/**
 * The bundled fonts, served off disk.
 *
 * The exporter fetches them from `/fonts` as the app does; nothing else in the
 * suite has a server, so this stands in for one — and it means the tests read
 * the actual shipped files, not a fixture that could drift from them.
 */
beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const bytes = readFileSync(join(process.cwd(), 'public', url));
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    } catch {
      return { ok: false };
    }
  }));
});

const text = (s: string): JSONContent => ({ type: 'text', text: s });

const cyrillic: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('ИНТ. БИБЛИОТЕКА — ДЕНЬ')] },
    { type: 'action', content: [text('ПРОГРАММИСТ печатает.')] },
    { type: 'character', content: [text('ПРОГРАММИСТ')] },
    { type: 'dialogue', content: [text('Что бы я ни пытался, ничего не выходит.')] },
  ],
};

const latin: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [text('INT. LIBRARY - DAY')] },
    { type: 'action', content: [text('A PROGRAMMER types.')] },
  ],
};

const { exportPDF } = await import('./pdfExporter');

async function exportBytes(doc: JSONContent, title = 'Test', options?: Record<string, unknown>): Promise<string> {
  saved.length = 0;
  await exportPDF(doc, title, DEFAULT_PAGE_LAYOUT, options);
  return Buffer.from(saved[0]).toString('latin1');
}

/**
 * The code points a PDF says it can be copied back out as.
 *
 * jsPDF writes a ToUnicode CMap alongside an embedded font: `<0041> <0410>`
 * pairs mapping the glyph codes in the content stream to the text they stand
 * for. Reading it back is how these tests see the writer's own characters
 * rather than trusting the exporter's own account of them.
 */
function toUnicodeCodePoints(pdf: string): Set<number> {
  const points = new Set<number>();
  for (const section of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) {
      points.add(parseInt(pair[1], 16));
    }
  }
  return points;
}

const codePointsOf = (s: string) => [...s].map((c) => c.codePointAt(0)!);

describe('a Cyrillic screenplay', () => {
  it('embeds a font program, instead of writing bytes no reader can decode', async () => {
    const pdf = await exportBytes(cyrillic);
    expect(pdf).toContain('/FontFile2'); // an embedded TrueType, not a Standard 14 reference
    expect(pdf).toMatch(/\/BaseFont\s*\/[A-Za-z+]*DejaVuSansMono/);
  });

  it('keeps every character the writer typed', async () => {
    const mapped = toUnicodeCodePoints(await exportBytes(cyrillic));
    const typed = new Set(codePointsOf('ИНТ.БИБЛИОТЕКАДЕНЬПРОГРАММИСТпечатаетЧтобыянипытался,ничеговыходит'));
    for (const cp of typed) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });

  it('embeds the bold weight for a bold scene heading, not just the regular one', async () => {
    const pdf = await exportBytes(cyrillic);
    // Two font programs: the scene heading is bold, the rest of the script is
    // not, and jsPDF embeds a subset per style it was asked to draw.
    expect(pdf.match(/\/FontFile2/g)?.length).toBe(2);
  });

  it('carries a Cyrillic title page and header through as text', async () => {
    const titled: JSONContent = {
      type: 'doc',
      content: [
        { type: 'titlePage', attrs: { field: 'title', tpTitle: true }, content: [text('Тихий Дон')] },
        { type: 'titlePage', attrs: { field: 'author' }, content: [text('Михаил Шолохов')] },
        ...cyrillic.content!,
      ],
    };
    const mapped = toUnicodeCodePoints(await exportBytes(titled, 'Тихий Дон', {
      documentTitle: 'Тихий Дон',
    }));
    for (const cp of codePointsOf('ТИХИЙДОНМихаилШолхв')) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });

  it('is unaffected by the document font — a face that cannot write it does not get to', async () => {
    const mapped = toUnicodeCodePoints(await exportBytes(cyrillic, 'Test', { documentFont: 'Times New Roman' }));
    for (const cp of codePointsOf('Что')) {
      expect(mapped.has(cp), String.fromCodePoint(cp)).toBe(true);
    }
  });
});

describe('a Latin screenplay', () => {
  it('embeds no font at all, exactly as before', async () => {
    const pdf = await exportBytes(latin);
    expect(pdf).not.toContain('/FontFile2');
    expect(pdf).not.toContain('DejaVuSansMono');
  });

  it('is byte-for-byte what it was, whatever a Cyrillic export did to the module', async () => {
    // The font bytes are cached across exports; a Latin script must still come
    // out of a clean Standard 14 path afterwards. Only the file id, which jsPDF
    // stamps per document, is allowed to differ.
    const withoutFileId = (pdf: string) => pdf.replace(/\/ID \[[^\]]*\]/, '');
    const before = withoutFileId(await exportBytes(latin));
    await exportBytes(cyrillic);
    expect(withoutFileId(await exportBytes(latin))).toBe(before);
  });
});

describe('the exported filename', () => {
  it('keeps a Cyrillic title instead of saving it as Untitled', async () => {
    const { saveFile } = await import('./fileOps');
    saved.length = 0;
    await exportPDF(latin, 'Тихий Дон', DEFAULT_PAGE_LAYOUT);
    expect(vi.mocked(saveFile).mock.lastCall?.[1]).toBe('Тихий Дон.pdf');
  });

  it('still drops what a filesystem would object to', async () => {
    const { saveFile } = await import('./fileOps');
    await exportPDF(latin, 'Act 1/2: "Дом"?', DEFAULT_PAGE_LAYOUT);
    expect(vi.mocked(saveFile).mock.lastCall?.[1]).toBe('Act 12 Дом.pdf');
  });
});

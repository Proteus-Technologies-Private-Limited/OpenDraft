/**
 * Repro for "this text does not export hindi alphabets".
 *
 * Runs the real PDF exporter over the exact text the user pasted, with the
 * document font they reported (Roboto), and reports what the file actually
 * paints.  Writes the PDF to test-script/output/ so it can be opened.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DEFAULT_PAGE_LAYOUT } from '../frontend/src/stores/editorStore';

const saved: Uint8Array[] = [];
vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.push(data); return true; }),
}));

const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

const FONT_ROOT = join(process.cwd(), 'frontend', 'public');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    try {
      const bytes = readFileSync(join(FONT_ROOT, url));
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
    } catch (err) {
      console.warn('[repro] font fetch failed for', url, String(err));
      return { ok: false };
    }
  }));
});

const text = (s: string): JSONContent => ({ type: 'text', text: s });

const LINES = [
  'test',
  'अंग्रेजी कीबोर्ड पर हिंदी शब्दों को बोल के अनुसार (phonetically) अंग्रेजी अक्षरों में लिखें। उदाहरण के लिए, "namaste" लिखें।',
  'test',
  'The song plays',
  'जीवन से भरी तेरी आँखें',
  'मजबूर करें जीने के लिए',
  'सागर भी तरसते रहते हैं',
  'तेरे रूप का रस पीने के लिए',
  'मधुबन की सुगंध है साँसों में',
  'बाहों में कमल की कोमलता',
];

const doc: JSONContent = {
  type: 'doc',
  content: LINES.map((line) => ({ type: 'action', content: [text(line)] })),
};

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');

async function run(options?: Record<string, unknown>): Promise<string> {
  saved.length = 0;
  const result = await exportPDF(doc, 'HindiRepro', DEFAULT_PAGE_LAYOUT, options);
  console.log('[repro] warning:', (result as { warning?: string })?.warning ?? '(none)');
  expect(saved.length).toBeGreaterThan(0);
  return Buffer.from(saved[0]).toString('latin1');
}

function toUnicodeCodePoints(pdf: string): Set<number> {
  const points = new Set<number>();
  for (const section of pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]+)>/g)) {
      points.add(parseInt(pair[1], 16));
    }
  }
  return points;
}

const devanagariIn = (...texts: string[]) => new Set(
  [...texts.join('')].map((c) => c.codePointAt(0)!).filter((cp) => cp >= 0x0900 && cp <= 0x097f),
);

describe('the pasted Hindi text', () => {
  for (const font of [undefined, 'Roboto', 'Courier Prime']) {
    it(`exports its Devanagari with documentFont=${font ?? '(none)'}`, async () => {
      const pdf = await run(font ? { documentFont: font } : undefined);
      mkdirSync(join(process.cwd(), 'test-script', 'output'), { recursive: true });
      writeFileSync(
        join(process.cwd(), 'test-script', 'output', `hindi-${font ?? 'default'}.pdf`),
        Buffer.from(saved[0]),
      );
      const hasDevanagariFace = /\/BaseFont\s*\/[A-Za-z+]*NotoSansDevanagari/.test(pdf);
      const mapped = toUnicodeCodePoints(pdf);
      const wanted = [...devanagariIn(...LINES)];
      const missing = wanted.filter((cp) => !mapped.has(cp)).map((cp) => String.fromCodePoint(cp));
      console.log(`[repro] font=${font ?? '(none)'} devanagariFaceEmbedded=${hasDevanagariFace}`
        + ` wanted=${wanted.length} missing=${missing.length} ${missing.join('')}`);
      expect(hasDevanagariFace).toBe(true);
      expect(missing).toEqual([]);
    });
  }
});

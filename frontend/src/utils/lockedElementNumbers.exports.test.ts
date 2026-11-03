/** Verify stored-reference visibility consistently in the actual export paths. */
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import type { JSONContent } from '@tiptap/core';
const saved = vi.hoisted(() => ({ bytes: null as Uint8Array | null }));
const drawn = vi.hoisted(() => [] as string[]);
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (bytes) => {
    saved.bytes = bytes;
    return true;
  }),
}));
vi.mock('jspdf', () => ({
  default: class {
    setFont() {}
    getFont() {
      return { fontName: 'courier', fontStyle: 'normal' };
    }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    line() {}
    rect() {}
    addPage() {}
    setPage() {}
    addImage() {}
    getTextWidth(text: string) {
      return text.length * 7.2;
    }
    text(text: string) {
      drawn.push(text);
    }
    output() {
      return new ArrayBuffer(0);
    }
  },
}));
const { exportFDX } = await import('./fdxExporter');
const { exportDocx } = await import('./docxExporter');
const { exportPDF } = await import('./pdfExporter');
vi.stubGlobal('DOMParser', DOMParser);
const source: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'shot',
      attrs: { elementNumber: 'S7', elementNumberAutomatic: true },
      content: [{ type: 'text', text: 'CLOSE ON' }],
    },
    { type: 'action', content: [{ type: 'text', text: 'A quiet room.' }] },
  ],
};
describe('stored-reference export visibility', () => {
  it.each([undefined, false, true])(
    'uses the same visibility in PDF, DOCX and FDX (%s)',
    async (visible) => {
      const before = JSON.stringify(source);
      const options = visible === undefined ? undefined : { elementNumbersVisible: visible };
      drawn.length = 0;
      await exportPDF(source, 'References', DEFAULT_PAGE_LAYOUT, options);
      expect(drawn.includes('S7')).toBe(visible !== false);
      await exportDocx(source, 'References', DEFAULT_PAGE_LAYOUT, options);
      const zip = await JSZip.loadAsync(saved.bytes!);
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml.includes('S7')).toBe(visible !== false);
      const fdx = exportFDX(
        source,
        'References',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        options,
      );
      expect(fdx.includes('Number="S7"')).toBe(visible !== false);
      expect(JSON.stringify(source)).toBe(before);
    },
  );
});

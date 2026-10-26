/**
 * Sides, selected pages, watermarks and passwords — run through the real
 * jsPDF and read back with pdf.js, so what is checked is the file a reader
 * would open.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';

const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

const { renderPDF, crossOutBands, selectedSheets, pdfEncryption, watermarkFor } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { extractPdfPages } = await import('./pdfImport');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const {
  sceneRanges, keepScenes, keepCharacter, keepLocation, keepTags, scenesWithCharacter, speakingCharacters,
} = await import('./pageSelection');

const el = (type: string, text: string, attrs?: Record<string, unknown>, marks?: JSONContent['marks']): JSONContent => ({
  type, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }], ...(attrs ? { attrs } : {}),
});
const filler = (n: number, label: string) => Array.from({ length: n }, (_, i) => el('action', `${label} beat ${i + 1}.`));

/** Three scenes; the first two fill a page each, the third is short. */
const script: JSONContent = {
  type: 'doc',
  content: [
    el('sceneHeading', 'INT. KITCHEN - NIGHT', { sceneNumber: '1' }),
    ...filler(30, 'Kitchen'),
    el('character', 'MAYA'),
    el('dialogue', 'Kitchen line.'),
    el('sceneHeading', 'EXT. ROOF - DAY', { sceneNumber: '2' }),
    el('action', 'A prop.', undefined, [{ type: 'productionTag', attrs: { tagId: 'tag-1', categoryId: 'props' } }]),
    ...filler(30, 'Roof'),
    el('sceneHeading', 'INT. KITCHEN - LATER', { sceneNumber: '3' }),
    el('character', 'DEV'),
    el('dialogue', 'Later line.'),
  ],
};

const bytesOf = async (options: Parameters<typeof renderPDF>[3]) => {
  const { bytes } = await renderPDF(script, 'T', DEFAULT_PAGE_LAYOUT, { sceneNumbersVisible: true, ...options });
  return bytes;
};
const pagesOf = async (options: Parameters<typeof renderPDF>[3]) =>
  extractPdfPages((await bytesOf(options)).slice().buffer as ArrayBuffer);
const textOfPage = (page: { lines: Array<{ segments: Array<{ text: string }> }> }) =>
  page.lines.map((l) => l.segments.map((s) => s.text).join(' ')).join('\n');

describe('choosing what to keep', () => {
  it('finds the scenes and who speaks in them', () => {
    expect(sceneRanges(script).map((s) => [s.number, s.location])).toEqual([['1', 'KITCHEN'], ['2', 'ROOF'], ['3', 'KITCHEN']]);
    expect(speakingCharacters(script)).toEqual(['MAYA', 'DEV']);
    expect(scenesWithCharacter(script, 'dev')).toEqual([2]);
  });

  it('keeps a character\'s cues and speeches, and nothing else', () => {
    const keep = keepCharacter(script, 'MAYA');
    const kept = (script.content ?? []).map((_, i) => i).filter(keep);
    expect(kept.map((i) => script.content![i].type)).toEqual(['character', 'dialogue']);
  });

  it('keeps a location\'s scenes and a tag\'s elements', () => {
    const atKitchen = (script.content ?? []).map((_, i) => i).filter(keepLocation(script, 'kitchen'));
    expect(atKitchen).toContain(0);
    expect(atKitchen).not.toContain(33);
    expect((script.content ?? []).map((_, i) => i).filter(keepTags(script, ['tag-1']))).toEqual([34]);
  });
});

describe('selected pages in the PDF', () => {
  it('keeps only the pages holding the chosen scene, with their own page numbers', async () => {
    const all = await pagesOf({});
    const sides = await pagesOf({ pageSelection: { keep: keepScenes(script, [2]) } });
    expect(all.length).toBeGreaterThan(sides.length);
    const text = sides.map(textOfPage).join('\n');
    expect(text).toContain('INT. KITCHEN - LATER');
    expect(text).not.toContain('Kitchen beat 1.');
    // The page number printed is the one it has in the full script.
    const lastNumber = textOfPage(all[all.length - 1]).match(/^(\d+)\.$/m)?.[1];
    expect(textOfPage(sides[sides.length - 1])).toMatch(new RegExp(`^${lastNumber}\\.$`, 'm'));
  });

  it('throws the given message when nothing matches', async () => {
    await expect(renderPDF(script, 'T', DEFAULT_PAGE_LAYOUT, {
      pageSelection: { keep: () => false, emptyMessage: 'Nobody here.' },
    })).rejects.toThrow('Nobody here.');
  });

  it('crosses out the unselected runs on a kept page', () => {
    const placements = [
      { srcIndex: 0, sheet: 2, top: 72, bottom: 96 },
      { srcIndex: 1, sheet: 2, top: 108, bottom: 132 },
      { srcIndex: 2, sheet: 2, top: 144, bottom: 168 },
      { srcIndex: 3, sheet: 2, top: 180, bottom: 204 },
      { srcIndex: 4, sheet: 3, top: 72, bottom: 96 },
    ];
    const keep = (i: number) => i === 2;
    expect(crossOutBands(placements, keep, 2)).toEqual([{ top: 72, bottom: 132 }, { top: 180, bottom: 204 }]);
    expect([...selectedSheets(placements, keep, 0)]).toEqual([2]);
    // The title page is never part of a selection.
    expect([...selectedSheets(placements, keep, 2)]).toEqual([]);
  });
});

describe('watermarks', () => {
  it('prints a footer watermark on every page', async () => {
    const pages = await pagesOf({ watermark: { text: 'FOR JANE DOE', style: 'footer' } });
    // A footer sits in the bottom margin, which the importer reads as page
    // furniture — so look at the raw text instead.
    const pdf = await pdfjs.getDocument({ data: await bytesOf({ watermark: { text: 'FOR JANE DOE', style: 'footer' } }) }).promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      expect(content.items.map((i) => ('str' in i ? i.str : '')).join(' ')).toContain('FOR JANE DOE');
    }
    expect(pages.length).toBe(pdf.numPages);
    await pdf.destroy();
  });

  it('draws a diagonal watermark at an angle on every page', async () => {
    const pdf = await pdfjs.getDocument({ data: await bytesOf({ watermark: { text: 'CONFIDENTIAL' } }) }).promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      const mark = content.items.find((i) => 'str' in i && i.str === 'CONFIDENTIAL') as { transform: number[] } | undefined;
      expect(mark).toBeDefined();
      expect(Math.abs(mark!.transform[1])).toBeGreaterThan(0.1);
    }
    await pdf.destroy();
  });

  it('puts each recipient\'s name in the text', () => {
    expect(watermarkFor('CONFIDENTIAL', null)).toBe('CONFIDENTIAL');
    expect(watermarkFor('CONFIDENTIAL', 'Jane')).toBe('CONFIDENTIAL — Jane');
    expect(watermarkFor('Copy for {recipient}', 'Jane')).toBe('Copy for Jane');
    expect(watermarkFor('', 'Jane')).toBe('Jane');
    expect(watermarkFor('Copy for {recipient}', null)).toBe('Copy for');
  });
});

describe('password and permissions', () => {
  it('asks nothing of an open file', () => {
    expect(pdfEncryption(null)).toBeNull();
    expect(pdfEncryption({ allowPrinting: true, allowCopying: true })).toBeNull();
  });

  it('withholds what was not allowed, behind an owner password', () => {
    const enc = pdfEncryption({ allowPrinting: true, allowCopying: false })!;
    expect(enc.userPermissions).toEqual(['print']);
    expect(enc.ownerPassword).toMatch(/^[0-9a-f]{32}$/);
    expect(enc.userPassword).toBeUndefined();
  });

  it('writes a file that opens only with its password', async () => {
    const bytes = await bytesOf({ security: { userPassword: 'hunter2' } });
    await expect(pdfjs.getDocument({ data: bytes.slice() }).promise).rejects.toMatchObject({ name: 'PasswordException' });
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), password: 'hunter2' }).promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(text).toContain('INT. KITCHEN - NIGHT');
    await pdf.destroy();
  });
});

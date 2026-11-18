/**
 * Line spacing (utils/lineSpacing): one multiplier per element, read by the
 * editor's pagination, the page CSS, the PDF, DOCX and FDX exporters — and
 * Standard (1) leaving every one of them exactly as it was.
 *
 * Page-for-page agreement between the editor and the PDF at open spacing is
 * swept over whole generated scripts in utils/pdfPagination.test.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import JSZip from 'jszip';

// ── jsPDF, faked: record where each line of text is drawn ───────────────
interface Draw { text: string; page: number; y: number }
const draws: Draw[] = [];
let pdfPages = 1;
let pdfPage = 1;
vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    internal = { pages: [null, []] as unknown[] };
    setFont(font: string) { this.font = font; }
    getFont() { return { fontName: this.font, fontStyle: 'normal' }; }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    setDrawColor() {}
    setTextColor() {}
    setFillColor() {}
    getFillColor() { return '#000000'; }
    getTextColor() { return '#000000'; }
    getDrawColor() { return '#000000'; }
    line() {}
    rect() {}
    addPage() { pdfPages++; pdfPage = pdfPages; this.internal.pages.push([]); }
    deletePage() { this.internal.pages.pop(); }
    setPage(n: number) { pdfPage = n; }
    getNumberOfPages() { return pdfPages; }
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, _x: number, y: number) { draws.push({ text, page: pdfPage, y }); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF, jsPDF: FakeJsPDF };
});

const saved: { buf: Uint8Array | null } = { buf: null };
vi.mock('./fileOps', () => ({
  saveFile: vi.fn(async (data: Uint8Array) => { saved.buf = data; return true; }),
}));

const {
  normalizeLineSpacing, effectiveLineMultiplier, lineMultiplierFor, presetFor,
  fdxSpacing, importedLineSpacing, isStandardLineSpacing, takesLineSpacing, withLineSpacing, formatLineSpacing,
} = await import('./lineSpacing');
const {
  computeBreaks, computeSceneLengths, computePageBlocks, buildTemplateHints,
  activeTemplateHints, getPageMetrics, pageCountAtLineSpacing, TITLE_REGION_CLASS,
} = await import('../editor/pagination');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { pmDoc, doc, block } = await import('../test/screenplaySchema');
const { useFormattingTemplateStore } = await import('../stores/formattingTemplateStore');
const { INDUSTRY_STANDARD_TEMPLATE } = await import('../stores/industryStandardTemplate');
const { MULTICAM_SITCOM_TEMPLATE } = await import('../stores/templates/multicamSitcomTemplate');
const { generateLineSpacingCss } = await import('./templateCss');
const { parseTemplateSnapshot } = await import('./templateSnapshot');
const { exportPDF } = await import('./pdfExporter');
const { exportDocx } = await import('./docxExporter');
const { exportFDX } = await import('./fdxExporter');
const { lineSpacingFromElementSettings } = await import('./fdxParser');
const { computeSceneTiming, activeTimingOptions } = await import('./scriptTiming');

const LAYOUT = DEFAULT_PAGE_LAYOUT;
const LINES = getPageMetrics(LAYOUT).linesPerPage;
const general = (i: number) => block('general', `G${String(i).padStart(4, '0')} line`);

/** Make `lineSpacing` (and optional per-element multipliers) the active format. */
function useSpacing(lineSpacing?: number, lineHeightMultiplier?: Record<string, number>) {
  useFormattingTemplateStore.setState({
    templates: [{
      ...INDUSTRY_STANDARD_TEMPLATE,
      id: 'spacing-test',
      category: 'user',
      ...(lineSpacing !== undefined ? { lineSpacing } : {}),
      ...(lineHeightMultiplier ? { lineHeightMultiplier } : {}),
    }],
    activeTemplateId: 'spacing-test',
  });
}

beforeEach(() => { draws.length = 0; pdfPages = 1; pdfPage = 1; saved.buf = null; });
afterEach(() => { useFormattingTemplateStore.setState({ templates: [], activeTemplateId: null }); });

describe('the multiplier', () => {
  it('rounds to eighths, keeps to Standard..Double, and treats junk as Standard', () => {
    expect(normalizeLineSpacing(undefined)).toBe(1);
    expect(normalizeLineSpacing('1.5')).toBe(1);
    expect(normalizeLineSpacing(Number.NaN)).toBe(1);
    expect(normalizeLineSpacing(0.5)).toBe(1);
    expect(normalizeLineSpacing(1.15)).toBe(1.125);
    expect(normalizeLineSpacing(1.2)).toBe(1.25);
    expect(normalizeLineSpacing(3)).toBe(2);
  });

  it('multiplies an element\'s own spacing by the script\'s, on the same grid', () => {
    expect(effectiveLineMultiplier(undefined, 1)).toBe(1);
    expect(effectiveLineMultiplier(2, 1)).toBe(2);
    expect(effectiveLineMultiplier(2, 1.25)).toBe(2.5);
    // 1.125 × 1.125 = 1.265625 — not an eighth, so it is drawn at 1.25.
    expect(effectiveLineMultiplier(1.125, 1.125)).toBe(1.25);
    expect(effectiveLineMultiplier(0.5, 1)).toBe(1);
    expect(effectiveLineMultiplier(-1, 1.5)).toBe(1.5);
  });

  it('every value is a whole number of pixels, points/2 and twips', () => {
    for (let k = 8; k <= 32; k++) {
      const m = effectiveLineMultiplier(k / 8, 1);
      expect(Number.isInteger(16 * m)).toBe(true);
      expect(Number.isInteger(24 * m)).toBe(true); // 12pt × m, in half points
      expect(Number.isInteger(240 * m)).toBe(true);
    }
  });

  it('leaves the title page, dual dialogue, AV tables, images and notes alone', () => {
    const tpl = { lineSpacing: 2, lineHeightMultiplier: { titlePage: 2 } };
    for (const type of ['titlePage', 'dualDialogue', 'avBlock', 'screenplayImage', 'section', 'note']) {
      expect(takesLineSpacing(type)).toBe(false);
      expect(lineMultiplierFor(tpl, type)).toBe(1);
    }
    expect(lineMultiplierFor(tpl, 'action')).toBe(2);
    expect(lineMultiplierFor({ lineHeightMultiplier: { sfx: 1.5 } }, 'customElement', 'sfx')).toBe(1.5);
  });

  it('names the presets, and knows a standard template when it sees one', () => {
    expect(presetFor(1)).toBe('standard');
    expect(presetFor(1.125)).toBe('slightlyOpen');
    expect(presetFor(1.25)).toBe('open');
    expect(presetFor(1.5)).toBeNull();
    expect(isStandardLineSpacing(INDUSTRY_STANDARD_TEMPLATE)).toBe(true);
    expect(isStandardLineSpacing({ lineSpacing: 1, lineHeightMultiplier: { dialogue: 1 } })).toBe(true);
    expect(isStandardLineSpacing(MULTICAM_SITCOM_TEMPLATE)).toBe(false);
    expect(isStandardLineSpacing({ lineSpacing: 1.125 })).toBe(false);
  });

  it('reads out as the multiplier and its pitch in points', () => {
    expect(formatLineSpacing(1.25, 'en')).toEqual({ value: '1.25', points: '15' });
    expect(formatLineSpacing(1.125, 'fr')).toEqual({ value: '1,125', points: '13,5' });
    expect(formatLineSpacing(9, 'en')).toEqual({ value: '2', points: '24' });
  });
});

describe('pagination', () => {
  const lines = (n: number) => doc(...Array.from({ length: n }, (_, i) => general(i)));

  it('at Standard is exactly what it was without the setting', () => {
    const json = doc(
      block('sceneHeading', 'INT. ROOM - DAY'),
      ...Array.from({ length: 120 }, (_, i) => (i % 5 === 0 ? block('character', 'MAYA') : block('dialogue', `Line ${i} `.repeat(12)))),
    );
    const base = buildTemplateHints(INDUSTRY_STANDARD_TEMPLATE);
    const withoutKey = { ...base, lineSpacing: undefined };
    const atOne = { ...base, lineSpacing: 1 };
    expect(JSON.stringify(computeBreaks(pmDoc(json), LAYOUT, atOne)))
      .toBe(JSON.stringify(computeBreaks(pmDoc(json), LAYOUT, withoutKey)));
  });

  it('fits a page with as many lines as the spacing allows', () => {
    const json = lines(200);
    const hints = buildTemplateHints(INDUSTRY_STANDARD_TEMPLATE);
    for (const spacing of [1, 1.125, 1.25, 1.5, 2]) {
      const { breaks } = computeBreaks(pmDoc(json), LAYOUT, { ...hints, lineSpacing: spacing });
      // `general` has no space before it, so a page is only its lines.
      expect(breaks[0].nodeIndex, `spacing ${spacing}`).toBe(Math.floor(LINES / spacing));
      expect(breaks[0].linesOnPage).toBeLessThanOrEqual(LINES);
    }
  });

  it('counts the pages Format › Line Spacing shows before applying', () => {
    const json = lines(400);
    const hints = buildTemplateHints(INDUSTRY_STANDARD_TEMPLATE);
    const at = (s: number) => pageCountAtLineSpacing(pmDoc(json), LAYOUT, hints, s);
    expect(at(1)).toBe(Math.ceil(400 / LINES));
    expect(at(2)).toBe(Math.ceil(400 / Math.floor(LINES / 2)));
    expect(at(1.25)).toBeGreaterThan(at(1));
    expect(at(1.25)).toBeLessThan(at(2));
  });

  it('keeps two printed lines of dialogue each side of a turn, however they are spaced', () => {
    // Sitcom dialogue at 2: each printed line is two 12pt lines. Final Draft's
    // rule counts lines of dialogue, so a speech of three one-line paragraphs
    // cannot be split 1 / 2 just because the first one fills two lines.
    const hints = buildTemplateHints(MULTICAM_SITCOM_TEMPLATE);
    const fill = LINES - 6;
    const json = doc(
      ...Array.from({ length: fill }, (_, i) => general(i)),
      block('character', 'MARA'),
      block('dialogue', 'One.'),
      block('dialogue', 'Two.'),
      block('dialogue', 'Three.'),
    );
    const { breaks } = computeBreaks(pmDoc(json), LAYOUT, { ...hints, forceBreakBefore: new Set(), spaceBefore: { ...hints.spaceBefore, character: 0, dialogue: 0 } });
    const turn = breaks.find((b) => b.pageNumber === 2)!;
    // Name + "One." (2) + "Two." (2) is 5 lines in a 6-line gap: but that
    // leaves one line of dialogue behind, so the whole speech moves.
    expect(turn.nodeIndex).toBe(fill);
    expect(turn.isDialogueSplit).toBe(false);
  });

  it('does not open up the title page', () => {
    const json = doc(
      { type: 'titlePage', attrs: { field: 'title' }, content: [{ type: 'text', text: 'THE TITLE' }] },
      { type: 'titlePage', attrs: { field: 'blank' } },
      { type: 'titlePage', attrs: { field: 'author' }, content: [{ type: 'text', text: 'by Someone' }] },
      general(0),
    );
    const hints = buildTemplateHints(INDUSTRY_STANDARD_TEMPLATE);
    const standard = computeBreaks(pmDoc(json), LAYOUT, hints).breaks.find((b) => b.isTitlePage);
    const open = computeBreaks(pmDoc(json), LAYOUT, { ...hints, lineSpacing: 2 }).breaks.find((b) => b.isTitlePage);
    expect(standard).toBeDefined();
    expect(open?.linesOnPage).toBe(standard?.linesOnPage);
  });

  it('measures scene lengths and page thumbnails in the same opened-up lines', () => {
    const json = doc(
      block('sceneHeading', 'INT. ROOM - DAY'),
      ...Array.from({ length: 10 }, (_, i) => general(i)),
    );
    const hints = buildTemplateHints(INDUSTRY_STANDARD_TEMPLATE);
    const [standard] = computeSceneLengths(pmDoc(json), LAYOUT, hints);
    const [open] = computeSceneLengths(pmDoc(json), LAYOUT, { ...hints, lineSpacing: 1.5 });
    expect(standard * LINES).toBe(11);
    expect(open * LINES).toBe(11 * 1.5);

    const [page] = computePageBlocks(pmDoc(json), LAYOUT, { ...hints, lineSpacing: 1.5 });
    expect(page.blocks[1]).toMatchObject({ lineCount: 1.5, lineHeightMultiplier: 1.5 });
    expect(page.blocks[2].lineStart).toBe(page.blocks[1].lineStart + 1.5);
  });

  it('reads the active format through activeTemplateHints', () => {
    useSpacing(1.25);
    expect(lineMultiplierFor(activeTemplateHints(), 'action')).toBe(1.25);
  });
});

describe('screen CSS', () => {
  it('emits nothing for a standard format', () => {
    expect(generateLineSpacingCss(INDUSTRY_STANDARD_TEMPLATE)).toBe('');
  });

  it('draws the sitcom\'s double-spaced dialogue double-spaced, as it is paginated', () => {
    const css = generateLineSpacingCss(MULTICAM_SITCOM_TEMPLATE);
    expect(css).toContain(`.screenplay-content > .screenplay-element.dialogue:not(.${TITLE_REGION_CLASS}) { line-height: 2; }`);
    expect(css).not.toMatch(/\.action[^-]/);
  });

  it('opens every body element, custom ones included, and nothing on its own grid', () => {
    const custom = { ...INDUSTRY_STANDARD_TEMPLATE.rules.action, id: 'beat', label: 'Beat', isBuiltIn: false };
    const css = generateLineSpacingCss({
      ...INDUSTRY_STANDARD_TEMPLATE,
      rules: { ...INDUSTRY_STANDARD_TEMPLATE.rules, beat: custom },
      lineSpacing: 1.25,
    });
    expect(css).toContain('.screenplay-element.scene-heading:not(.sp-title-region) { line-height: 1.25; }');
    expect(css).toContain('.screenplay-element.custom-element[data-custom-type="beat"]');
    // Direct children of the page only: dual-dialogue and AV-cell paragraphs
    // are laid out row by row.
    for (const line of css.split('\n')) expect(line.startsWith('.screenplay-content > ')).toBe(true);
    expect(css).not.toContain('title-page');
    expect(css).not.toMatch(/\.note|\.section/);
  });
});

describe('the format travels with the script', () => {
  it('a snapshot keeps a line spacing and refuses a malformed one', () => {
    const base = { ...INDUSTRY_STANDARD_TEMPLATE, id: 'x', category: 'user' as const };
    expect(parseTemplateSnapshot({ ...base, lineSpacing: 1.25 }, 'x')?.lineSpacing).toBe(1.25);
    expect(parseTemplateSnapshot({ ...base, lineSpacing: 3 }, 'x')?.lineSpacing).toBe(3);
    expect(parseTemplateSnapshot({ ...base, lineSpacing: '1.25' }, 'x')).toBeNull();
    expect(parseTemplateSnapshot({ ...base, lineSpacing: 0 }, 'x')).toBeNull();
    expect(parseTemplateSnapshot({ ...base, lineSpacing: 9 }, 'x')).toBeNull();
  });

  it('a duplicate keeps it', async () => {
    useSpacing(1.5);
    const dup = await useFormattingTemplateStore.getState().duplicateTemplate('spacing-test');
    expect(dup.lineSpacing).toBe(1.5);
  });

  it('Standard is stored as no setting at all', () => {
    const open = withLineSpacing(INDUSTRY_STANDARD_TEMPLATE, 1.25);
    expect(open.lineSpacing).toBe(1.25);
    const back = withLineSpacing(open, 1);
    expect('lineSpacing' in back).toBe(false);
  });
});

describe('PDF', () => {
  const json = doc(
    block('action', 'A01 ' + 'word '.repeat(40)),
    block('action', 'A02 next'),
  );

  it('draws lines 12pt apart at Standard, centred in a taller slot when opened up', async () => {
    await exportPDF(json, 'Spacing', LAYOUT);
    const standard = draws.filter((d) => /word|A0/.test(d.text)).map((d) => d.y);
    draws.length = 0; pdfPages = 1; pdfPage = 1;

    useSpacing(1.25);
    await exportPDF(json, 'Spacing', LAYOUT);
    const open = draws.filter((d) => /word|A0/.test(d.text)).map((d) => d.y);

    expect(standard[1] - standard[0]).toBe(12);
    expect(open[1] - open[0]).toBe(15);
    // First baseline: half the extra 3pt above the line.
    expect(open[0] - standard[0]).toBe(1.5);
    // The second action: 1 blank line (12pt, not opened up) after the first.
    const firstLines = open.length - 1;
    expect(open[firstLines] - open[firstLines - 1]).toBe(15 + 12);
  });

  it('turns the page where the editor does', async () => {
    useSpacing(1.5);
    const long = doc(...Array.from({ length: 120 }, (_, i) => general(i)));
    const { pageCount, breaks } = computeBreaks(pmDoc(long), LAYOUT, activeTemplateHints());
    await exportPDF(long, 'Spacing', LAYOUT);
    expect(pdfPages).toBe(pageCount);
    const firstOnPage2 = draws.find((d) => d.page === 2);
    expect(firstOnPage2?.text).toContain(`G${String(breaks[0].nodeIndex).padStart(4, '0')}`);
  });
});

describe('DOCX', () => {
  async function paragraphsXml(json: JSONContent): Promise<string> {
    const { DEFAULT_PAGE_LAYOUT: layout } = await import('../stores/editorStore');
    await exportDocx(json, 'Spacing', layout);
    if (!saved.buf) throw new Error('exportDocx wrote nothing');
    const zip = await JSZip.loadAsync(saved.buf);
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw new Error('no document.xml');
    return xml;
  }
  const json = doc(
    block('action', 'Action.'),
    {
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [block('character', 'A'), block('dialogue', 'Hi.')] },
        { type: 'dualDialogueColumn', content: [block('character', 'B'), block('dialogue', 'Hey.')] },
      ],
    },
  );

  it('writes an exact line of 12pt at Standard', async () => {
    const xml = await paragraphsXml(json);
    expect(xml).toContain('w:line="240"');
    expect(xml).not.toContain('w:line="300"');
  });

  it('writes the opened-up pitch on body paragraphs, never inside dual dialogue', async () => {
    useSpacing(1.25);
    const xml = await paragraphsXml(json);
    const action = /<w:p>(?:(?!<\/w:p>).)*Action\.(?:(?!<\/w:p>).)*<\/w:p>/s.exec(xml)?.[0] ?? '';
    expect(action).toContain('w:line="300"');
    const table = /<w:tbl>.*<\/w:tbl>/s.exec(xml)?.[0] ?? '';
    expect(table).not.toContain('w:line="300"');
  });
});

describe('FDX', () => {
  const json = doc(block('action', 'Action.'), block('character', 'MARA'), block('dialogue', 'Hi.'));
  const exportNow = () => exportFDX(json, 'Spacing');
  const spacingOf = (xml: string, type: string) =>
    new RegExp(`<ElementSettings Type="${type}">[\\s\\S]*?Spacing="([^"]+)"`).exec(xml)?.[1];

  it('writes Spacing="1" at Standard and the multiplier when opened up', () => {
    expect(spacingOf(exportNow(), 'Action')).toBe('1');
    useSpacing(1.25, { dialogue: 2 });
    const xml = exportNow();
    expect(spacingOf(xml, 'Action')).toBe('1.25');
    expect(spacingOf(xml, 'Dialogue')).toBe('2.5');
  });

  /**
   * What the reader takes from the file. `parseFDXFull` is built on
   * querySelector, which this suite's XML parser lacks, so the element
   * settings are picked out here and handed to the same function it uses.
   */
  const readBack = (xml: string) => lineSpacingFromElementSettings(
    [...xml.matchAll(/<ElementSettings Type="([^"]+)">[\s\S]*?<ParagraphSpec[^>]*Spacing="([^"]*)"/g)]
      .map((m) => ({ type: m[1], spacing: m[2] })),
  );

  it('comes back as the same spacing', () => {
    useSpacing(1.25, { dialogue: 2 });
    expect(readBack(exportNow())).toEqual({ lineSpacing: 1.25, lineHeightMultiplier: { dialogue: 2.5 / 1.25 } });
  });

  it('imports a single-spaced file with no format at all', () => {
    expect(readBack(exportNow())).toBeNull();
    expect(importedLineSpacing({ action: '1', dialogue: '1' })).toBeNull();
    expect(importedLineSpacing({ action: 'bad' })).toBeNull();
  });

  it('writes Final Draft\'s own spelling of a multiplier', () => {
    expect(fdxSpacing(1)).toBe('1');
    expect(fdxSpacing(1.5)).toBe('1.5');
    expect(fdxSpacing(1.125)).toBe('1.125');
    expect(fdxSpacing(Number.NaN)).toBe('1');
  });
});

describe('running time', () => {
  it('is not changed by opening the page up', () => {
    const json = doc(block('sceneHeading', 'INT. ROOM - DAY'), ...Array.from({ length: 30 }, (_, i) => general(i)));
    const standard = computeSceneTiming(json, activeTimingOptions(LAYOUT)).totalSeconds;
    expect(standard).toBeGreaterThan(0);
    useSpacing(2);
    expect(computeSceneTiming(json, activeTimingOptions(LAYOUT)).totalSeconds).toBe(standard);
  });
});

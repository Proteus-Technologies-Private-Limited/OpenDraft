/**
 * The exported PDF turns the page where the editor turns it.
 *
 * Issue #123: a writer's script came out of File ▸ Export as a PDF whose pages
 * held different lines from the ones on screen. The two lay a page out with
 * separate code — `computeBreaks` counts lines for the editor, the exporter
 * advances a cursor down the sheet — so nothing but a test comparing the two
 * keeps them honest.
 *
 * Each case below pins one of the ways they had drifted apart. The last one
 * lays whole generated scripts out both ways and asserts that every element
 * lands on the same page; the wide, seeded version of that sweep lives in
 * test-script/pdf-pagination-parity.test.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

// ── jsPDF, faked: record what was drawn and on which sheet ──────────────
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

vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => true) }));

const { exportPDF } = await import('./pdfExporter');
const { computeBreaks, activeTemplateHints, getPageMetrics } = await import('../editor/pagination');
const { DEFAULT_PAGE_LAYOUT, resolveMoresContds } = await import('../stores/editorStore');
const { pmDoc } = await import('../test/screenplaySchema');
const { getTextLines } = await import('./wrapText');
const { useFormattingTemplateStore } = await import('../stores/formattingTemplateStore');
const { INDUSTRY_STANDARD_TEMPLATE } = await import('../stores/industryStandardTemplate');

type Layout = typeof DEFAULT_PAGE_LAYOUT;
const LINES_PER_PAGE = getPageMetrics(DEFAULT_PAGE_LAYOUT).linesPerPage;

const block = (type: string, text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type, ...(attrs ? { attrs } : {}), content: [{ type: 'text', text }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** `E0007` — the tag that ties a drawn line back to the element it came from. */
const tagged = (type: string, i: number, text: string, attrs?: Record<string, unknown>) =>
  block(type, `E${String(i).padStart(4, '0')} ${text}`, attrs);

beforeEach(() => { draws.length = 0; pageCount = 1; currentPage = 1; });

/** Element index → page number, as the editor draws it. */
function editorPages(json: JSONContent, layout: Layout): number[] {
  const nodes = json.content ?? [];
  const { breaks } = computeBreaks(pmDoc(json), layout, activeTemplateHints());
  const pages: number[] = new Array(nodes.length).fill(1);
  let page = 1;
  let b = 0;
  for (let i = 0; i < nodes.length; i++) {
    while (b < breaks.length && breaks[b].nodeIndex === i) { page = breaks[b].pageNumber; b++; }
    pages[i] = page;
  }
  return pages;
}

/** Element index → page number, as the exported PDF lays it out (-1 if undrawn). */
async function pdfPages(json: JSONContent, layout: Layout, titlePage = false): Promise<number[]> {
  await exportPDF(json, 'Parity', layout);
  const found: number[] = new Array((json.content ?? []).length).fill(-1);
  for (const d of draws) {
    const m = /\bE(\d{4})\b/.exec(d.text);
    if (!m) continue;
    const idx = Number(m[1]);
    // The title page is its own unnumbered sheet in both.
    if (idx < found.length && found[idx] === -1) found[idx] = d.page - (titlePage ? 1 : 0);
  }
  return found;
}

/** Both page assignments, ready to compare element for element. */
async function bothWays(json: JSONContent, layout = DEFAULT_PAGE_LAYOUT, titlePage = false) {
  const editor = editorPages(json, layout);
  const pdf = await pdfPages(json, layout, titlePage);
  const nodes = json.content ?? [];
  const disagree = editor
    .map((p, i) => ({ i, type: nodes[i].type, editor: p, pdf: pdf[i] }))
    .filter((r) => r.pdf !== -1 && r.pdf !== r.editor);
  return { editor, pdf, disagree };
}

/** Which line of its page an element's first line was drawn on (1-based). */
function pdfLineOf(index: number, layout = DEFAULT_PAGE_LAYOUT): number {
  const tag = `E${String(index).padStart(4, '0')}`;
  const d = draws.find((x) => x.text.includes(tag));
  return d ? Math.round((d.y - layout.topMargin) / 12) : -1;
}

describe('a page break lands on the same element in both', () => {
  it('counts a wrapped paragraph the way the PDF wraps it', async () => {
    // Prose whose last word does not land flush with the margin. The editor
    // used to count ceil(characters / column), as if a line could be cut
    // mid-word, so it fitted more on the page than the file did and every
    // page after the first held different lines.
    const line = 'the quick brown fox jumps over the lazy dog and keeps running until dawn';
    // 72 characters in a 36-character column: two lines if a line could be cut
    // mid-word, three once it can only be cut between them.
    expect(getTextLines(line, 36)).toBe(3);
    const json = doc(...Array.from({ length: 40 }, (_, i) => tagged('dialogue', i, line)));
    const { disagree } = await bothWays(json);
    expect(disagree).toEqual([]);
  });

  it('gives the first element of a page no space above it', async () => {
    // Fill a page exactly, then a scene heading, which carries two blank
    // lines. Pushed to the next page it starts at its top: the editor's break
    // decoration replaces the element's margin rather than adding to it. The
    // PDF kept the margin, so its every page after a turn ran two lines low.
    const json = doc(
      ...Array.from({ length: LINES_PER_PAGE }, (_, i) => tagged('general', i, `Line ${i}`)),
      tagged('sceneHeading', LINES_PER_PAGE, 'INT. LAB - DAY'),
      tagged('action', LINES_PER_PAGE + 1, 'She waits.'),
    );
    const { disagree } = await bothWays(json);
    expect(disagree).toEqual([]);
    expect(pdfLineOf(LINES_PER_PAGE)).toBe(1);
  });

  it('keeps a scene heading with the whole speech that follows it', async () => {
    // Two lines short of the foot, with a heading and a speech to place. The
    // heading was kept with the character name alone, which fitted — leaving
    // a page that ended on a name with nothing said, and the editor and the
    // file disagreeing about where the speech began.
    // Five lines left: the heading takes three with its blank lines and the
    // name takes two, which is exactly the trap — they fit, and nothing said
    // does.
    const fill = LINES_PER_PAGE - 5;
    const json = doc(
      ...Array.from({ length: fill }, (_, i) => tagged('general', i, `Line ${i}`)),
      tagged('sceneHeading', fill, 'INT. LAB - NIGHT'),
      tagged('character', fill + 1, 'MAYA'),
      tagged('dialogue', fill + 2, 'We should go.'),
      tagged('dialogue', fill + 3, 'Before it gets dark.'),
    );
    const { editor, disagree } = await bothWays(json);
    expect(disagree).toEqual([]);
    // The heading travels with the speech rather than being left behind.
    expect(editor[fill]).toBe(editor[fill + 1]);
    expect(editor[fill]).toBe(2);
  });

  it('splits a speech only where two lines stay on each side', async () => {
    // Room for the name and two paragraphs, with a one-line paragraph after
    // them. Filling the page as far as it goes leaves that single line to
    // carry over, which Final Draft's rule forbids — so the turn backs off a
    // paragraph. The PDF used to fill greedily and turn in the wrong place.
    const two = 'she waits by the door and listens to the rain';
    const three = 'she waits by the door and listens to the rain on the tin roof again and again';
    expect([getTextLines(two, 36), getTextLines(three, 36)]).toEqual([2, 3]);
    const fill = LINES_PER_PAGE - 7;
    const json = doc(
      ...Array.from({ length: fill }, (_, i) => tagged('general', i, `Line ${i}`)),
      tagged('character', fill, 'DECLAN'),
      tagged('dialogue', fill + 1, two),
      tagged('dialogue', fill + 2, three),
      tagged('dialogue', fill + 3, 'Yes.'),
    );
    const { editor, disagree } = await bothWays(json);
    expect(disagree).toEqual([]);
    // Split after the first paragraph, not the second.
    expect(editor.slice(fill, fill + 4)).toEqual([1, 1, 2, 2]);
  });

  it('turns the page again inside a speech longer than a sheet', async () => {
    // The editor used to lay the whole remainder of a split speech out in one
    // run, so a monologue ran off the bottom of the page on screen while the
    // PDF, which does turn, put the rest somewhere else entirely.
    const long = 'she waits by the door and listens to the rain on the tin roof again';
    const json = doc(
      tagged('action', 0, 'The room empties.'),
      tagged('character', 1, 'RUTH'),
      ...Array.from({ length: 40 }, (_, k) => tagged('dialogue', k + 2, long)),
      tagged('action', 42, 'She stops.'),
    );
    const { disagree } = await bothWays(json);
    expect(disagree).toEqual([]);
  });

  it('never lets a Note or Section carry the page break', async () => {
    // They print nothing, so they can no more open a page than fill one. A
    // Note at the turn used to take the break with it and leave the element
    // after it with its space still above it — a line the file did not have.
    const json = doc(
      ...Array.from({ length: LINES_PER_PAGE }, (_, i) => tagged('general', i, `Line ${i}`)),
      tagged('note', LINES_PER_PAGE, 'remember to cut this'),
      tagged('transition', LINES_PER_PAGE + 1, 'CUT TO:'),
      tagged('action', LINES_PER_PAGE + 2, 'Rain.'),
    );
    const { disagree } = await bothWays(json);
    expect(disagree).toEqual([]);
    expect(pdfLineOf(LINES_PER_PAGE + 1)).toBe(1);
  });

  it('starts the script under a title page with no space above it', async () => {
    const json = doc(
      {
        type: 'titlePage',
        attrs: { field: 'title', tpTitle: 'THE SCRIPT' },
        content: [{ type: 'text', text: 'THE SCRIPT' }],
      },
      tagged('sceneHeading', 1, 'INT. HOUSE - DAY'),
      ...Array.from({ length: 70 }, (_, k) => tagged('action', k + 2, `Beat ${k}.`)),
    );
    const { disagree } = await bothWays(json, DEFAULT_PAGE_LAYOUT, true);
    expect(disagree).toEqual([]);
  });

  it('gives a custom element the spacing its template asks for', async () => {
    // A custom element is `customElement` to the schema and whatever the
    // template calls it everywhere else. The exporter looked its spacing up by
    // node type and so found none, while the editor found the template's —
    // two blank lines per element, which is a page every twenty of them.
    const std = INDUSTRY_STANDARD_TEMPLATE;
    const beat = { ...std.rules.action, id: 'beat', label: 'Beat', marginTop: 24 };
    useFormattingTemplateStore.setState({
      templates: [{ ...std, id: 'test-custom', category: 'user', rules: { ...std.rules, beat } }],
      activeTemplateId: 'test-custom',
    });
    try {
      const json = doc(...Array.from({ length: 30 }, (_, i) => ({
        ...tagged('customElement', i, `Beat ${i}`),
        attrs: { customTypeId: 'beat', customLabel: 'Beat' },
      })));
      const { disagree } = await bothWays(json);
      expect(disagree).toEqual([]);
      // Three lines each — two of space and one of text — so the page turns
      // after nineteen of them, not after fifty-eight.
      expect(pdfLineOf(1)).toBe(4);
    } finally {
      useFormattingTemplateStore.setState({ templates: [], activeTemplateId: null });
    }
  });

  it('agrees with the CONT\'D label turned off', async () => {
    const layout: Layout = {
      ...DEFAULT_PAGE_LAYOUT,
      moresContds: { ...resolveMoresContds(DEFAULT_PAGE_LAYOUT), dialogueBreakContd: false },
    };
    const fill = LINES_PER_PAGE - 6;
    const long = 'she waits by the door and listens to the rain on the tin roof again';
    const json = doc(
      ...Array.from({ length: fill }, (_, i) => tagged('general', i, `Line ${i}`)),
      tagged('character', fill, 'MAYA'),
      ...Array.from({ length: 6 }, (_, k) => tagged('dialogue', fill + 1 + k, long)),
    );
    const { disagree } = await bothWays(json, layout);
    expect(disagree).toEqual([]);
  });
});

describe('whole scripts paginate alike', () => {
  /** Mulberry32 — the same scripts every run, with no fixtures on disk. */
  function rng(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const WORDS = ('she waits by the door and listens to the rain falling on the '
    + 'tin roof while the engine idles somewhere out beyond the fence line').split(' ');
  const sentence = (r: () => number, min: number, max: number) => Array.from(
    { length: min + Math.floor(r() * (max - min + 1)) },
    () => WORDS[Math.floor(r() * WORDS.length)],
  ).join(' ');

  /** Ordinary screenplay shapes, in the proportions a script has them. */
  function script(seed: number, elements: number): JSONContent {
    const r = rng(seed);
    const content: JSONContent[] = [];
    const at = () => content.length;
    const names = ['MAYA', 'DECLAN', 'THE FOREMAN', 'RUTH'];
    while (content.length < elements) {
      const roll = r();
      if (roll < 0.10) content.push(tagged('sceneHeading', at(), 'INT. WAREHOUSE - NIGHT'));
      else if (roll < 0.14) content.push(tagged('sceneHeading', at(), 'EXT. YARD - DAWN', { startsNewPage: true }));
      else if (roll < 0.20) content.push(tagged(r() < 0.5 ? 'note' : 'section', at(), sentence(r, 2, 10)));
      else if (roll < 0.24) content.push(tagged('action', at(), `see https://example.com/${'a'.repeat(40 + Math.floor(r() * 60))}`));
      else if (roll < 0.50) content.push(tagged('action', at(), `${sentence(r, 4, 40)}.`));
      else if (roll < 0.55) content.push(tagged('transition', at(), 'CUT TO:'));
      else if (roll < 0.60) {
        // Two speeches side by side — measured by the deeper column. The
        // children are nested, so they carry no `E` tag: they are not
        // top-level elements, and the block's height is checked by where the
        // elements after it land.
        const speech = (who: string) => [
          block('character', who),
          block('dialogue', `${sentence(r, 3, 20)}.`),
        ];
        const left = speech(names[Math.floor(r() * names.length)]);
        const right = speech(names[Math.floor(r() * names.length)]);
        content.push({
          type: 'dualDialogue',
          content: [
            { type: 'dualDialogueColumn', content: left },
            { type: 'dualDialogueColumn', content: right },
          ],
        });
      }
      else {
        content.push(tagged('character', at(), names[Math.floor(r() * names.length)]));
        if (r() < 0.3) content.push(tagged('parenthetical', at(), `(${sentence(r, 1, 4)})`));
        const paras = r() < 0.1 ? 8 + Math.floor(r() * 8) : 1 + Math.floor(r() * 3);
        for (let p = 0; p < paras && content.length < elements + 16; p++) {
          content.push(tagged('dialogue', at(), `${sentence(r, 3, 30)}.`));
        }
      }
    }
    return doc(...content);
  }

  const LAYOUTS: Record<string, Layout> = {
    A4: DEFAULT_PAGE_LAYOUT,
    'US Letter': { ...DEFAULT_PAGE_LAYOUT, pageWidth: 8.5, pageHeight: 11, rightMargin: 1.0 },
    'tight margins': { ...DEFAULT_PAGE_LAYOUT, topMargin: 54, bottomMargin: 40 },
    'no CONT\'D': {
      ...DEFAULT_PAGE_LAYOUT,
      moresContds: { ...resolveMoresContds(DEFAULT_PAGE_LAYOUT), dialogueBreakContd: false },
    },
  };

  for (const [name, layout] of Object.entries(LAYOUTS)) {
    for (const seed of [1, 2, 3]) {
      it(`${name}, seed ${seed}`, async () => {
        const json = script(seed, 240);
        const { disagree, editor, pdf } = await bothWays(json, layout);
        expect(
          disagree.slice(0, 3),
          `editor ran to ${Math.max(...editor)} pages, the PDF to ${Math.max(...pdf)}`,
        ).toEqual([]);
      });
    }
  }
});

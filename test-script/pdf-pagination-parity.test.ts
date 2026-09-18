/**
 * Issue #123 — "the pdf does not match my impagination".
 *
 * Lays the same script out twice: once through the editor's paginator
 * (`computeBreaks`, which is what draws the page breaks on screen) and once
 * through the real PDF exporter, with jsPDF faked so every draw records the
 * physical page it landed on. Then it asks the only question the reporter
 * cares about: does element N sit on the same page in both?
 *
 * A fixed handful of these scripts is pinned in the app's own suite
 * (frontend/src/utils/pdfPagination.test.ts). This is the wide sweep — run it
 * from `frontend/` when anything in the layout path changes:
 *
 *   npx vitest run --config ../test-script/vitest.config.ts pdf-pagination-parity
 *   SEEDS=3000 npx vitest run --config ../test-script/vitest.config.ts pdf-pagination-parity
 *   DEBUG=1 SEED=391 npx vitest run --config ../test-script/vitest.config.ts \
 *     pdf-pagination-parity --disable-console-intercept
 *
 * `SEEDS` sets how many scripts to generate (default 40), `SEED` runs one, and
 * `DEBUG` prints both accountings around the first element that disagrees.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

// ── Fake jsPDF: record what is drawn and where ──────────────────────────
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

vi.mock('../frontend/src/utils/fileOps', () => ({
  saveFile: vi.fn(async () => true),
}));

const { exportPDF } = await import('../frontend/src/utils/pdfExporter');
const { computeBreaks, activeTemplateHints } = await import('../frontend/src/editor/pagination');
const { DEFAULT_PAGE_LAYOUT, resolveMoresContds } = await import('../frontend/src/stores/editorStore');
const { pmDoc } = await import('../frontend/src/test/screenplaySchema');

// ── A deterministic, realistic-looking script ───────────────────────────

/** Mulberry32 — same script every run, no fixtures on disk. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ('she waits by the door and listens to the rain falling on the '
  + 'tin roof while the engine idles somewhere out beyond the fence line')
  .split(' ');

function sentence(r: () => number, min: number, max: number): string {
  const n = min + Math.floor(r() * (max - min + 1));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(r() * WORDS.length)]);
  return out.join(' ');
}

const block = (type: string, ...parts: (string | JSONContent)[]): JSONContent => ({
  type,
  content: parts.map((p) => (typeof p === 'string' ? { type: 'text', text: p } : p)),
});
const BR: JSONContent = { type: 'hardBreak' };

/**
 * A script of ordinary screenplay elements. Every block is tagged `E<n>` so a
 * drawn line can be traced back to the element it came from.
 *
 * The shapes are the ones that move a page break: speeches short enough to
 * keep and long enough to split, scene headings that land near a page foot,
 * hard breaks, unbroken tokens wider than the column, non-printing blocks, and
 * the writer's own "start on new page" flag.
 */
function buildScript(seed: number, elements: number, titlePage = false): JSONContent {
  const r = rng(seed);
  const content: JSONContent[] = [];
  const tag = () => `E${String(content.length).padStart(4, '0')}`;
  const names = ['MAYA', 'DECLAN', 'THE FOREMAN', 'RUTH'];

  if (titlePage) {
    content.push({
      type: 'titlePage',
      attrs: { field: 'title', tpTitle: 'THE PARITY SCRIPT' },
      content: [{ type: 'text', text: 'THE PARITY SCRIPT' }],
    });
    content.push({
      type: 'titlePage',
      attrs: { field: 'author', tpAuthor: 'A WRITER' },
      content: [{ type: 'text', text: 'A WRITER' }],
    });
  }

  while (content.length < elements) {
    const roll = r();
    if (roll < 0.10) {
      content.push(block('sceneHeading', `${tag()} INT. WAREHOUSE - NIGHT`));
    } else if (roll < 0.14) {
      // Manually flagged to open its own page.
      content.push({
        ...block('sceneHeading', `${tag()} EXT. YARD - DAWN`),
        attrs: { startsNewPage: true },
      });
    } else if (roll < 0.20) {
      // Structure the writer sees but the page never does.
      content.push(block(r() < 0.5 ? 'note' : 'section', `${tag()} ${sentence(r, 2, 10)}`));
    } else if (roll < 0.24) {
      content.push(block('action', `${tag()} see https://example.com/${'a'.repeat(40 + Math.floor(r() * 60))}`));
    } else if (roll < 0.30) {
      content.push(block('action', `${tag()} ${sentence(r, 3, 20)}.`, BR, sentence(r, 3, 20), BR, BR, 'And then.'));
    } else if (roll < 0.50) {
      content.push(block('action', `${tag()} ${sentence(r, 4, 40)}.`));
    } else if (roll < 0.55) {
      content.push(block('transition', `${tag()} CUT TO:`));
    } else if (roll < 0.60) {
      // Two speeches side by side. The children are nested rather than
      // top-level, so they carry no tag: the block's height is checked by
      // where the elements after it land.
      const speech = (who: string) => [
        block('character', who),
        block('dialogue', `${sentence(r, 3, 20)}.`),
      ];
      content.push({
        type: 'dualDialogue',
        content: [
          { type: 'dualDialogueColumn', content: speech(names[Math.floor(r() * names.length)]) },
          { type: 'dualDialogueColumn', content: speech(names[Math.floor(r() * names.length)]) },
        ],
      });
    } else {
      content.push(block('character', `${tag()} ${names[Math.floor(r() * names.length)]}`));
      if (r() < 0.3) content.push(block('parenthetical', `${tag()} (${sentence(r, 1, 4)})`));
      // Occasionally a monologue that no single page can hold.
      const paras = r() < 0.1 ? 8 + Math.floor(r() * 8) : 1 + Math.floor(r() * 3);
      for (let p = 0; p < paras && content.length < elements + 16; p++) {
        content.push(block('dialogue', `${tag()} ${sentence(r, 3, 30)}.`));
      }
    }
  }
  return { type: 'doc', content };
}

// ── Page assignment, both ways ──────────────────────────────────────────

type Layout = typeof DEFAULT_PAGE_LAYOUT;

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

/**
 * Element index → page number, as the exported PDF lays it out.
 *
 * The title page is its own unnumbered sheet in both, so the physical page a
 * draw lands on is one ahead of the script page number once there is one.
 */
async function pdfPages(json: JSONContent, layout: Layout, titlePage: boolean): Promise<number[]> {
  draws.length = 0; pageCount = 1; currentPage = 1;
  await exportPDF(json, 'Parity', layout);
  const nodes = json.content ?? [];
  const found: number[] = new Array(nodes.length).fill(-1);
  const offset = titlePage ? 1 : 0;
  for (const d of draws) {
    const m = /\bE(\d{4})\b/.exec(d.text);
    if (!m) continue;
    const idx = Number(m[1]);
    if (idx < found.length && found[idx] === -1) found[idx] = d.page - offset;
  }
  return found;
}

function firstDivergence(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (b[i] !== -1 && a[i] !== b[i]) return i;
  return -1;
}

beforeEach(() => { draws.length = 0; pageCount = 1; currentPage = 1; });

const SEEDS = process.env.SEED
  ? [Number(process.env.SEED)]
  : Array.from({ length: Number(process.env.SEEDS ?? 40) }, (_, k) => k + 1);

/** Page shapes a writer actually picks, plus one with the CONT'D turned off. */
const LAYOUTS: { name: string; layout: Layout }[] = [
  { name: 'A4', layout: DEFAULT_PAGE_LAYOUT },
  {
    name: 'US Letter',
    layout: { ...DEFAULT_PAGE_LAYOUT, pageWidth: 8.5, pageHeight: 11, rightMargin: 1.0 },
  },
  {
    name: 'tight margins',
    layout: { ...DEFAULT_PAGE_LAYOUT, topMargin: 54, bottomMargin: 40 },
  },
  {
    name: 'no CONT\'D',
    layout: {
      ...DEFAULT_PAGE_LAYOUT,
      moresContds: { ...resolveMoresContds(DEFAULT_PAGE_LAYOUT), dialogueBreakContd: false },
    },
  },
];

describe('PDF pagination matches the editor (issue #123)', () => {
  for (const seed of SEEDS) {
    const { name, layout } = LAYOUTS[seed % LAYOUTS.length];
    const withTitle = seed % 3 === 0;
    it(`agrees page for page — seed ${seed} (${name}${withTitle ? ', title page' : ''})`, async () => {
      const json = buildScript(seed, 400, withTitle);
      const expected = editorPages(json, layout);
      const actual = await pdfPages(json, layout, withTitle);
      const at = firstDivergence(expected, actual);
      const nodes = json.content ?? [];
      if (at >= 0 && process.env.DEBUG) {
        // Where the two accountings parted company, element by element.
        const firstDraw = new Map<number, typeof draws[number]>();
        for (const d of draws) {
          const m = /\bE(\d{4})\b/.exec(d.text);
          if (m && !firstDraw.has(Number(m[1]))) firstDraw.set(Number(m[1]), d);
        }
        const { breaks } = computeBreaks(pmDoc(json), layout, activeTemplateHints());
        console.log('editor breaks:', breaks.filter((b) => Math.abs(b.nodeIndex - at) < 40).map(
          (b) => `@${b.nodeIndex} p${b.pageNumber} lines=${b.linesOnPage}`
            + `${b.isTitlePage ? ' TITLE' : ''}${b.isDialogueSplit ? ' SPLIT' : ''}`,
        ).join(' | '));
        for (let k = Math.max(0, at - 24); k <= at + 2 && k < nodes.length; k++) {
          const d = firstDraw.get(k);
          console.log(
            `${String(k).padStart(4)} ${String(nodes[k].type).padEnd(14)}`
            + ` editor p${expected[k]} | pdf p${d?.page ?? '-'}`
            + ` line ${d ? Math.round((d.y - layout.topMargin) / 12) : '-'}`,
          );
        }
      }
      const detail = at < 0 ? '' : [
        `first divergence at element ${at} (${nodes[at].type})`,
        `  editor page ${expected[at]}, pdf page ${actual[at]}`,
        `  text: ${JSON.stringify(nodes[at].content?.[0]?.text?.slice(0, 60))}`,
        `  context: ${nodes.slice(Math.max(0, at - 4), at + 2)
          .map((n, k) => `${Math.max(0, at - 4) + k}:${n.type}`).join(' ')}`,
        `  editor total pages ${Math.max(...expected)}, pdf total ${Math.max(...actual)}`,
      ].join('\n');
      expect(at, detail).toBe(-1);
    }, 60_000);
  }
});

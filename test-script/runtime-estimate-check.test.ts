/**
 * Does the runtime estimate match how long the film actually runs?
 *
 * Issue #144. Scores the estimate against released films: each script is
 * measured three ways and compared with the film's story time — its
 * theatrical runtime minus the end credits, which no script contains.
 *
 *   old    the pre-#144 estimate (words at 250 a page, cues and white space free)
 *   new    the printed-line estimate in utils/scriptTiming
 *   pages  the published PDF's page count at one minute a page
 *
 * Inputs (any mix, colon-separated in RUNTIME_FILES):
 *   .json      written by test-script/pdf_screenplay_to_json.py from a studio PDF
 *   .fdx .odraft .fountain   imported through the app's own parsers
 * Ground truth comes from test-script/runtime-truth.csv, matched on file name.
 *
 * Run from `frontend/`:
 *   RUNTIME_FILES="$(ls ../test-script/output/runtime-check/*.json | tr '\n' ':')" \
 *     npx vitest run --config ../test-script/vitest.config.ts runtime-estimate-check \
 *     --disable-console-intercept
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { JSONContent } from '@tiptap/react';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';

(globalThis as unknown as { DOMParser: unknown }).DOMParser = XmldomDOMParser;

const { computeBreaks, activeTemplateHints } = await import('../frontend/src/editor/pagination');
const { DEFAULT_PAGE_LAYOUT } = await import('../frontend/src/stores/editorStore');
const { pmDoc } = await import('../frontend/src/test/screenplaySchema');
const { parseFDXFull } = await import('../frontend/src/utils/fdxParser');
const { parseFountain } = await import('../frontend/src/utils/fountainParser');
const { parseOdraft } = await import('../frontend/src/utils/odraftFormat');
const { stripSaveMetadata } = await import('../frontend/src/utils/saveContent');
const { jsonBlockText } = await import('../frontend/src/utils/nodeText');
const { computeSceneTiming, activeTimingOptions } = await import('../frontend/src/utils/scriptTiming');
const { pacingMultiplier } = await import('../frontend/src/utils/scriptProfile');
type Pacing = import('../frontend/src/utils/scriptProfile').Pacing;

type Layout = typeof DEFAULT_PAGE_LAYOUT;
const LETTER: Layout = { ...DEFAULT_PAGE_LAYOUT, pageWidth: 8.5, pageHeight: 11, rightMargin: 1.0 };

const FILES = (process.env.RUNTIME_FILES ?? '').split(':').filter(Boolean);
const HOME = process.env.HOME ?? '~';

interface Truth { runtime: number; credits: number; basis: string; pacing: Pacing }
function loadTruth(): Map<string, Truth> {
  const out = new Map<string, Truth>();
  const file = join(__dirname, 'runtime-truth.csv');
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf-8').split('\n').slice(1)) {
    const [title, runtime, credits, basis, pacing] = line.split(',');
    if (title) out.set(title, { runtime: Number(runtime), credits: Number(credits), basis, pacing: (pacing || 'standard') as Pacing });
  }
  return out;
}

/** Truth rows are keyed on a slug; match a file to the row its name starts with. */
function truthFor(file: string, truth: Map<string, Truth>): [string, Truth | undefined] {
  const slug = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  for (const [k, v] of truth) if (slug.startsWith(k)) return [k, v];
  return [slug, undefined];
}

interface Loaded { doc: JSONContent; layout: Layout; pdfPages?: number }
function load(path: string): Loaded {
  const text = readFileSync(path.replace(/^~/, HOME), 'utf-8');
  const ext = extname(path).toLowerCase();
  if (ext === '.json') {
    const j = JSON.parse(text) as { doc: JSONContent; pdfPages: number; pageSize: [number, number] };
    const [w, h] = j.pageSize;
    const layout = h > 11.3 ? DEFAULT_PAGE_LAYOUT : { ...LETTER, pageWidth: w, pageHeight: h };
    return { doc: j.doc, layout, pdfPages: j.pdfPages };
  }
  if (ext === '.odraft') {
    const { pmDoc: content, metadata } = stripSaveMetadata(parseOdraft(text).content);
    return { doc: content as JSONContent, layout: { ...DEFAULT_PAGE_LAYOUT, ...((metadata._pageLayout as object) ?? {}) } };
  }
  if (ext === '.fountain') return { doc: parseFountain(text) as JSONContent, layout: LETTER };
  const parsed = parseFDXFull(text);
  return { doc: parsed.doc as unknown as JSONContent, layout: { ...DEFAULT_PAGE_LAYOUT, ...(parsed.pageLayout ?? {}) } };
}

/** The estimate as it stood before #144, reproduced to score it. */
function oldEstimateSeconds(doc: JSONContent): number {
  const words = (n: JSONContent) => jsonBlockText(n).trim().split(/\s+/).filter(Boolean).length;
  let total = 0;
  let inScene = false;
  for (const n of doc.content ?? []) {
    const t = n.type ?? '';
    if (t === 'titlePage') continue;
    if (t === 'sceneHeading') { inScene = true; continue; }
    if (!inScene || t === 'character' || t === 'section' || t === 'note') continue;
    if (t === 'transition') { total += 2; continue; }
    const rate = t === 'dialogue' ? 50 : t === 'action' ? 65 : 60;
    total += (words(n) / 250) * rate;
  }
  return total;
}

interface Row {
  name: string; truth: number; basis: string; old: number; next: number; pages: number; pdfPages?: number;
  /** The new estimate with the film's pacing applied (Genre & Pacing). */
  paced: number; pacing: Pacing;
  /** Minutes of dialogue, action and everything else, at one page a minute. */
  split: [number, number, number];
}
const rows: Row[] = [];

const pct = (est: number, truth: number) => ((est - truth) / truth) * 100;
const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`.padStart(5);

describe('runtime estimate against released films', () => {
  if (FILES.length === 0) {
    it.skip('needs RUNTIME_FILES', () => {});
    return;
  }
  const truth = loadTruth();

  for (const file of FILES) {
    it(basename(file), () => {
      const { doc, layout, pdfPages } = load(file);
      const [name, t] = truthFor(file, truth);
      const pages = computeBreaks(pmDoc(doc), layout, activeTemplateHints()).pageCount;
      const timing = computeSceneTiming(doc, activeTimingOptions(layout));
      const next = timing.totalSeconds / 60;
      const split = timing.scenes.reduce<[number, number, number]>((acc, sc) => [
        acc[0] + sc.breakdown.dialogueSeconds / 60,
        acc[1] + sc.breakdown.actionSeconds / 60,
        acc[2] + sc.breakdown.otherSeconds / 60,
      ], [0, 0, 0]);
      const old = oldEstimateSeconds(doc) / 60;
      if (t) rows.push({
        name, truth: t.runtime - t.credits, basis: t.basis, old, next, pages, pdfPages, split,
        paced: next * pacingMultiplier(t.pacing), pacing: t.pacing,
      });
      expect(next).toBeGreaterThan(0);
    });
  }

  it('summary', () => {
    if (rows.length === 0) return;
    const lines = [
      '',
      'film                 story  | PDF pp  OD pp |   old    err |   new    err | PDF pp err | pacing     err',
      '-------------------  -----  | ------  ----- | -----  ----- | -----  ----- | ---------- | --------------',
    ];
    for (const r of rows) {
      const pp = r.pdfPages ?? r.pages;
      lines.push(
        `${r.name.padEnd(19)}  ${r.truth.toFixed(0).padStart(5)}  | ${String(r.pdfPages ?? '-').padStart(6)}  ${String(r.pages).padStart(5)} |`
        + ` ${r.old.toFixed(0).padStart(5)}  ${fmt(pct(r.old, r.truth))} | ${r.next.toFixed(0).padStart(5)}  ${fmt(pct(r.next, r.truth))} |`
        + ` ${fmt(pct(pp, r.truth))} | ${r.pacing.padEnd(8)} ${fmt(pct(r.paced, r.truth))}`
        + `${r.basis === 'estimated' ? '   (credits est.)' : ''}`,
      );
    }
    const stat = (f: (r: Row) => number) => {
      const errs = rows.map((r) => pct(f(r), r.truth));
      const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
      const mae = errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length;
      return `bias ${fmt(bias)}  mean |err| ${mae.toFixed(1)}%`;
    };
    lines.push('', `old estimate    ${stat((r) => r.old)}`);
    lines.push(`new estimate    ${stat((r) => r.next)}`);
    lines.push(`new + pacing    ${stat((r) => r.paced)}`);
    lines.push(`PDF page count  ${stat((r) => r.pdfPages ?? r.pages)}`);

    // Would weighting dialogue and action differently do better than one rate
    // for every line? Fit per-category minutes-per-minute by least squares
    // and score it leave-one-out, so the fit never sees the film it predicts.
    const fit = (train: Row[]): number[] => {
      const X = train.map((r) => r.split);
      const y = train.map((r) => r.truth);
      const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, x) => s + x[i] * x[j], 0)));
      const b = [0, 1, 2].map((i) => X.reduce((s, x, k) => s + x[i] * y[k], 0));
      // 3x3 solve by Cramer's rule.
      const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const d = det(A);
      return [0, 1, 2].map((c) => det(A.map((row, i) => row.map((v, j) => (j === c ? b[i] : v)))) / d);
    };
    const loo = rows.map((r, i) => {
      const w = fit(rows.filter((_, j) => j !== i));
      return pct(w[0] * r.split[0] + w[1] * r.split[1] + w[2] * r.split[2], r.truth);
    });
    const w = fit(rows);
    lines.push(
      `weighted fit    bias ${fmt(loo.reduce((a, b) => a + b, 0) / loo.length)}  mean |err| ${(loo.reduce((a, b) => a + Math.abs(b), 0) / loo.length).toFixed(1)}%`
      + `  (leave-one-out; all-film weights dialogue ${w[0].toFixed(2)} action ${w[1].toFixed(2)} other ${w[2].toFixed(2)})`,
    );
    console.log(lines.join('\n'));
  });
});

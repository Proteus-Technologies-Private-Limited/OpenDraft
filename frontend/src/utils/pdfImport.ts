/**
 * Reading a screenplay back out of a PDF.
 *
 * A PDF has no elements, only text placed on a page. What makes a line a
 * character cue or a parenthetical is where it sits: every screenplay format
 * indents each element by a fixed amount from the action margin, and the
 * writer's eye reads the script by those indents. This does the same.
 *
 * It works in two halves:
 *
 * - `extractPdfPages` asks pdf.js for the text on each page and gathers it
 *   into lines and the separate pieces on each line (a scene heading and the
 *   numbers either side of it are three pieces of one line).
 * - `screenplayFromPdfPages` throws away what is page furniture rather than
 *   script — page numbers, headers, (MORE), CONT'D, revision marks — and
 *   classifies what is left by indent, with the content to break ties: an
 *   uppercase line at the cue indent is only a character when dialogue
 *   follows it.
 *
 * The second half is pure, so it is tested on hand-made pages as well as on
 * PDFs this app writes.
 */
import type { JSONContent } from '@tiptap/react';
import { buildTitlePageBlocks, type TitlePageFields } from './titlePageBlocks';

const PTS_PER_INCH = 72;

/** One run of text on a line, with nothing but ordinary word spacing inside it. */
export interface PdfSegment {
  /** Left edge, in points from the left of the page. */
  x: number;
  /** Right edge, in points from the left of the page. */
  xEnd: number;
  text: string;
}

/** One printed line: everything on the same baseline. */
export interface PdfLine {
  /** Baseline, in points from the top of the page. */
  y: number;
  fontSize: number;
  segments: PdfSegment[];
}

export interface PdfPageText {
  width: number;
  height: number;
  lines: PdfLine[];
}

export interface ParsedPdfScreenplay {
  doc: JSONContent;
  /** The title from the title page, or empty when the PDF has none. */
  title: string;
  warnings: string[];
}

// ── Extraction ──────────────────────────────────────────────────────────────

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/**
 * pdf.js, with its worker set up where there is a page to load one from.
 *
 * The legacy build: OpenDraft still runs in older WKWebViews on macOS, and the
 * modern build assumes newer JavaScript than they have. In Node — the tests —
 * pdf.js runs its worker in-process and needs nothing.
 */
async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof document !== 'undefined' && typeof Worker !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return pdfjs;
}

/**
 * The text of every page, gathered into lines and segments.
 *
 * Throws with a message for the writer when the file is protected by a
 * password or holds no text at all (a scan).
 */
export async function extractPdfPages(data: ArrayBuffer): Promise<PdfPageText[]> {
  const pdfjs = await loadPdfjs();
  // pdf.js takes ownership of the buffer it is given, so it gets a copy: the
  // caller's bytes stay readable.
  const task = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'PasswordException') {
      throw new Error('This PDF is protected by a password. Open it in a PDF viewer, save a copy without the password, and import that.');
    }
    if (name === 'InvalidPDFException') {
      throw new Error('This file is not a PDF that can be read — it may be damaged.');
    }
    throw err;
  }

  try {
    const pages: PdfPageText[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: Array<{ x: number; y: number; width: number; fontSize: number; str: string }> = [];
      for (const raw of content.items as TextItem[]) {
        if (!raw.str || !raw.str.trim() || !raw.transform) continue;
        // Into top-down page coordinates, whatever the page's rotation or crop.
        const t = pdfjs.Util.transform(viewport.transform, raw.transform);
        // Text set at an angle — a diagonal watermark — is not script.
        if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;
        const fontSize = Math.abs(t[3]) || Math.abs(t[0]) || 12;
        items.push({ x: t[4], y: t[5], width: raw.width * viewport.scale, fontSize, str: raw.str });
      }
      pages.push({ width: viewport.width, height: viewport.height, lines: groupIntoLines(items) });
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

/**
 * Gather positioned strings into lines, and each line into segments separated
 * by more than ordinary word spacing.
 */
export function groupIntoLines(
  items: Array<{ x: number; y: number; width: number; fontSize: number; str: string }>,
): PdfLine[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Array<{ y: number; fontSize: number; items: typeof items }> = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(item.y - last.y) <= Math.max(1.5, last.fontSize * 0.3)) {
      last.items.push(item);
    } else {
      lines.push({ y: item.y, fontSize: item.fontSize, items: [item] });
    }
  }

  return lines.map((line) => {
    const charW = line.fontSize * 0.6;
    const segments: PdfSegment[] = [];
    for (const item of [...line.items].sort((a, b) => a.x - b.x)) {
      const seg = segments[segments.length - 1];
      const gap = seg ? item.x - seg.xEnd : Infinity;
      if (seg && gap < charW * 2.5) {
        const needsSpace = gap > charW * 0.4 && !/\s$/.test(seg.text) && !/^\s/.test(item.str);
        seg.text += (needsSpace ? ' ' : '') + item.str;
        seg.xEnd = Math.max(seg.xEnd, item.x + item.width);
      } else {
        segments.push({ x: item.x, xEnd: item.x + item.width, text: item.str });
      }
    }
    for (const seg of segments) seg.text = seg.text.replace(/\s+/g, ' ').trim();
    return { y: line.y, fontSize: line.fontSize, segments: segments.filter((s) => s.text) };
  }).filter((line) => line.segments.length > 0);
}

// ── Classification ──────────────────────────────────────────────────────────

const SCENE_HEADING_RE = /^(?:\d+[A-Z]?\.?\s+)?(INT|EXT|EST|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\s*\/\s*E)[.\s/]/i;
const TRANSITION_RE = /(?:TO:|FADE OUT\.?|FADE TO BLACK\.?|CUT TO BLACK\.?|SMASH CUT\.?)$/;
const SHOT_RE = /^(ANGLE ON|CLOSE ON|CLOSE UP|CLOSEUP|WIDE ON|WIDE SHOT|POV|INSERT|BACK TO SCENE|ON [A-Z])/;
/** A scene number as printed beside a heading: 12, 12A, A12, 12. */
const SCENE_NUMBER_RE = /^[A-Z]?\d{1,4}[A-Z]{0,2}\.?$/;
/** A page number in a header or footer: 12, 12., 12A., Page 12, 12 of 90. */
const PAGE_NUMBER_RE = /^(?:page\s+)?[A-Z]?\d{1,4}[A-Z]?\.?(?:\s*(?:of|\/)\s*\d{1,4})?$/i;
const MORE_RE = /^\(\s*MORE\s*\)$/i;
const CONTINUED_RE = /^\(?\s*CONTINUED\s*\)?\s*:?\s*(?:\(\s*\d+\s*\))?$/i;
const CONTD_SUFFIX_RE = /\s*\((?:CONT['’`]?D|CONT\.?|CONTINUED|CONTD)\)\s*$/i;
/** Revision marks Final Draft and OpenDraft print in the right margin. */
const REVISION_MARK_RE = /^[*#+†‡•^]{1,3}$/;

/** True when a line reads as all capitals — its letters, ignoring the rest. */
function isUppercase(text: string): boolean {
  const letters = text.replace(/\([^)]*\)/g, '').replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** A line once page furniture is gone: one piece of text, or two for dual dialogue. */
interface BodyLine {
  page: number;
  y: number;
  fontSize: number;
  segments: PdfSegment[];
  /** Scene number printed beside the heading this line is, if any. */
  sceneNumber?: string;
}

interface PageCleanup {
  lines: BodyLine[];
  /** The page ended on a (MORE): the speech carries on over the page. */
  endsWithMore: boolean;
}

/**
 * Strip what is printed on the page but is not the script: headers and footers
 * (anything in the top or bottom margin band, and any lone page number),
 * CONTINUED lines, (MORE), and revision marks — taking the scene numbers off
 * the heading they stand beside as it goes.
 */
function cleanPage(page: PdfPageText, index: number): PageCleanup {
  const topBand = 0.85 * PTS_PER_INCH;
  const bottomBand = page.height - 0.6 * PTS_PER_INCH;
  const lines: BodyLine[] = [];
  let endsWithMore = false;

  for (const line of page.lines) {
    let segments = line.segments.map((s) => ({ ...s }));
    const whole = segments.map((s) => s.text).join(' ').trim();

    // (MORE) can sit low enough to be taken for a footer, so it is looked
    // for first.
    if (MORE_RE.test(whole)) {
      endsWithMore = true;
      continue;
    }
    // Running headers and footers sit in the margins.
    if (line.y < topBand || line.y > bottomBand) continue;
    // A page number on its own, wherever the header was placed.
    if (segments.length === 1 && PAGE_NUMBER_RE.test(whole)
      && (line.y < 1.2 * PTS_PER_INCH || line.y > page.height - 1.0 * PTS_PER_INCH)) continue;
    if (CONTINUED_RE.test(whole)) continue;

    // Revision marks in the right margin.
    while (segments.length > 1 && REVISION_MARK_RE.test(segments[segments.length - 1].text)) segments.pop();
    if (segments.length === 1 && REVISION_MARK_RE.test(segments[0].text)) continue;
    const last = segments[segments.length - 1];
    if (last && last.x > page.width * 0.85) {
      const trimmed = last.text.replace(/\s+[*#+†‡]{1,3}$/, '');
      if (trimmed !== last.text) last.text = trimmed;
    }

    // Scene numbers either side of a heading: "12  INT. HOUSE - DAY  12".
    let sceneNumber: string | undefined;
    // A number long enough to run up against the heading reads as one piece
    // with it ("12A EXT. ROOF"): split it off, and move the heading's left
    // edge to where its own text starts so its indent is still the margin.
    const joined = /^([A-Z]?\d{1,4}[A-Z]{0,2})\.?\s+(.+)$/.exec(segments[0]?.text ?? '');
    if (joined && SCENE_HEADING_RE.test(joined[2])) {
      const seg = segments[0];
      const charW = (seg.xEnd - seg.x) / Math.max(1, seg.text.length);
      const offset = seg.text.length - joined[2].length;
      segments[0] = { x: seg.x + offset * charW, xEnd: seg.xEnd, text: joined[2] };
      sceneNumber = joined[1];
      const lastSeg = segments[segments.length - 1];
      if (segments.length >= 2 && lastSeg.text.replace(/\.$/, '') === joined[1]) segments = segments.slice(0, -1);
    } else if (segments.length >= 2 && (SCENE_NUMBER_RE.test(segments[0].text) || /^[A-Z]{1,2}\.?$/.test(segments[0].text))) {
      const rest = segments.slice(1).map((s) => s.text).join(' ');
      const lastSeg = segments[segments.length - 1];
      // A letter alone (a multi-cam scene "A") only counts when it is repeated
      // on the right, as scene numbers are.
      const matchedRight = segments.length >= 3 && lastSeg.text === segments[0].text;
      if (matchedRight || (SCENE_NUMBER_RE.test(segments[0].text) && SCENE_HEADING_RE.test(rest))) {
        sceneNumber = segments[0].text.replace(/\.$/, '');
        segments = segments.slice(1, matchedRight ? -1 : undefined);
      }
    } else if (segments.length >= 2 && /^[A-Z]{1,2}\s+\S/.test(segments[0].text)
      && segments[segments.length - 1].text === segments[0].text.split(' ')[0]) {
      // A letter scene number run up against its heading: "A INT. KITCHEN".
      const seg = segments[0];
      const token = seg.text.split(' ')[0];
      const charW = (seg.xEnd - seg.x) / Math.max(1, seg.text.length);
      segments[0] = { x: seg.x + (token.length + 1) * charW, xEnd: seg.xEnd, text: seg.text.slice(token.length + 1) };
      segments = segments.slice(0, -1);
      sceneNumber = token;
    } else if (segments.length >= 2 && SCENE_NUMBER_RE.test(segments[segments.length - 1].text)
      && SCENE_HEADING_RE.test(segments[0].text)) {
      // Numbered on the right only.
      sceneNumber = segments[segments.length - 1].text.replace(/\.$/, '');
      segments = segments.slice(0, -1);
    }

    // Anything after (MORE) means it was not the end of the page after all.
    endsWithMore = false;
    lines.push({ page: index, y: line.y, fontSize: line.fontSize, segments, sceneNumber });
  }
  return { lines, endsWithMore };
}

/** The x a line starts at: its first segment's left edge. */
const startOf = (line: BodyLine) => line.segments[0].x;
const endOf = (line: BodyLine) => line.segments[line.segments.length - 1].xEnd;
const textOf = (line: BodyLine) => line.segments.map((s) => s.text).join(' ');

/**
 * The action margin: the leftmost indent that is used repeatedly. A stray
 * line further out (a note, a misplaced number) does not move it.
 */
function actionMargin(lines: BodyLine[]): number {
  // Scene headings always sit on the action margin, so where there are any
  // they settle it — even in a scene that is nearly all dialogue.
  const headings = lines.filter((l) => l.sceneNumber !== undefined || SCENE_HEADING_RE.test(textOf(l))).map(startOf);
  if (headings.length > 0) {
    headings.sort((a, b) => a - b);
    return headings[Math.floor(headings.length / 2)];
  }
  const counts = new Map<number, number>();
  for (const line of lines) {
    const key = Math.round(startOf(line) / 3.6); // 0.05in buckets
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const recurring = [...counts.entries()].filter(([, n]) => n >= 3).map(([k]) => k);
  if (counts.size === 0) return 1.5 * PTS_PER_INCH;
  // Too little text to tell (a page or two of dialogue): no further right
  // than the standard 1.5in, so a lone cue is not taken for the margin.
  if (recurring.length === 0) return Math.min(1.5 * PTS_PER_INCH, ...lines.map(startOf));
  const keys = recurring;
  const bucket = Math.min(...keys);
  // The smallest real x in that bucket, rather than the bucket's edge.
  const inBucket = lines.map(startOf).filter((x) => Math.round(x / 3.6) === bucket);
  return Math.min(...inBucket);
}

type Kind = 'action' | 'dialogue' | 'paren' | 'cue' | 'right' | 'center';

interface Geometry {
  left: number;
  right: number;
  pageWidth: number;
}

/** Where a line sits, read as the element its indent belongs to. */
function kindOf(line: BodyLine, g: Geometry): Kind {
  const x = startOf(line);
  const dx = (x - g.left) / PTS_PER_INCH;
  const text = textOf(line);
  const upper = isUppercase(text);

  // Right-aligned and in capitals: a transition, wherever it starts.
  if (upper && dx >= 2.5 && Math.abs(endOf(line) - g.right) < 0.35 * PTS_PER_INCH && /[:.]$/.test(text)) {
    return 'right';
  }
  if (dx < 0.5) return 'action';
  if (dx < 1.25) return 'dialogue';
  if (dx < 1.8) return text.startsWith('(') ? 'paren' : 'dialogue';
  if (dx < 2.9) {
    if (upper) return 'cue';
    return text.startsWith('(') ? 'paren' : 'dialogue';
  }
  return upper ? 'right' : 'center';
}

interface Element {
  type: string;
  lines: string[];
  attrs?: Record<string, unknown>;
}

const elementText = (el: Element) => el.lines.join(' ').replace(/\s+/g, ' ').trim();

function toNode(el: Element): JSONContent {
  const text = elementText(el);
  const node: JSONContent = { type: el.type };
  if (el.attrs && Object.keys(el.attrs).length > 0) node.attrs = el.attrs;
  if (text) node.content = [{ type: 'text', text }];
  return node;
}

/** The type of an action-margin paragraph, read from what it says. */
function actionTypeOf(text: string): string {
  if (SCENE_HEADING_RE.test(text)) return 'sceneHeading';
  if (isUppercase(text) && TRANSITION_RE.test(text)) return 'transition';
  if (isUppercase(text) && text.length < 60 && SHOT_RE.test(text)) return 'shot';
  return 'action';
}

/** A character cue without the CONT'D that the app adds back by itself. */
function cleanCue(text: string): string {
  return text.replace(CONTD_SUFFIX_RE, '').trim();
}

const sameCue = (a: string, b: string) => cleanCue(a).toUpperCase() === cleanCue(b).toUpperCase();

/**
 * A run of side-by-side speeches — two cues on one line — as a dualDialogue
 * node. The run lasts until the first blank line, which is where the two
 * columns end.
 */
function dualDialogueFrom(lines: BodyLine[]): JSONContent {
  // Halfway between the two cues: each column's dialogue starts left of its
  // cue, but never as far left as the other column's.
  const first = lines[0];
  const splitX = (first.segments[0].x + first.segments[1].x) / 2;
  const columns: Element[][] = [[], []];
  for (const line of lines) {
    for (const seg of line.segments) {
      const col = seg.x >= splitX ? 1 : 0;
      const els = columns[col];
      const current = els[els.length - 1];
      const text = seg.text;
      if (els.length === 0) {
        els.push({ type: 'character', lines: [cleanCue(text)] });
      } else if (text.startsWith('(')) {
        els.push({ type: 'parenthetical', lines: [text] });
      } else if (current.type === 'parenthetical' && !/\)\s*$/.test(elementText(current))) {
        current.lines.push(text);
      } else if (current.type === 'dialogue') {
        current.lines.push(text);
      } else {
        els.push({ type: 'dialogue', lines: [text] });
      }
    }
  }
  return {
    type: 'dualDialogue',
    content: columns.map((els) => ({
      type: 'dualDialogueColumn',
      content: (els.length > 0 ? els : [{ type: 'character', lines: [''] }]).map(toNode),
    })),
  };
}

/**
 * Read a title page off the first page, when it is one: no scene heading and
 * no speech on it, and something in the centre of the page to call the title.
 */
function titlePageFrom(page: PdfPageText): { fields: TitlePageFields; title: string } | null {
  const lines: BodyLine[] = page.lines
    .filter((l) => !(l.segments.length === 1 && PAGE_NUMBER_RE.test(l.segments[0].text)))
    .map((l) => ({ page: 0, y: l.y, fontSize: l.fontSize, segments: l.segments }));
  if (lines.length === 0 || lines.length > 40) return null;
  if (lines.some((l) => SCENE_HEADING_RE.test(textOf(l)))) return null;

  const center = page.width / 2;
  const isCentered = (l: BodyLine) => Math.abs((startOf(l) + endOf(l)) / 2 - center) < 0.6 * PTS_PER_INCH;
  const lowerStart = page.height * 0.6;
  const upper = lines.filter((l) => l.y < lowerStart && isCentered(l));
  if (upper.length === 0) return null;

  const fields: TitlePageFields = {};
  const titleLines: string[] = [];
  const authorLines: string[] = [];
  const basedOn: string[] = [];
  let stage: 'title' | 'author' | 'based' = 'title';
  let prevY = -Infinity;
  for (const l of upper) {
    const text = textOf(l);
    const gap = l.y - prevY;
    prevY = l.y;
    if (/^(?:(?:an?\s+)?(?:original\s+)?(?:screenplay|teleplay|story|script|written)\s+)?by:?$/i.test(text)) {
      fields.tpCredit = text;
      stage = 'author';
      continue;
    }
    if (/^based (?:on|upon)\b/i.test(text)) {
      stage = 'based';
      basedOn.push(text);
      continue;
    }
    if (stage === 'title') {
      // The title is the first block; a blank line after it ends it.
      if (titleLines.length > 0 && gap > l.fontSize * 2.5) {
        stage = 'author';
        authorLines.push(text);
      } else {
        titleLines.push(text);
      }
    } else if (stage === 'author') {
      authorLines.push(text);
    } else {
      basedOn.push(text);
    }
  }
  if (titleLines.length === 0) return null;
  fields.tpTitle = titleLines.join('\n');
  if (authorLines.length > 0) fields.tpWrittenBy = authorLines.join('\n');
  if (basedOn.length > 0) fields.tpBasedOn = basedOn.join('\n');

  const contact: string[] = [];
  const draft: string[] = [];
  const copyright: string[] = [];
  for (const l of lines.filter((x) => x.y >= lowerStart || (x.y < lowerStart && !isCentered(x)))) {
    const text = textOf(l);
    if (/©|\(c\)|copyright|\bWGA\b|registered/i.test(text)) copyright.push(text);
    else if (/\bdraft\b|\brevis/i.test(text) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(text)) draft.push(text);
    else contact.push(text);
  }
  if (contact.length > 0) fields.tpContact = contact.join('\n');
  if (draft.length > 0) fields.tpDraft = draft.join(' ');
  if (copyright.length > 0) fields.tpCopyright = copyright.join('\n');

  return { fields, title: titleLines.join(' ') };
}

/** True when a page holds a speech: an uppercase line with dialogue under it. */
function hasSpeech(page: PdfPageText): boolean {
  return page.lines.some((l, i) => {
    const next = page.lines[i + 1];
    return !!next && isUppercase(l.segments.map((s) => s.text).join(' '))
      && l.segments[0].x - 0.5 * PTS_PER_INCH > next.segments[0].x
      && next.y - l.y <= l.fontSize * 1.5;
  });
}

/** Turn the text of a screenplay's pages back into a document. */
export function screenplayFromPdfPages(pages: PdfPageText[]): ParsedPdfScreenplay {
  const warnings: string[] = [];
  const total = pages.reduce((n, p) => n + p.lines.length, 0);
  if (total === 0) {
    throw new Error('This PDF has no text to read — it may be a scan. Only PDFs with selectable text can be imported.');
  }

  const content: JSONContent[] = [];
  let title = '';
  let firstBodyPage = 0;
  if (pages.length > 1 && !hasSpeech(pages[0])) {
    const tp = titlePageFrom(pages[0]);
    if (tp) {
      content.push(...(buildTitlePageBlocks(tp.fields) as JSONContent[]));
      title = tp.title;
      firstBodyPage = 1;
    }
  }

  const cleaned = pages.slice(firstBodyPage).map((p, i) => cleanPage(p, i + firstBodyPage));
  const all = cleaned.flatMap((c) => c.lines);
  if (all.length === 0) return { doc: { type: 'doc', content }, title, warnings };

  const left = actionMargin(all);
  const singles = all.filter((l) => l.segments.length === 1);
  const right = Math.max(...(singles.length > 0 ? singles : all).map(endOf));
  const g: Geometry = { left, right, pageWidth: pages[0].width };

  // How far each kind of line reaches when it is full, so a line that stops
  // well short of that is known to have ended its paragraph.
  const reach = new Map<Kind, number>();
  for (const line of all) {
    if (line.segments.length !== 1) continue;
    const k = kindOf(line, g);
    reach.set(k, Math.max(reach.get(k) ?? 0, endOf(line)));
  }
  /**
   * Whether `prev` ended its paragraph rather than wrapping: the next line's
   * first word would have fitted on it. That is the only sign of a new
   * paragraph where a format puts no blank line between them — consecutive
   * dialogue paragraphs, for one.
   */
  const endedParagraph = (prev: BodyLine, line: BodyLine, kind: Kind): boolean => {
    const limit = reach.get(kind);
    if (!limit) return false;
    const seg = prev.segments[prev.segments.length - 1];
    const charW = (seg.xEnd - seg.x) / Math.max(1, seg.text.length);
    const nextWord = textOf(line).split(' ')[0] ?? '';
    return prev.segments.length === 1 && seg.xEnd + charW * (nextWord.length + 1) <= limit - charW * 0.5;
  };

  const elements: Array<Element | JSONContent> = [];
  let current: Element | null = null;
  /** The cue of the speech under way, for a CONT'D at the top of the next page. */
  let lastCue = '';
  let carryOver = false;

  const flush = () => {
    if (current) elements.push(current);
    current = null;
  };
  const start = (el: Element) => {
    flush();
    current = el;
  };

  for (let p = 0; p < cleaned.length; p++) {
    const { lines } = cleaned[p];
    // A speech carried over the page stays open; anything else ends with it.
    // The carry-over is announced by a (MORE) at the foot of the page, or —
    // when there was no room for one — by the cue repeated with a CONT'D.
    const top = lines[0];
    const openSpeech = (current as Element | null)?.type === 'dialogue'
      || (current as Element | null)?.type === 'parenthetical';
    const continuing = carryOver || (openSpeech && !!top && !!lastCue
      && CONTD_SUFFIX_RE.test(textOf(top)) && sameCue(textOf(top), lastCue));
    carryOver = false;
    if (!continuing) flush();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : null;
      const next = i + 1 < lines.length ? lines[i + 1] : null;
      const gapBefore = prev ? line.y - prev.y > line.fontSize * 1.5 : true;
      const tightAfter = !!next && next.y - line.y <= line.fontSize * 1.5;
      const text = textOf(line);

      // Two speeches side by side: the run of lines until the next blank one.
      if (line.segments.length >= 2 && isUppercase(line.segments[0].text) && isUppercase(line.segments[1].text)
        && line.segments[1].x - line.segments[0].xEnd > 0.5 * PTS_PER_INCH
        && startOf(line) - left > 0.5 * PTS_PER_INCH) {
        const run = [line];
        while (i + 1 < lines.length && lines[i + 1].y - lines[i].y <= lines[i].fontSize * 1.5) {
          run.push(lines[++i]);
        }
        flush();
        elements.push(dualDialogueFrom(run));
        lastCue = '';
        continue;
      }

      let kind = kindOf(line, g);
      // An uppercase line at the cue indent is a cue only when it is spoken
      // under; on its own it is centred text — THE END, a title card.
      if (kind === 'cue' && !(tightAfter && next && ['dialogue', 'paren'].includes(kindOf(next, g)))) {
        kind = 'center';
      }

      // The top of a page that carries on a speech: the repeated cue goes,
      // and the speech picks up where it left off.
      if (continuing && i === 0 && kind === 'cue' && lastCue && sameCue(text, lastCue)) continue;
      const resumes = continuing && (i === 0 || (i === 1 && kindOf(lines[0], g) === 'cue'));

      const cur = current as Element | null;
      switch (kind) {
        case 'action': {
          const continues = cur && !gapBefore && i > 0 && prev
            && (cur.type === 'action' || cur.type === 'general')
            && !endedParagraph(prev, line, 'action');
          if (continues) {
            cur.lines.push(text);
          } else {
            // A numbered line is a heading whatever it says — OMITTED among them.
            const type = line.sceneNumber ? 'sceneHeading' : actionTypeOf(text);
            const attrs: Record<string, unknown> = {};
            if (type === 'sceneHeading' && line.sceneNumber) attrs.sceneNumber = line.sceneNumber;
            start({ type, lines: [text], attrs });
            if (type === 'sceneHeading') lastCue = '';
          }
          break;
        }
        case 'cue':
          lastCue = text;
          start({ type: 'character', lines: [cleanCue(text)] });
          break;
        case 'paren':
          start({ type: 'parenthetical', lines: [text] });
          break;
        case 'dialogue': {
          if (cur?.type === 'parenthetical' && !gapBefore && !/\)\s*$/.test(elementText(cur))) {
            cur.lines.push(text);
          } else if (cur?.type === 'dialogue' && (
            (!gapBefore && !resumes && !(prev && kindOf(prev, g) === 'dialogue' && endedParagraph(prev, line, 'dialogue')))
            || (resumes && !/[.!?…"'”’)\]-]$/.test(elementText(cur))))) {
            // Wrapped lines of one speech — or, across a page, a sentence that
            // a (MORE) broke in the middle.
            cur.lines.push(text);
          } else {
            start({ type: 'dialogue', lines: [text] });
          }
          break;
        }
        case 'right':
          start({ type: 'transition', lines: [text] });
          break;
        case 'center':
          start({ type: 'action', lines: [text], attrs: { textAlign: 'center' } });
          break;
      }
    }
    carryOver = cleaned[p].endsWithMore && lastCue !== '';
  }
  flush();

  for (const el of elements) {
    content.push('lines' in el ? toNode(el as Element) : el);
  }
  if (!content.some((n) => n.type === 'sceneHeading' || n.type === 'character')) {
    warnings.push('No scene headings or dialogue were recognised — the PDF may not be laid out as a screenplay.');
  }
  return { doc: { type: 'doc', content }, title, warnings };
}

/** Import a screenplay PDF: read its text, then rebuild its elements. */
export async function parsePdfScreenplay(data: ArrayBuffer): Promise<ParsedPdfScreenplay> {
  return screenplayFromPdfPages(await extractPdfPages(data));
}

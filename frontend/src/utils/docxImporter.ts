// Microsoft Word (.docx) importer.
//
// A .docx is a zip with `word/document.xml` and `word/styles.xml`.  We unzip
// with jszip, parse XML with the browser's DOMParser, and walk paragraphs to
// build the same Tiptap JSONContent shape used by fdxParser / fountainParser.
//
// Classification is layered (first hit wins):
//   1. Paragraph style name (Final Draft / Fade In / Trelby / Highland)
//   2. Paragraph indent (FD layout, ±0.25" tolerance)
//   3. Text/format pattern (INT./EXT., TO:, all-caps cue, parens, ...)
//   4. Sequencing context (paragraph after a confirmed character is dialogue)
//   5. Fallback to 'action' + record a warning
//
// Returned alongside the document is a list of warnings and a count of
// paragraphs that fell back to 'action' so the caller can show a summary.

import JSZip from 'jszip';

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

export interface DocxParseResult {
  doc: TipTapNode;
  scriptTitle: string;
  warnings: string[];
  ambiguousCount: number;
}

// --- Constants ---

const TWIPS_PER_INCH = 1440;
const INDENT_TOLERANCE_IN = 0.25;

// FD reference indents (mirrors pdfExporter / docxExporter)
const FD_LEFT_INDENTS: Record<string, number> = {
  sceneHeading: 1.50,
  action: 1.50,
  character: 3.50,
  dialogue: 2.50,
  parenthetical: 3.00,
  transition: 5.50, // also right-aligned
  lyrics: 2.50,
};

// Style-name aliases (case-insensitive). Covers FD / Fade In / Trelby / Highland.
const STYLE_NAME_MAP: Array<[RegExp, string]> = [
  [/^scene\s*heading$|^slug(line)?$|^heading\s*1$/i, 'sceneHeading'],
  [/^action$|^description$|^scene\s*action$/i, 'action'],
  [/^character$|^character\s*name$|^cue$/i, 'character'],
  [/^dialog(ue)?$|^speech$/i, 'dialogue'],
  [/^parenthetical$|^paren(s)?$|^wryly$/i, 'parenthetical'],
  [/^transition$/i, 'transition'],
  [/^shot$/i, 'shot'],
  [/^lyric(s)?$|^singing$/i, 'lyrics'],
  [/^new\s*act$/i, 'newAct'],
  [/^end\s*of\s*act$/i, 'endOfAct'],
  [/^show\/?episode$|^show\s*heading$/i, 'showEpisode'],
  [/^cast\s*list$/i, 'castList'],
  [/^general$/i, 'general'],
];

// Text-pattern regexes (mirror fountainParser)
const RE_SCENE_HEADING = /^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/i;
const RE_TRANSITION_END = /TO:\s*$/;
const RE_TRANSITION_START = /^(FADE\s+IN|FADE\s+OUT|FADE\s+TO|CUT\s+TO|DISSOLVE\s+TO|MATCH\s+CUT|SMASH\s+CUT|JUMP\s+CUT|TIME\s+CUT)\b/i;
const RE_PAREN_ONLY = /^\(.*\)$/;

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// --- Style resolution ---

interface StyleProps {
  name: string;
  indentLeftIn?: number;
  indentRightIn?: number;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  bold?: boolean;
  italic?: boolean;
  caps?: boolean;
  basedOn?: string;
}

type StyleMap = Map<string, StyleProps>;

function getAttrNS(el: Element, attr: string): string | null {
  return el.getAttributeNS(W_NS, attr) ?? el.getAttribute(`w:${attr}`) ?? el.getAttribute(attr);
}

function firstChildNS(parent: Element | null, tag: string): Element | null {
  if (!parent) return null;
  const ns = parent.getElementsByTagNameNS(W_NS, tag);
  if (ns.length > 0) return ns[0];
  const fallback = parent.getElementsByTagName(`w:${tag}`);
  return fallback.length > 0 ? fallback[0] : null;
}

function childrenNS(parent: Element | null, tag: string): Element[] {
  if (!parent) return [];
  const ns = parent.getElementsByTagNameNS(W_NS, tag);
  if (ns.length > 0) return Array.from(ns);
  return Array.from(parent.getElementsByTagName(`w:${tag}`));
}

function parsePrIndent(pPr: Element | null): { left?: number; right?: number } {
  if (!pPr) return {};
  const ind = firstChildNS(pPr, 'ind');
  if (!ind) return {};
  // w:ind has @w:left, @w:right (or @w:start, @w:end)
  const left = getAttrNS(ind, 'left') ?? getAttrNS(ind, 'start');
  const right = getAttrNS(ind, 'right') ?? getAttrNS(ind, 'end');
  const out: { left?: number; right?: number } = {};
  if (left != null && left !== '') {
    const n = Number(left);
    if (!isNaN(n)) out.left = n / TWIPS_PER_INCH;
  }
  if (right != null && right !== '') {
    const n = Number(right);
    if (!isNaN(n)) out.right = n / TWIPS_PER_INCH;
  }
  return out;
}

function parsePrAlignment(pPr: Element | null): StyleProps['alignment'] | undefined {
  if (!pPr) return undefined;
  const jc = firstChildNS(pPr, 'jc');
  if (!jc) return undefined;
  const val = (getAttrNS(jc, 'val') || '').toLowerCase();
  if (val === 'center') return 'center';
  if (val === 'right' || val === 'end') return 'right';
  if (val === 'both' || val === 'justify') return 'justify';
  return 'left';
}

function parseRPrFlags(rPr: Element | null): { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; caps?: boolean } {
  if (!rPr) return {};
  const out: { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; caps?: boolean } = {};
  const isOnFlag = (tag: string): boolean => {
    const el = firstChildNS(rPr, tag);
    if (!el) return false;
    const v = getAttrNS(el, 'val');
    // Default toggle is "on" when present without val, or with val="1"/"true"
    if (v == null) return true;
    return v !== '0' && v.toLowerCase() !== 'false';
  };
  if (isOnFlag('b')) out.bold = true;
  if (isOnFlag('i')) out.italic = true;
  if (firstChildNS(rPr, 'u')) {
    const u = firstChildNS(rPr, 'u')!;
    const v = (getAttrNS(u, 'val') || '').toLowerCase();
    if (v && v !== 'none') out.underline = true;
  }
  if (isOnFlag('strike')) out.strike = true;
  if (isOnFlag('caps')) out.caps = true;
  return out;
}

function buildStyleMap(stylesXml: Document | null): StyleMap {
  const map: StyleMap = new Map();
  if (!stylesXml) return map;
  const styles = childrenNS(stylesXml.documentElement, 'style');
  for (const s of styles) {
    const styleId = getAttrNS(s, 'styleId') || '';
    const nameEl = firstChildNS(s, 'name');
    const name = nameEl ? getAttrNS(nameEl, 'val') || '' : '';
    const basedOnEl = firstChildNS(s, 'basedOn');
    const basedOn = basedOnEl ? getAttrNS(basedOnEl, 'val') || undefined : undefined;
    const pPr = firstChildNS(s, 'pPr');
    const rPr = firstChildNS(s, 'rPr');
    const ind = parsePrIndent(pPr);
    const alignment = parsePrAlignment(pPr);
    const flags = parseRPrFlags(rPr);
    map.set(styleId, {
      name,
      indentLeftIn: ind.left,
      indentRightIn: ind.right,
      alignment,
      bold: flags.bold,
      italic: flags.italic,
      caps: flags.caps,
      basedOn,
    });
  }
  return map;
}

function resolveStyle(styleId: string | undefined, map: StyleMap): StyleProps {
  // Walk basedOn chain, deeper styles take precedence on the way back up.
  const chain: StyleProps[] = [];
  let id = styleId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const s = map.get(id);
    if (!s) break;
    chain.unshift(s); // ancestors first
    id = s.basedOn;
  }
  const merged: StyleProps = { name: '' };
  for (const s of chain) {
    if (s.name) merged.name = s.name;
    if (s.indentLeftIn != null) merged.indentLeftIn = s.indentLeftIn;
    if (s.indentRightIn != null) merged.indentRightIn = s.indentRightIn;
    if (s.alignment) merged.alignment = s.alignment;
    if (s.bold != null) merged.bold = s.bold;
    if (s.italic != null) merged.italic = s.italic;
    if (s.caps != null) merged.caps = s.caps;
  }
  return merged;
}

// --- Paragraph extraction ---

interface RunInfo {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

interface ParaInfo {
  styleName: string;
  indentLeftIn?: number;
  indentRightIn?: number;
  alignment: 'left' | 'center' | 'right' | 'justify';
  paragraphBold: boolean;
  paragraphItalic: boolean;
  paragraphCaps: boolean;
  pageBreakBefore: boolean;
  plainText: string;
  runs: RunInfo[];
  /** Sentinel set when this paragraph came from a 2-column dialogue row. */
  dualColumn?: 'left' | 'right';
}

function readRun(r: Element, paraStyle: StyleProps): RunInfo {
  const rPr = firstChildNS(r, 'rPr');
  const flags = parseRPrFlags(rPr);
  // Concatenate <w:t>, <w:tab>, <w:br> text content
  let text = '';
  for (const child of Array.from(r.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const local = el.localName;
    if (local === 't') {
      text += el.textContent || '';
    } else if (local === 'tab') {
      text += '\t';
    } else if (local === 'br') {
      text += '\n';
    }
  }
  // Apply caps via paragraph or run setting
  const caps = flags.caps || paraStyle.caps;
  if (caps && text) text = text.toUpperCase();
  return {
    text,
    bold: !!(flags.bold ?? paraStyle.bold),
    italic: !!(flags.italic ?? paraStyle.italic),
    underline: !!flags.underline,
    strike: !!flags.strike,
  };
}

function readParagraph(p: Element, styleMap: StyleMap): ParaInfo {
  const pPr = firstChildNS(p, 'pPr');
  const styleEl = firstChildNS(pPr, 'pStyle');
  const styleId = styleEl ? getAttrNS(styleEl, 'val') || undefined : undefined;
  const inherited = resolveStyle(styleId, styleMap);

  // Direct paragraph properties override style
  const directInd = parsePrIndent(pPr);
  const directAlign = parsePrAlignment(pPr);
  const directRPrFlags = parseRPrFlags(firstChildNS(pPr, 'rPr'));

  const indentLeftIn = directInd.left ?? inherited.indentLeftIn;
  const indentRightIn = directInd.right ?? inherited.indentRightIn;
  const alignment = directAlign ?? inherited.alignment ?? 'left';
  const paragraphBold = !!(directRPrFlags.bold ?? inherited.bold);
  const paragraphItalic = !!(directRPrFlags.italic ?? inherited.italic);
  const paragraphCaps = !!(directRPrFlags.caps ?? inherited.caps);

  // Page break before?
  const pageBreakBefore = !!firstChildNS(pPr, 'pageBreakBefore');

  const runs: RunInfo[] = [];
  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.localName === 'r') {
      runs.push(readRun(el, { ...inherited, bold: paragraphBold, italic: paragraphItalic, caps: paragraphCaps, name: inherited.name }));
    }
  }

  // Detect <w:br w:type="page"/> inside any run as a page break
  let runHasPageBreak = false;
  const allBreaks = childrenNS(p, 'br');
  for (const b of allBreaks) {
    if ((getAttrNS(b, 'type') || '').toLowerCase() === 'page') runHasPageBreak = true;
  }

  const plainText = runs.map((r) => r.text).join('').replace(/ /g, ' ').trim();

  return {
    styleName: inherited.name,
    indentLeftIn,
    indentRightIn,
    alignment: alignment as ParaInfo['alignment'],
    paragraphBold,
    paragraphItalic,
    paragraphCaps,
    pageBreakBefore: pageBreakBefore || runHasPageBreak,
    plainText,
    runs,
  };
}

function flattenBody(body: Element, styleMap: StyleMap, warnings: string[]): {
  paragraphs: ParaInfo[];
  /** Indices that pair into dual-dialogue blocks: [leftStartIdx, leftEndIdx, rightStartIdx, rightEndIdx]. */
  dualBlocks: Array<{ leftStart: number; leftEnd: number; rightStart: number; rightEnd: number }>;
} {
  const paragraphs: ParaInfo[] = [];
  const dualBlocks: Array<{ leftStart: number; leftEnd: number; rightStart: number; rightEnd: number }> = [];

  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const local = el.localName;
    if (local === 'p') {
      paragraphs.push(readParagraph(el, styleMap));
    } else if (local === 'tbl') {
      // Inspect rows.  A 2-column row → potential dual-dialogue.
      const rows = childrenNS(el, 'tr');
      let firstRow: Element | undefined = rows[0];
      const cellsInFirst = firstRow ? childrenNS(firstRow, 'tc') : [];
      if (cellsInFirst.length === 2) {
        const leftStart = paragraphs.length;
        // Read all paragraphs in left cell
        const leftPs = childrenNS(cellsInFirst[0], 'p');
        for (const lp of leftPs) {
          const para = readParagraph(lp, styleMap);
          para.dualColumn = 'left';
          paragraphs.push(para);
        }
        const leftEnd = paragraphs.length - 1;
        const rightStart = paragraphs.length;
        const rightPs = childrenNS(cellsInFirst[1], 'p');
        for (const rp of rightPs) {
          const para = readParagraph(rp, styleMap);
          para.dualColumn = 'right';
          paragraphs.push(para);
        }
        const rightEnd = paragraphs.length - 1;
        if (leftEnd >= leftStart && rightEnd >= rightStart) {
          dualBlocks.push({ leftStart, leftEnd, rightStart, rightEnd });
        }
        // Also include any subsequent rows as plain paragraphs (rare in screenplays)
        for (let r = 1; r < rows.length; r++) {
          for (const tc of childrenNS(rows[r], 'tc')) {
            for (const tp of childrenNS(tc, 'p')) {
              paragraphs.push(readParagraph(tp, styleMap));
            }
          }
        }
      } else {
        warnings.push('Encountered a table that is not a dual-dialogue layout — flattened cells into action.');
        for (const r of rows) {
          for (const tc of childrenNS(r, 'tc')) {
            for (const tp of childrenNS(tc, 'p')) {
              paragraphs.push(readParagraph(tp, styleMap));
            }
          }
        }
      }
    }
    // Other elements (sectPr, bookmarks, drawings, etc.) — ignore
  }

  return { paragraphs, dualBlocks };
}

// --- Classification ---

function approxEq(a: number | undefined, target: number, tol = INDENT_TOLERANCE_IN): boolean {
  return a != null && Math.abs(a - target) <= tol;
}

function looksLikeCharacter(text: string): boolean {
  if (!text) return false;
  // Strip an optional cue extension like "(V.O.)" / "(O.S.)" / "(CONT'D)" before testing
  const cleaned = text.replace(/\(.*?\)$/, '').trim();
  if (cleaned.length === 0) return false;
  if (cleaned.length > 40) return false; // names are short
  if (/[.!?]$/.test(cleaned)) return false; // sentences end with punctuation
  // Must be all-caps (allowing punctuation, digits, spaces)
  const letters = cleaned.replace(/[^A-Za-z]/g, '');
  if (letters.length === 0) return false;
  return cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
}

function classifyByStyleName(name: string): string | null {
  if (!name) return null;
  for (const [re, type] of STYLE_NAME_MAP) {
    if (re.test(name.trim())) return type;
  }
  return null;
}

function classifyByIndent(p: ParaInfo): string | null {
  // Right-aligned at any indent → transition is a strong signal
  if (p.alignment === 'right') return 'transition';
  const left = p.indentLeftIn;
  if (left == null) return null;
  if (approxEq(left, FD_LEFT_INDENTS.character)) return 'character';
  if (approxEq(left, FD_LEFT_INDENTS.parenthetical)) return 'parenthetical';
  if (approxEq(left, FD_LEFT_INDENTS.dialogue)) {
    return p.paragraphItalic ? 'lyrics' : 'dialogue';
  }
  if (approxEq(left, FD_LEFT_INDENTS.transition)) return 'transition';
  // ~1.5" is shared by action/sceneHeading/transition/newAct/etc — defer to text
  return null;
}

function classifyByText(p: ParaInfo): string | null {
  const text = p.plainText;
  if (!text) return null;
  if (RE_SCENE_HEADING.test(text)) return 'sceneHeading';
  if (RE_TRANSITION_END.test(text) || RE_TRANSITION_START.test(text)) return 'transition';
  if (RE_PAREN_ONLY.test(text) && text.length < 80) return 'parenthetical';
  if (p.alignment === 'center' && p.paragraphBold && text === text.toUpperCase()) {
    if (/^ACT\b/i.test(text) || /\bACT\b/i.test(text)) {
      if (/END/i.test(text)) return 'endOfAct';
      return 'newAct';
    }
  }
  return null;
}

// --- Title-page detection ---

interface TitlePageData {
  tpTitle: string;
  tpWrittenBy: string;
  tpBasedOn: string;
  tpDraft: string;
  tpDraftDate: string;
  tpContact: string;
  tpCopyright: string;
  tpWgaRegistration: string;
}

function emptyTitlePage(): TitlePageData {
  return {
    tpTitle: '', tpWrittenBy: '', tpBasedOn: '', tpDraft: '', tpDraftDate: '',
    tpContact: '', tpCopyright: '', tpWgaRegistration: '',
  };
}

function detectTitlePage(paragraphs: ParaInfo[]): { tp: TitlePageData | null; consumed: number } {
  // Walk paragraphs until we either: hit a hard page break, hit a scene heading,
  // or hit ~30 paragraphs (safety cap).  All non-empty paragraphs in the run
  // must be center-aligned for it to count as a title page.
  let end = -1;
  let sawCenter = false;
  for (let i = 0; i < Math.min(paragraphs.length, 40); i++) {
    const p = paragraphs[i];
    if (p.pageBreakBefore && i > 0) {
      end = i; // consume up to but not including this break
      break;
    }
    if (p.plainText && RE_SCENE_HEADING.test(p.plainText)) {
      end = i;
      break;
    }
    if (p.plainText) {
      if (p.alignment === 'center') sawCenter = true;
      else if (p.alignment === 'left' && i > 5) {
        // Allow a few non-center paragraphs at the very top, but a left-aligned
        // body line means we're already past the title page.
        end = -1;
        break;
      }
    }
  }
  if (!sawCenter || end < 0) return { tp: null, consumed: 0 };

  const tp = emptyTitlePage();
  const lines: string[] = [];
  for (let i = 0; i < end; i++) {
    if (paragraphs[i].plainText) lines.push(paragraphs[i].plainText);
  }
  if (lines.length === 0) return { tp: null, consumed: 0 };

  tp.tpTitle = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i];
    if (/^(written\s+by|by)$/i.test(t) && i + 1 < lines.length) {
      tp.tpWrittenBy = lines[i + 1];
      i++;
    } else if (/^(based\s+on|from)/i.test(t)) {
      tp.tpBasedOn = t;
    } else if (/copyright|©/i.test(t)) {
      tp.tpCopyright = t;
    } else if (/\bWGA\b|registration/i.test(t)) {
      tp.tpWgaRegistration = t;
    } else if (/draft/i.test(t)) {
      tp.tpDraft = t;
    } else if (/@|\.com|phone|\d{3}[-.)\s]\d{3}/i.test(t)) {
      tp.tpContact = tp.tpContact ? `${tp.tpContact}\n${t}` : t;
    }
  }
  return { tp, consumed: end };
}

// --- Build Tiptap nodes ---

// Types whose visual marks are provided automatically by the renderer; don't
// re-emit them as marks on every text run (would cause double-bold etc.).
const TYPE_PROVIDED_BOLD = new Set(['sceneHeading', 'newAct', 'endOfAct', 'showEpisode']);
const TYPE_PROVIDED_ITALIC = new Set(['lyrics', 'parenthetical']);
const TYPE_PROVIDED_UNDERLINE = new Set(['newAct']);

function runsToTextNodes(runs: RunInfo[], typeName: string): TipTapNode[] {
  const stripBold = TYPE_PROVIDED_BOLD.has(typeName);
  const stripItalic = TYPE_PROVIDED_ITALIC.has(typeName);
  const stripUnderline = TYPE_PROVIDED_UNDERLINE.has(typeName);
  const out: TipTapNode[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const marks: TipTapMark[] = [];
    if (r.bold && !stripBold) marks.push({ type: 'bold' });
    if (r.italic && !stripItalic) marks.push({ type: 'italic' });
    if (r.underline && !stripUnderline) marks.push({ type: 'underline' });
    if (r.strike) marks.push({ type: 'strike' });
    const node: TipTapNode = { type: 'text', text: r.text };
    if (marks.length > 0) node.marks = marks;
    out.push(node);
  }
  return out;
}

function buildNode(typeName: string, runs: RunInfo[], plainText: string): TipTapNode {
  const node: TipTapNode = { type: typeName };
  // Empty paragraphs: emit an empty content array so Tiptap renders a blank line.
  if (!plainText) {
    node.content = [];
    return node;
  }
  const textNodes = runsToTextNodes(runs, typeName);
  node.content = textNodes.length > 0 ? textNodes : [{ type: 'text', text: plainText }];
  return node;
}

// --- Main parse ---

export async function parseDocx(buf: ArrayBuffer): Promise<DocxParseResult> {
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Not a valid .docx file: missing word/document.xml');
  }
  const docXmlText = await docFile.async('string');
  const stylesFile = zip.file('word/styles.xml');
  const stylesXmlText = stylesFile ? await stylesFile.async('string') : null;

  const parser = new DOMParser();
  const docXml = parser.parseFromString(docXmlText, 'application/xml');
  const stylesXml = stylesXmlText ? parser.parseFromString(stylesXmlText, 'application/xml') : null;

  // Try to read core title
  let scriptTitle = '';
  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    try {
      const coreText = await coreFile.async('string');
      const coreXml = parser.parseFromString(coreText, 'application/xml');
      const titleEl =
        coreXml.getElementsByTagName('dc:title')[0] ||
        coreXml.getElementsByTagName('title')[0];
      if (titleEl?.textContent) scriptTitle = titleEl.textContent.trim();
    } catch {
      // ignore
    }
  }

  const styleMap = buildStyleMap(stylesXml);
  const body =
    docXml.getElementsByTagNameNS(W_NS, 'body')[0] ||
    docXml.getElementsByTagName('w:body')[0];
  if (!body) {
    throw new Error('Not a valid .docx file: missing <w:body>');
  }

  // Page margin from the (last) sectPr — paragraph indents in OOXML are
  // relative to the page text area (not the page edge), so we must add the
  // page-margin-left to get an absolute indent before comparing to FD_INDENTS.
  const sectPrs = body.getElementsByTagNameNS(W_NS, 'sectPr');
  let pageMarginLeftIn = 0;
  if (sectPrs.length > 0) {
    const pgMar = firstChildNS(sectPrs[sectPrs.length - 1], 'pgMar');
    if (pgMar) {
      const left = getAttrNS(pgMar, 'left') ?? getAttrNS(pgMar, 'start');
      if (left != null) {
        const n = Number(left);
        if (!isNaN(n)) pageMarginLeftIn = n / TWIPS_PER_INCH;
      }
    }
  }

  const warnings: string[] = [];
  const { paragraphs, dualBlocks } = flattenBody(body, styleMap, warnings);

  // Convert each paragraph's indent from "relative to page margin" (Word's
  // native representation) to an absolute position from the page edge so the
  // indent classifier can compare against FD_INDENTS.
  if (pageMarginLeftIn !== 0) {
    for (const p of paragraphs) {
      if (p.indentLeftIn != null) p.indentLeftIn += pageMarginLeftIn;
    }
  }

  // Detect optional title page off the front
  const { tp, consumed } = detectTitlePage(paragraphs);

  // Map dualBlock indices to a quick lookup so we can emit a single node
  const dualByLeftStart = new Map<number, typeof dualBlocks[number]>();
  for (const b of dualBlocks) dualByLeftStart.set(b.leftStart, b);
  const skipUntil = new Set<number>();

  // First pass: classify every paragraph
  const types: string[] = new Array(paragraphs.length).fill('action');
  let ambiguousCount = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    if (i < consumed) continue; // title-page paragraphs not classified
    const p = paragraphs[i];
    if (!p.plainText) {
      types[i] = 'action'; // empty paragraph — preserved as blank action
      continue;
    }
    let cls: string | null = classifyByStyleName(p.styleName);
    if (!cls) cls = classifyByIndent(p);
    if (!cls) cls = classifyByText(p);
    if (cls) {
      types[i] = cls;
    } else {
      // Heuristic: short all-caps line → tentative character (confirmed in pass 2)
      if (looksLikeCharacter(p.plainText)) {
        types[i] = 'character';
      } else {
        types[i] = 'action';
        ambiguousCount++;
        if (warnings.length < 10) {
          warnings.push(`Line ${i + 1}: "${p.plainText.slice(0, 60)}" — defaulted to action`);
        }
      }
    }
  }

  // Second pass: enforce sequencing.  After a confirmed character cue, walk
  // forward through the dialogue block (parenthetical / dialogue / lyrics, or
  // any paragraph whose indent or text shape fits) and promote action lines to
  // dialogue.  Stops at the first paragraph that clearly belongs to a new
  // block (scene heading, transition, another character cue, blank gap).
  for (let i = 0; i < paragraphs.length; i++) {
    if (types[i] !== 'character') continue;
    let next = i + 1;
    while (next < paragraphs.length && !paragraphs[next].plainText) next++;
    if (next >= paragraphs.length) {
      types[i] = 'action';
      continue;
    }
    const np0 = paragraphs[next];
    const nt0 = types[next];
    const looksDialogue0 = nt0 === 'dialogue' || nt0 === 'parenthetical' || nt0 === 'lyrics';
    const indentSuggestsDialogue0 =
      approxEq(np0.indentLeftIn, FD_LEFT_INDENTS.dialogue) ||
      approxEq(np0.indentLeftIn, FD_LEFT_INDENTS.parenthetical);
    const ft0 = np0.plainText;
    const followerLooksLikeProse0 =
      ft0.length > 0 &&
      ft0 !== ft0.toUpperCase() &&
      !RE_SCENE_HEADING.test(ft0) &&
      !RE_TRANSITION_END.test(ft0) &&
      !RE_TRANSITION_START.test(ft0);
    if (!looksDialogue0 && !indentSuggestsDialogue0 && !followerLooksLikeProse0) {
      // Not actually a character cue
      types[i] = 'action';
      continue;
    }
    // Walk the dialogue block, promoting action lines to dialogue.  Stop at
    // anything that clearly starts a new block.
    let j = next;
    while (j < paragraphs.length) {
      const np = paragraphs[j];
      if (!np.plainText) { j++; continue; }
      const tj = types[j];
      // Hard stops: things that are definitely not dialogue.
      if (tj === 'sceneHeading' || tj === 'transition' || tj === 'newAct' ||
          tj === 'endOfAct' || tj === 'shot' || tj === 'showEpisode' ||
          tj === 'castList') break;
      if (tj === 'character') break;
      // Standalone all-caps line (likely a new character cue) ends the block.
      if (looksLikeCharacter(np.plainText) && tj !== 'parenthetical') break;
      // Promote action → dialogue inside the block, leave parenthetical/lyrics alone.
      if (tj === 'action' && !RE_PAREN_ONLY.test(np.plainText)) {
        types[j] = 'dialogue';
      }
      j++;
      // After the first non-empty paragraph in the block, only continue if the
      // next one is still indented like dialogue or shaped like prose.  This
      // prevents runaway promotion across blank gaps.
      const k = j;
      if (k < paragraphs.length && paragraphs[k].plainText) {
        const npk = paragraphs[k];
        const tk = types[k];
        const stillBlock =
          tk === 'dialogue' || tk === 'parenthetical' || tk === 'lyrics' ||
          approxEq(npk.indentLeftIn, FD_LEFT_INDENTS.dialogue) ||
          approxEq(npk.indentLeftIn, FD_LEFT_INDENTS.parenthetical) ||
          RE_PAREN_ONLY.test(npk.plainText);
        if (!stillBlock) break;
      }
    }
  }

  // Third pass: build TipTap nodes
  const content: TipTapNode[] = [];

  // Title-page node
  if (tp && tp.tpTitle) {
    content.push({
      type: 'titlePage',
      attrs: { ...tp, field: 'title' },
      content: [{ type: 'text', text: tp.tpTitle }],
    });
    if (!scriptTitle) scriptTitle = tp.tpTitle;
  }

  for (let i = consumed; i < paragraphs.length; i++) {
    if (skipUntil.has(i)) continue;

    // Dual-dialogue block?
    const dual = dualByLeftStart.get(i);
    if (dual) {
      // Build inner nodes for each side; treat as their own mini-classifier pass
      const innerNodes: TipTapNode[] = [];
      const sides: Array<[number, number]> = [
        [dual.leftStart, dual.leftEnd],
        [dual.rightStart, dual.rightEnd],
      ];
      for (const [s, e] of sides) {
        for (let j = s; j <= e; j++) {
          const p = paragraphs[j];
          let t = types[j];
          // Inside a 2-col table, force the first non-empty para to character if all-caps
          if (t === 'action' && looksLikeCharacter(p.plainText)) t = 'character';
          else if (t === 'action' && p.plainText && j > s) t = 'dialogue';
          innerNodes.push(buildNode(t, p.runs, p.plainText));
          skipUntil.add(j);
        }
      }
      content.push({ type: 'dualDialogue', content: innerNodes });
      continue;
    }

    const p = paragraphs[i];
    const t = types[i];
    content.push(buildNode(t, p.runs, p.plainText));
  }

  if (content.length === 0) {
    content.push({ type: 'action', content: [] });
  }

  if (ambiguousCount > 0) {
    warnings.unshift(
      `${ambiguousCount} paragraph(s) auto-classified as Action — review and re-tag any that should be a different element type.`,
    );
  }

  return {
    doc: { type: 'doc', content },
    scriptTitle,
    warnings,
    ambiguousCount,
  };
}

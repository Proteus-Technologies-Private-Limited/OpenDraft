/**
 * Open Screenplay Format (.osf) and Fade In (.fadein) parser.
 *
 * Fade In saves in the Open Screenplay Format: a ZIP archive whose single
 * entry is `document.xml`.  A `.osf` file is that same XML, unzipped.  One
 * parser therefore covers both.
 *
 * Five OSF revisions exist in the wild and they do not agree on how a
 * paragraph names the style it uses:
 *
 *   version="12"  basestylename, lowercase attributes, title page on <info>
 *   version="20"  basestylename, title page is a <titlepage> block
 *   version="21"  baseStyleName — the one camelCase revision
 *   version="30"  basestylename, written by Fade In 3.x
 *   version="40"  basestyle — shortened, and scene numbers moved to `number`
 *
 * Every attribute read here accepts all the spellings, because getting this
 * wrong is not a small loss: a paragraph whose style cannot be identified
 * falls back to Action, so one unrecognized spelling flattens an entire
 * script to the left margin (issue #61, a 4.0 file read by a 3.x-only
 * reader).  That fallback now warns for exactly this reason.
 */
import JSZip from 'jszip';
import { isDocumentFont, isDocumentSize } from './fonts';
import { buildTitlePageBlocks, type TitlePageFields } from './titlePageBlocks';

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

/**
 * The typeface a document is written in.  OSF keeps it on the *styles*, not on
 * the text — a Times New Roman script has `font="Times New Roman"` once per
 * style and nothing on its runs — so it has to be read from there and applied
 * to the page, or the script imports in whatever font the editor defaults to.
 */
export interface DocumentFont {
  /** Empty when the file names no font. */
  family: string;
  /** Point size as written, e.g. "12".  Empty when the file names none. */
  size: string;
}

export interface OSFParseResult {
  doc: TipTapNode;
  /** Title recovered from the file, if it carries one. */
  scriptTitle: string;
  warnings: string[];
  documentFont: DocumentFont;
}

/**
 * OSF's eight built-in styles, indexed by the `builtin_index` attribute.
 * The order is fixed by the format (see osfdefs.h in the OSF SDK) and is the
 * most reliable way to identify a style — the `name` can be localized.
 */
const BUILTIN_INDEX_TO_TYPE: string[] = [
  'general',       // 0 — Normal Text
  'sceneHeading',  // 1
  'action',        // 2
  'character',     // 3
  'parenthetical', // 4
  'dialogue',      // 5
  'transition',    // 6
  'shot',          // 7
];

/** Style name → element type, keyed lowercase. */
const OSF_STYLE_NAME_TO_TYPE: Record<string, string> = {
  'normal text': 'general',
  'scene heading': 'sceneHeading',
  'action': 'action',
  'character': 'character',
  'parenthetical': 'parenthetical',
  'dialogue': 'dialogue',
  'transition': 'transition',
  'shot': 'shot',
  // Word-processor styles the OSF spec documents alongside the screenplay
  // elements.  They carry no screenplay meaning, so they land on General.
  'title': 'general',
  'heading': 'general',
  'left column': 'general',
  'right column': 'general',
  // Names other tools have been seen to write
  'slug': 'sceneHeading',
  'slugline': 'sceneHeading',
  'dialog': 'dialogue',
  'lyrics': 'lyrics',
  'lyric': 'lyrics',
};

const ALIGNMENT_VALUES = new Set(['left', 'center', 'right', 'justify']);

/**
 * Every spelling of "the style this is based on", newest revision first.
 * 4.0 shortened `basestylename` to `basestyle`; 2.1 camelCased it.
 */
const BASE_STYLE_ATTRS = ['basestylename', 'baseStyleName', 'basestyle', 'baseStyle'];

// The Courier family lives in utils/fonts, shared with the FDX side.
export { COURIER_FONTS } from './fonts';

/**
 * Read an attribute that may be spelled either lowercase (OSF 1.2 / 2.0 /
 * Fade In 3.x) or camelCase (OSF 2.1).
 */
function attr(el: Element, ...names: string[]): string | null {
  for (const name of names) {
    const v = el.getAttribute(name);
    if (v !== null) return v;
  }
  // Last resort: case-insensitive scan.  Cheap, and only reached for
  // attributes the file genuinely does not carry under either spelling.
  const wanted = names.map((n) => n.toLowerCase());
  for (const a of Array.from(el.attributes)) {
    if (wanted.includes(a.name.toLowerCase())) return a.value;
  }
  return null;
}

/** OSF writes booleans as "1"/"0" and occasionally "true"/"false". */
function attrIsTrue(el: Element, ...names: string[]): boolean {
  const v = attr(el, ...names);
  return v === '1' || v?.toLowerCase() === 'true';
}

/**
 * Direct children with the given tag name, matched case-insensitively.
 *
 * Deliberately not querySelector: `:scope >` support is inconsistent in older
 * WebViews, and plain child traversal works against any DOM implementation.
 */
function childrenNamed(parent: Element, name: string): Element[] {
  const wanted = name.toLowerCase();
  return Array.from(parent.children).filter((el) => el.tagName.toLowerCase() === wanted);
}

function firstChildNamed(parent: Element, name: string): Element | null {
  return childrenNamed(parent, name)[0] ?? null;
}

function normalizeColor(raw: string | null): string {
  if (!raw) return '';
  const value = raw.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  }
  // Some writers emit 8-digit ARGB/RGBA — keep the RGB triple.
  if (/^#[0-9a-f]{8}$/i.test(value)) return `#${value.slice(1, 7)}`.toLowerCase();
  return '';
}

/**
 * Build the style table from <styles>, so a paragraph using a user-defined
 * element ("Sound Effect" based on Action, say) can be resolved to the
 * built-in it ultimately derives from.
 */
interface StyleDef {
  name: string;
  builtinIndex: number | null;
  baseName: string | null;
  font: string;
  size: string;
}

function collectStyles(root: Element): Map<string, StyleDef> {
  const table = new Map<string, StyleDef>();
  const stylesEl = firstChildNamed(root, 'styles');
  if (!stylesEl) return table;

  for (const el of childrenNamed(stylesEl, 'style')) {
    const name = attr(el, 'name');
    if (!name) continue;
    const idxRaw = attr(el, 'builtin_index', 'builtInIndex');
    const idx = idxRaw !== null && idxRaw !== '' ? parseInt(idxRaw, 10) : NaN;
    table.set(name.toLowerCase(), {
      name,
      builtinIndex: Number.isFinite(idx) ? idx : null,
      baseName: attr(el, ...BASE_STYLE_ATTRS),
      font: attr(el, 'font') ?? '',
      size: attr(el, 'size') ?? '',
    });
  }
  return table;
}

/**
 * The document's own typeface: whatever Normal Text (built-in index 0) is set
 * in, since every other style inherits from it.
 *
 * Warns when the styles disagree, because OpenDraft carries one font for the
 * page and per-element typefaces would be silently levelled otherwise.
 */
function documentFontOf(styles: Map<string, StyleDef>, warnings: string[]): DocumentFont {
  const defs = Array.from(styles.values()).filter((s) => s.font !== '');
  if (defs.length === 0) return { family: '', size: '' };

  const base =
    defs.find((s) => s.builtinIndex === 0) ??
    styles.get('normal text') ??
    defs[0];

  const others = new Set(defs.map((s) => s.font));
  others.delete(base.font);
  if (others.size > 0) {
    warnings.push(
      `The file sets a different font on some elements (${Array.from(others).join(', ')}); ` +
        `the whole script was imported in ${base.font}.`,
    );
  }

  return { family: base.font, size: base.size };
}

/**
 * Resolve a style name to an OpenDraft element type.
 *
 * Tries, in order: the built-in index recorded in <styles>, the style name
 * itself, then the name of the style it is based on (walking up the chain).
 * Falls back to Action, which is the least surprising home for text whose
 * element we cannot identify.
 */
function resolveStyleType(
  styleName: string | null,
  styles: Map<string, StyleDef>,
  warnings: string[],
): string {
  if (!styleName) {
    // Silence here is what made issue #61 hard to see: every paragraph of a
    // 4.0 file landed on Action and the import reported success.
    warnings.push('A paragraph named no element style and was imported as Action.');
    return 'action';
  }

  const seen = new Set<string>();
  let current: string | null = styleName;

  while (current) {
    const key = current.toLowerCase();
    if (seen.has(key)) break; // cyclic basestylename — bail out
    seen.add(key);

    const def = styles.get(key);
    if (def?.builtinIndex !== null && def?.builtinIndex !== undefined) {
      const byIndex = BUILTIN_INDEX_TO_TYPE[def.builtinIndex];
      if (byIndex) return byIndex;
    }
    const byName = OSF_STYLE_NAME_TO_TYPE[key];
    if (byName) return byName;

    current = def?.baseName ?? null;
  }

  warnings.push(`Unknown element style "${styleName}" imported as Action.`);
  return 'action';
}

/**
 * OSF 1.2 does not carry inline formatting as attributes on <text>.  It
 * escapes a small pseudo-HTML vocabulary into the run's own text instead:
 *
 *   &lt;b&gt;Bold &lt;i&gt;and italic&lt;/i&gt;&lt;/b&gt;
 *   &lt;font="Times New Roman"&gt;&lt;size="18"&gt;Big&lt;/size&gt;&lt;/font&gt;
 *   &lt;bgcolor="#00FF00"&gt;Highlighted&lt;/bgcolor&gt;, &lt;br&gt;
 *
 * Without this the tags would import as literal text.  Only consulted for
 * pre-2.0 documents, so a 2.x file whose dialogue happens to mention `<b>`
 * keeps it verbatim.
 */
const LEGACY_TAG = /<(\/?)(b|i|u|s|strike|br|font|size|bgcolor)(?:="([^"]*)")?>/gi;

function hasLegacyInline(text: string): boolean {
  LEGACY_TAG.lastIndex = 0;
  return LEGACY_TAG.test(text);
}

/** Marks for the currently open legacy tags. */
function legacyMarks(state: {
  bold: number;
  italic: number;
  underline: number;
  strike: number;
  font: string[];
  size: string[];
  bg: string[];
}, base: DocumentFont): TipTapMark[] {
  const marks: TipTapMark[] = [];
  if (state.bold > 0) marks.push({ type: 'bold' });
  if (state.italic > 0) marks.push({ type: 'italic' });
  if (state.underline > 0) marks.push({ type: 'underline' });
  if (state.strike > 0) marks.push({ type: 'strike' });

  const bg = normalizeColor(state.bg[state.bg.length - 1] ?? null);
  if (bg) marks.push({ type: 'highlight', attrs: { color: bg } });

  const font = state.font[state.font.length - 1];
  const size = state.size[state.size.length - 1];
  const styleAttrs: Record<string, string> = {};
  if (font && !isDocumentFont(font, base.family)) styleAttrs.fontFamily = font;
  if (size && !isDocumentSize(size, base.size)) styleAttrs.fontSize = `${size}pt`;
  if (Object.keys(styleAttrs).length > 0) marks.push({ type: 'textStyle', attrs: styleAttrs });

  return marks;
}

function parseLegacyInline(content: string, into: TipTapNode[], base: DocumentFont): void {
  const state = { bold: 0, italic: 0, underline: 0, strike: 0, font: [] as string[], size: [] as string[], bg: [] as string[] };
  const push = (segment: string) => {
    if (segment === '') return;
    const marks = legacyMarks(state, base);
    segment.split('\n').forEach((part, i) => {
      if (i > 0) into.push({ type: 'hardBreak' });
      if (part === '') return;
      const node: TipTapNode = { type: 'text', text: part };
      if (marks.length > 0) node.marks = marks.map((m) => ({ ...m }));
      into.push(node);
    });
  };

  LEGACY_TAG.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = LEGACY_TAG.exec(content)) !== null) {
    push(content.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const value = match[3];

    switch (tag) {
      case 'br':
        if (!closing) into.push({ type: 'hardBreak' });
        break;
      case 'b': state.bold += closing ? -1 : 1; break;
      case 'i': state.italic += closing ? -1 : 1; break;
      case 'u': state.underline += closing ? -1 : 1; break;
      case 's':
      case 'strike': state.strike += closing ? -1 : 1; break;
      case 'font': if (closing) state.font.pop(); else state.font.push(value ?? ''); break;
      case 'size': if (closing) state.size.pop(); else state.size.push(value ?? ''); break;
      case 'bgcolor': if (closing) state.bg.pop(); else state.bg.push(value ?? ''); break;
    }
  }
  push(content.slice(cursor));
}

/** Turn one <text> run into text nodes, splitting any embedded soft returns. */
function parseTextRun(
  textEl: Element,
  into: TipTapNode[],
  legacyInline: boolean,
  base: DocumentFont,
): boolean {
  const content = (textEl.textContent || '').replace(/\r\n?/g, '\n');
  if (content === '') return false;

  if (legacyInline && hasLegacyInline(content)) {
    parseLegacyInline(content, into, base);
    return true;
  }

  const marks: TipTapMark[] = [];
  if (attrIsTrue(textEl, 'bold')) marks.push({ type: 'bold' });
  if (attrIsTrue(textEl, 'italic')) marks.push({ type: 'italic' });
  if (attrIsTrue(textEl, 'underline')) marks.push({ type: 'underline' });
  if (attrIsTrue(textEl, 'strikethrough', 'strikeThrough')) marks.push({ type: 'strike' });

  const bg = normalizeColor(attr(textEl, 'bgcolor', 'bgColor'));
  if (bg) marks.push({ type: 'highlight', attrs: { color: bg } });

  const font = attr(textEl, 'font');
  const size = attr(textEl, 'size');
  const color = normalizeColor(attr(textEl, 'color'));
  const styleAttrs: Record<string, string> = {};
  if (font && !isDocumentFont(font, base.family)) styleAttrs.fontFamily = font;
  if (size && !isDocumentSize(size, base.size)) styleAttrs.fontSize = `${size}pt`;
  if (color && color !== '#000000') styleAttrs.color = color;
  if (Object.keys(styleAttrs).length > 0) marks.push({ type: 'textStyle', attrs: styleAttrs });

  // A newline inside <text> is a soft return; it has to become a real
  // hardBreak node or no exporter would round-trip it.
  content.split('\n').forEach((segment, i) => {
    if (i > 0) into.push({ type: 'hardBreak' });
    if (segment === '') return;
    const node: TipTapNode = { type: 'text', text: segment };
    if (marks.length > 0) node.marks = marks.map((m) => ({ ...m }));
    into.push(node);
  });
  return true;
}

/**
 * OSF stores a parenthetical bare — `<text>excited</text>`, not "(excited)" —
 * and leaves the brackets to whoever renders it.  OpenDraft keeps them in the
 * text, as Fountain and Final Draft do, so they have to be put back or every
 * parenthetical imports unbracketed.
 *
 * Left alone when either end already carries one, so "(beat)" written out in
 * full, and oddities like "(to Bob) quietly", are not double-bracketed.
 */
function bracketParenthetical(nodes: TipTapNode[]): void {
  const runs = nodes.filter((n) => n.type === 'text' && typeof n.text === 'string');
  if (runs.length === 0) return;

  const flat = runs.map((n) => n.text).join('').trim();
  if (flat === '' || flat.startsWith('(') || flat.endsWith(')')) return;

  const first = runs[0];
  const last = runs[runs.length - 1];
  first.text = `(${first.text}`;
  last.text = `${last.text})`;
}

interface ParsedPara {
  node: TipTapNode;
  /** True when the paragraph's style carries dualdialogue="1". */
  dual: boolean;
}

function parseParagraph(
  para: Element,
  styles: Map<string, StyleDef>,
  warnings: string[],
  legacyInline: boolean,
  base: DocumentFont,
): ParsedPara | null {
  const styleEl = firstChildNamed(para, 'style');
  // A base-style name is what a paragraph normally carries; Fade In writes a
  // bare `name` on the document's trailing paragraph instead.  The built-in
  // index is a last resort — no file in the corpus references a style that
  // way, but it is the format's own unambiguous identifier, and reaching it
  // beats flattening the paragraph to Action.
  const styleName = styleEl
    ? attr(styleEl, ...BASE_STYLE_ATTRS) ?? attr(styleEl, 'name')
    : null;
  const styleIndex = styleEl ? parseInt(attr(styleEl, 'builtin_index', 'builtInIndex') ?? '', 10) : NaN;
  const byIndex = styleName ? undefined : BUILTIN_INDEX_TO_TYPE[styleIndex];

  const nodeType = byIndex ?? resolveStyleType(styleName, styles, warnings);
  const attrs: Record<string, unknown> = {};

  // OSF 4.0 renamed `scene_number` to plain `number`.  Only a scene heading's
  // is a scene number — 4.0 numbers dialogue through the same attribute.
  const sceneNumber =
    attr(para, 'scene_number', 'sceneNumber') ??
    (nodeType === 'sceneHeading' ? attr(para, 'number') : null);
  if (sceneNumber) attrs.sceneNumber = sceneNumber;

  // Both note and synopsis land on the scene heading's synopsis field — the
  // only per-element prose slot OpenDraft has.  Losing them outright would be
  // worse than merging them.
  const synopsisParts = [
    attr(para, 'synopsis'),
    attr(para, 'note'),
  ].filter((v): v is string => !!v && v.trim() !== '');
  if (synopsisParts.length > 0 && nodeType === 'sceneHeading') {
    attrs.synopsis = synopsisParts.join('\n');
  } else if (synopsisParts.length > 0) {
    warnings.push(`Note on a non-scene-heading paragraph was dropped: "${synopsisParts[0].slice(0, 40)}"`);
  }

  if (styleEl) {
    const align = attr(styleEl, 'align')?.toLowerCase();
    if (align && ALIGNMENT_VALUES.has(align)) attrs.textAlign = align;
    if (attrIsTrue(styleEl, 'pagebreakbefore', 'pageBreakBefore')) attrs.startsNewPage = true;
  }

  const textNodes: TipTapNode[] = [];
  let hasContent = false;
  for (const el of childrenNamed(para, 'text')) {
    if (parseTextRun(el, textNodes, legacyInline, base)) hasContent = true;
  }

  if (nodeType === 'parenthetical' && hasContent) bracketParenthetical(textNodes);

  const node: TipTapNode = { type: nodeType };
  if (Object.keys(attrs).length > 0) node.attrs = attrs;
  node.content = hasContent ? textNodes : [];

  return { node, dual: styleEl ? attrIsTrue(styleEl, 'dualdialogue', 'dualDialogue') : false };
}

const DIALOGUE_TYPES = new Set(['character', 'dialogue', 'parenthetical']);

/**
 * One speech: the character cue at `start` plus the parentheticals and
 * dialogue that follow it, stopping at the next cue or any other element.
 */
function collectSpeech(items: ParsedPara[], start: number): { nodes: TipTapNode[]; next: number } {
  const nodes: TipTapNode[] = [items[start].node];
  let i = start + 1;
  while (i < items.length && items[i].node.type !== 'character' && DIALOGUE_TYPES.has(items[i].node.type)) {
    nodes.push(items[i].node);
    i++;
  }
  return { nodes, next: i };
}

/**
 * OSF marks the *first* speaker of a dual-dialogue pair with
 * dualdialogue="1" on its Character paragraph; the speech that follows is the
 * second column.  (Note this is the opposite of Fountain, where the `^` goes
 * on the second speaker.)  Both the OSF 1.2 and 2.0 sample documents agree on
 * the marker being on the first.
 */
function mergeDualDialogue(items: ParsedPara[]): TipTapNode[] {
  const result: TipTapNode[] = [];
  let i = 0;

  while (i < items.length) {
    const item = items[i];
    if (!(item.dual && item.node.type === 'character')) {
      result.push(item.node);
      i++;
      continue;
    }

    const left = collectSpeech(items, i);
    if (left.next < items.length && items[left.next].node.type === 'character') {
      const right = collectSpeech(items, left.next);
      result.push({
        type: 'dualDialogue',
        content: [
          { type: 'dualDialogueColumn', content: left.nodes },
          { type: 'dualDialogueColumn', content: right.nodes },
        ],
      });
      i = right.next;
      continue;
    }

    // No second speaker to pair with — keep it as ordinary dialogue.
    result.push(...left.nodes);
    i = left.next;
  }

  return result;
}

/**
 * Flatten a title-page <para> to plain text.  Title-page fields are stored as
 * strings, so 1.2's inline tags are stripped rather than turned into marks.
 */
function paraText(para: Element, legacyInline: boolean): string {
  let text = childrenNamed(para, 'text')
    .map((el) => el.textContent || '')
    .join('')
    .replace(/\r\n?/g, '\n');
  if (legacyInline && hasLegacyInline(text)) {
    LEGACY_TAG.lastIndex = 0;
    text = text.replace(LEGACY_TAG, (_, closing: string, tag: string) =>
      !closing && tag.toLowerCase() === 'br' ? '\n' : '',
    );
  }
  return text.trim();
}

const TITLE_PAGE_ATTR_DEFAULTS: Record<string, string> = {
  field: 'title',
  tpTitle: '',
  tpWrittenBy: '',
  tpBasedOn: '',
  tpDraft: '',
  tpDraftDate: '',
  tpContact: '',
  tpCopyright: '',
  tpWgaRegistration: '',
  tpNotes: '',
};

/** Maps the bookmark names OSF 2.x uses on title-page paragraphs. */
const BOOKMARK_TO_TP_ATTR: Record<string, string> = {
  title: 'tpTitle',
  subtitle: 'tpBasedOn',
  author: 'tpWrittenBy',
  authors: 'tpWrittenBy',
  copyright: 'tpCopyright',
  draft: 'tpDraft',
  contact: 'tpContact',
  notes: 'tpNotes',
};

/**
 * Build the titlePage node.
 *
 * OSF 1.2 carries the fields as attributes on <info>; 2.0 and later replace
 * that with a laid-out <titlepage> whose paragraphs are identified by
 * `bookmark`.  Both are handled, 1.2 first since a file can only use one.
 */
function parseTitlePage(root: Element, legacyInline: boolean): { nodes: TipTapNode[]; title: string } {
  const tp: Record<string, string> = { ...TITLE_PAGE_ATTR_DEFAULTS };
  let found = false;

  const info = firstChildNamed(root, 'info');
  if (info) {
    const pairs: [string, string | null][] = [
      ['tpTitle', attr(info, 'title')],
      ['tpBasedOn', attr(info, 'subtitle')],
      ['tpWrittenBy', attr(info, 'written_by', 'writtenBy')],
      ['tpCopyright', attr(info, 'copyright')],
      ['tpContact', attr(info, 'contact')],
      ['tpDraft', attr(info, 'drafts', 'draft')],
    ];
    for (const [key, value] of pairs) {
      if (value && value.trim() !== '') {
        tp[key] = value.trim();
        found = true;
      }
    }
  }

  const titlePageEl = firstChildNamed(root, 'titlepage');
  if (titlePageEl) {
    const loose: string[] = [];
    for (const para of childrenNamed(titlePageEl, 'para')) {
      const text = paraText(para, legacyInline);
      if (text === '') continue;
      const bookmark = attr(para, 'bookmark')?.toLowerCase();
      const key = bookmark ? BOOKMARK_TO_TP_ATTR[bookmark] : undefined;
      if (key) {
        tp[key] = tp[key] ? `${tp[key]}\n${text}` : text;
        found = true;
      } else {
        loose.push(text);
      }
    }
    // A title page with no bookmarks at all (some writers omit them) still
    // has a usable title on its first non-empty line.
    if (!found && loose.length > 0) {
      tp.tpTitle = loose[0];
      if (loose.length > 1) tp.tpNotes = loose.slice(1).join('\n');
      found = true;
    } else if (loose.length > 0) {
      tp.tpNotes = tp.tpNotes ? `${tp.tpNotes}\n${loose.join('\n')}` : loose.join('\n');
    }
  }

  if (!found) return { nodes: [], title: '' };

  // Expanded into the laid-out run the paginator and exporters measure, rather
  // than the single attrs-only node this used to return (issue #52).
  return {
    nodes: buildTitlePageBlocks(tp as TitlePageFields) as TipTapNode[],
    title: tp.tpTitle,
  };
}

/**
 * Fade In terminates every document with an empty trailing paragraph carrying
 * the bare "Normal Text" style.  Importing it verbatim leaves a stray empty
 * General element at the end of every script, so drop trailing empties.
 */
function trimTrailingEmpty(nodes: TipTapNode[]): TipTapNode[] {
  const out = [...nodes];
  while (out.length > 0) {
    const last = out[out.length - 1];
    const isEmpty = !last.content || last.content.length === 0;
    if (isEmpty && (last.type === 'general' || last.type === 'action')) out.pop();
    else break;
  }
  return out;
}

/**
 * Collapse repeats, counting them.  A file whose styles we cannot read hits
 * the same warning on every paragraph; hundreds of identical lines bury the
 * others and say nothing that the count does not.
 */
function summarizeWarnings(raw: string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of raw) counts.set(w, (counts.get(w) ?? 0) + 1);
  return Array.from(counts, ([message, n]) => (n > 1 ? `${message} (${n} paragraphs)` : message));
}

/** Parse Open Screenplay Format XML (the contents of a .osf or a Fade In document.xml). */
export function parseOSF(xmlString: string): OSFParseResult {
  const warnings: string[] = [];
  const xmlDoc = new DOMParser().parseFromString(xmlString, 'text/xml');

  // Browsers report malformed XML by substituting a <parsererror> element
  // rather than throwing.
  const parseError = xmlDoc.getElementsByTagName('parsererror')[0];
  if (parseError) {
    throw new Error(
      `Not a valid Open Screenplay Format file: ${parseError.textContent?.trim().split('\n')[0] || 'malformed XML'}`,
    );
  }

  const root = xmlDoc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'document') {
    throw new Error('Not an Open Screenplay Format file: missing <document> root element.');
  }

  // OSF 2.0 moved inline formatting from in-text tags to <text> attributes.
  const version = parseInt(attr(root, 'version') || '', 10);
  const legacyInline = !Number.isFinite(version) || version < 20;

  const styles = collectStyles(root);
  const documentFont = documentFontOf(styles, warnings);
  const { nodes: titlePageNodes, title } = parseTitlePage(root, legacyInline);

  const paragraphsEl = firstChildNamed(root, 'paragraphs');
  const parsed: ParsedPara[] = [];
  if (paragraphsEl) {
    for (const para of childrenNamed(paragraphsEl, 'para')) {
      const item = parseParagraph(para, styles, warnings, legacyInline, documentFont);
      if (item) parsed.push(item);
    }
  } else {
    warnings.push('File contains no <paragraphs> block — the script body is empty.');
  }

  const body = trimTrailingEmpty(mergeDualDialogue(parsed));
  const content: TipTapNode[] = [];
  content.push(...titlePageNodes);
  content.push(...body);
  if (content.length === 0) content.push({ type: 'action', content: [] });

  return {
    doc: { type: 'doc', content },
    scriptTitle: title,
    warnings: summarizeWarnings(warnings),
    documentFont,
  };
}

/** The single entry a Fade In archive holds. */
const FADEIN_DOCUMENT_ENTRY = 'document.xml';

/** Parse a Fade In (.fadein) file — a ZIP archive wrapping an OSF document. */
export async function parseFadeIn(buf: ArrayBuffer): Promise<OSFParseResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    throw new Error(
      `Could not read the Fade In file — it is not a valid .fadein archive (${err instanceof Error ? err.message : String(err)}).`,
    );
  }

  // Fade In writes document.xml at the archive root, but be forgiving about
  // case and about a wrapping folder.
  const entry =
    zip.file(FADEIN_DOCUMENT_ENTRY) ||
    zip.file(/(^|\/)document\.xml$/i)[0] ||
    null;
  if (!entry) {
    const names = Object.keys(zip.files).slice(0, 5).join(', ');
    throw new Error(
      `Fade In file has no ${FADEIN_DOCUMENT_ENTRY}${names ? ` (found: ${names})` : ''}.`,
    );
  }

  return parseOSF(await entry.async('string'));
}

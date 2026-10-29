/**
 * Celtx (.celtx) import — the project files written by the classic desktop
 * Celtx (1.x–2.9). The current Celtx web app exports .fdx and PDF instead,
 * both of which import already.
 *
 * A .celtx file is a zip of a Mozilla-era project (Celtx was built on XUL and
 * its source is public, github.com/tmhorne/celtx):
 *
 *   project.rdf         RDF manifest. Each document is a <cx:Document> whose
 *                       cx:doctype is ScriptDocument for a script, and whose
 *                       cx:localFile names the HTML holding it.
 *   script-XXX.html     The script: one <p class="…"> per element.
 *   scratch-XXX.html    The script's scratchpad (ignored).
 *   local.rdf, …        Catalog and breakdown data (ignored).
 *
 * The element classes are Celtx's own format names, lower-cased — the
 * `celtx.scripteditor.*.formats` preferences list them per script type:
 *
 *   film      sceneheading action character dialog parenthetical transition shot text
 *   theatre   act sceneheading stagedir character dialog parenthetical transition text
 *   radio     sceneheading productionnote character dialog parenthetical sound voice music
 *   AV        sceneheading shot character dialog parenthetical
 *   comic     page panel caption character balloontype balloon
 *
 * The title page lives in the script's <head>: the <title> and the Author,
 * DC.source, DC.rights, CX.contact and CX.byline <meta>s (titlepage.js).
 * A scene heading carries its displayed number in `scenestr`. A writer's page
 * break is a <div class="hardbreak">; <div class="softbreak"> is Celtx's own
 * pagination and is dropped.
 *
 * The HTML is read with a small tag scanner rather than DOMParser: Celtx
 * writes HTML 4 (unclosed <br> and <meta>), which an XML parser rejects, and
 * the element list is flat, so nothing more is needed. Celtx never had dual
 * dialogue, so there is none to carry across.
 */
import { buildTitlePageBlocks, type TitlePageFields } from './titlePageBlocks';
import {
  loadImportArchive,
  findArchiveEntry,
  describeArchiveContents,
  readArchiveText,
  runsToContent,
  plainTextOf,
  type ArchiveImportResult,
  type ImportNode,
  type TextRun,
} from './importArchive';

/** Celtx paragraph class → OpenDraft block type. */
const CLASS_TYPES: Record<string, string> = {
  sceneheading: 'sceneHeading',
  action: 'action',
  character: 'character',
  dialog: 'dialogue',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
  shot: 'shot',
  text: 'general',
  // Theatre
  act: 'newAct',
  stagedir: 'action',
  // Radio: sound, voice and music are cues — numbered with the characters and
  // followed by a dialog paragraph (radio.css).
  productionnote: 'general',
  sound: 'character',
  voice: 'character',
  music: 'character',
  // Comic
  page: 'newAct',
  panel: 'sceneHeading',
  caption: 'action',
  balloontype: 'parenthetical',
  balloon: 'dialogue',
};

/** Title-page <meta> names (Celtx's titlepage.js) → title-page fields. */
const TITLE_META: Record<string, keyof TitlePageFields> = {
  author: 'tpWrittenBy',
  'dc.source': 'tpBasedOn',
  'dc.rights': 'tpCopyright',
  'cx.contact': 'tpContact',
  'cx.byline': 'tpCredit',
};

export async function parseCeltx(data: ArrayBuffer): Promise<ArchiveImportResult> {
  const zip = await loadImportArchive(data, 'Celtx', 'celtx');
  const warnings: string[] = [];

  // The manifest says which HTML file is the script. Fall back to the file
  // naming Celtx always uses when the manifest is missing or unreadable.
  const manifest = findArchiveEntry(zip, /(^|\/)project\.rdf$/i);
  const scripts = manifest ? scriptDocuments(await readArchiveText(manifest)) : [];
  let entry = null;
  for (const script of scripts) {
    entry = findArchiveEntry(zip, new RegExp(`(^|/)${escapeRegExp(script.file)}$`));
    if (entry) {
      if (scripts.length > 1) {
        warnings.push(
          `This Celtx project holds ${scripts.length} scripts; only "${script.title || script.file}" was imported.`,
        );
      }
      break;
    }
  }
  entry ??= findArchiveEntry(zip, /(^|\/)script-[^/]*\.html?$/i);
  if (!entry) {
    throw new Error(`Not a Celtx script: the project has no script document${describeArchiveContents(zip)}.`);
  }

  const parsed = parseCeltxScriptHtml(await readArchiveText(entry));
  return { ...parsed, warnings: [...warnings, ...parsed.warnings] };
}

/** The ScriptDocuments project.rdf lists, in order. */
function scriptDocuments(rdf: string): Array<{ file: string; title: string }> {
  const out: Array<{ file: string; title: string }> = [];
  const docPattern = /<cx:Document\b([^>]*)>([\s\S]*?)<\/cx:Document>/g;
  let m: RegExpExecArray | null;
  while ((m = docPattern.exec(rdf))) {
    if (!/ScriptDocument/.test(m[2])) continue;
    const attrs = parseAttributes(m[1]);
    const file = attrs['cx:localfile'];
    if (file) out.push({ file: decodeEntities(file), title: decodeEntities(attrs['dc:title'] ?? '') });
  }
  return out;
}

/** Parse a Celtx script-*.html. Exported for the tests. */
export function parseCeltxScriptHtml(html: string): ArchiveImportResult {
  const headEnd = html.search(/<body\b/i);
  if (headEnd < 0 && !/<p\b[^>]*\bclass\s*=/i.test(html)) {
    throw new Error('Not a valid Celtx script: the script document has no body.');
  }
  const head = headEnd >= 0 ? html.slice(0, headEnd) : '';
  const body = headEnd >= 0 ? html.slice(headEnd) : html;

  // ── Title page ──
  const fields: TitlePageFields = {};
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = titleMatch ? collapse(decodeEntities(stripTags(titleMatch[1]))) : '';
  if (title) fields.tpTitle = title;
  const metaPattern = /<meta\b([^>]*)>/gi;
  let meta: RegExpExecArray | null;
  while ((meta = metaPattern.exec(head))) {
    const attrs = parseAttributes(meta[1]);
    const key = TITLE_META[(attrs.name ?? '').toLowerCase()];
    const value = decodeEntities(attrs.content ?? '').replace(/\r\n?/g, '\n').trim();
    if (key && value) fields[key] = value;
  }
  // The byline is the credit above the author ("By", "Written by"); on its own
  // with no author it would print as a stray label.
  if (fields.tpCredit && !fields.tpWrittenBy) delete fields.tpCredit;

  // ── Body ──
  const warnings: string[] = [];
  const unknownClasses = new Set<string>();
  const nodes: ImportNode[] = [];
  let pendingPageBreak = false;

  const blockPattern = /<div\b([^>]*)>[\s\S]*?<\/div>|<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi;
  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(body))) {
    if (block[1] !== undefined) {
      if (/\bhardbreak\b/i.test(parseAttributes(block[1]).class ?? '')) pendingPageBreak = true;
      continue;
    }
    const attrs = parseAttributes(block[2]);
    const cls = (attrs.class ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    let type = CLASS_TYPES[cls];
    if (!type) {
      if (cls) unknownClasses.add(cls);
      type = 'action';
    }

    const node: ImportNode = { type, content: runsToContent(inlineRuns(block[3])) };
    if (plainTextOf(node).trim() === '') continue;

    if (type === 'sceneHeading') {
      const number = (attrs.scenestr ?? '').trim();
      if (number) node.attrs = { sceneNumber: number };
    }
    if (pendingPageBreak) {
      node.attrs = { ...node.attrs, startsNewPage: true };
      pendingPageBreak = false;
    }
    nodes.push(node);
  }

  if (unknownClasses.size > 0) {
    warnings.push(`Unrecognised Celtx element types imported as Action: ${[...unknownClasses].join(', ')}.`);
  }

  const titlePage = buildTitlePageBlocks(fields) as ImportNode[];
  if (nodes.length === 0 && titlePage.length === 0) {
    throw new Error('Not a valid Celtx script: the script document has no screenplay elements.');
  }

  return {
    doc: {
      type: 'doc',
      content: [...titlePage, ...(nodes.length > 0 ? nodes : [{ type: 'action', content: [] }])],
    },
    title,
    warnings,
  };
}

// ── HTML scanning ─────────────────────────────────────────────────────────

const INLINE_MARKS: Record<string, string> = {
  b: 'bold',
  strong: 'bold',
  i: 'italic',
  em: 'italic',
  u: 'underline',
};

/**
 * A paragraph's inline HTML as marked text runs.
 *
 * Whitespace collapses as a browser would collapse it — Celtx puts a newline
 * after every <br> in the source — and only <br> breaks a line. Bold, italic
 * and underline come from their tags or from a span's inline style; any other
 * tag (the cast-member spans Celtx wraps names in, for one) keeps its text and
 * loses the tag.
 */
function inlineRuns(html: string): TextRun[] {
  const runs: TextRun[] = [];
  // Each open element and the marks it added, so a closing tag undoes its own.
  const stack: Array<{ tag: string; marks: string[] }> = [];
  const active = () => stack.flatMap((s) => s.marks);

  const tokenPattern = /<\/?([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g;
  let token: RegExpExecArray | null;
  while ((token = tokenPattern.exec(html))) {
    if (token[3] !== undefined) {
      const text = decodeEntities(token[3].replace(/[ \t\r\n\f]+/g, ' '));
      if (text) runs.push({ text, marks: active() });
      continue;
    }
    const tag = token[1].toLowerCase();
    const closing = token[0].startsWith('</');
    if (tag === 'br') {
      runs.push({ text: '\n', marks: [] });
      continue;
    }
    if (closing) {
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at >= 0) stack.splice(at);
      continue;
    }
    if (/\/\s*$/.test(token[2])) continue;
    const marks: string[] = [];
    if (INLINE_MARKS[tag]) marks.push(INLINE_MARKS[tag]);
    const style = parseAttributes(token[2]).style ?? '';
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) marks.push('bold');
    if (/font-style\s*:\s*italic/i.test(style)) marks.push('italic');
    if (/text-decoration[^;]*underline/i.test(style)) marks.push('underline');
    stack.push({ tag, marks });
  }

  // Trim each line of the paragraph, as the page shows it: collapsed space at
  // either side of a <br>, and the <br> Celtx ends every paragraph with.
  const text = runs.map((r) => r.text).join('');
  const lines = text.split('\n').map((l) => l.trim());
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  while (lines.length > 0 && lines[0] === '') lines.shift();
  return retext(runs, lines.join('\n'));
}

/**
 * Re-apply `target` — the runs' text with whitespace trimmed out — to the runs'
 * marks. `target` is the runs' text with characters only ever removed, so it
 * is walked against the original in step.
 */
function retext(runs: TextRun[], target: string): TextRun[] {
  const out: TextRun[] = [];
  let t = 0;
  for (const run of runs) {
    let kept = '';
    for (const ch of run.text) {
      if (t < target.length && target[t] === ch) {
        kept += ch;
        t++;
      }
    }
    if (kept) out.push({ text: kept, marks: run.marks });
  }
  return out;
}

/** Lower-cased attribute names → raw values. */
function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source))) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  mdash: '—', ndash: '–', hellip: '…', copy: '©',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

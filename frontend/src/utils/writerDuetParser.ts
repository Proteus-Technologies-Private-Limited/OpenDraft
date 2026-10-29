/**
 * WriterDuet / WriterSolo (.wdz) import.
 *
 * WriterDuet publishes no specification for .wdz. What this reads is the
 * layout established by reverse-engineering real files (documented in the
 * open-source Scenarly editor's WriterSolo adapter):
 *
 *   - The file is a zip whose one entry, `script.json`, is not a document but
 *     the Firebase-style operation log WriterDuet syncs with:
 *
 *       { "b": { "-": { "h": { <pushId>: op, … } },        the script
 *                "titlePage": { "h": { … } }, … } }         the title page
 *
 *   - Replaying a branch's ops in key order gives `{ data: { <lineId>: line } }`.
 *     An op is `{ a: "s", l: path, v }` (set the subtree), `{ a: "u", l, v }`
 *     (merge each child of v) or `{ l, v }` (set one leaf). `v` is usually JSON
 *     encoded as a string.
 *   - Line ids sort into reading order. A line has a `type` ("Slugline",
 *     "Action", "Character", "Dialogue", "Parenthetical", "Transition"…, or the
 *     "EditDialog…" names WriterDuet uses inside a dialogue block), `pb` for a
 *     page break before it, and its text as operational-transform change sets
 *     under `content` and `.c`: `{ id: [base, ops, timestamp] }`, each op
 *     `["i", [client, ctx, pos, text]]` or `["d", [client, ctx, pos, length]]`.
 *   - Bold, italic and underline are control characters in the text: \x01…\x02,
 *     \x03…\x04 and \x05…\x06.
 *
 * Because none of this is documented by WriterDuet, the parser is deliberately
 * forgiving: line types are matched case-insensitively, an unknown type
 * becomes Action and is reported, a plain `text` string is used when a line
 * carries one, and a `script.json` that is already a snapshot (`{ data }`)
 * rather than a log is read as such. What it cannot find it reports by name
 * rather than importing a blank script.
 *
 * Not carried across: dual dialogue and scene numbers (where WriterDuet keeps
 * them in the log is not known), comments, revisions, and any branch but the
 * main one. A writer who needs those can export .fdx from WriterDuet instead.
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

const MAIN_BRANCH = '-';
const TITLE_BRANCH = 'titlePage';

/** WriterDuet line type (lower-cased) → OpenDraft block type. */
const LINE_TYPES: Record<string, string> = {
  slugline: 'sceneHeading',
  'scene heading': 'sceneHeading',
  sceneheading: 'sceneHeading',
  action: 'action',
  character: 'character',
  editdialogname: 'character',
  dialogue: 'dialogue',
  dialog: 'dialogue',
  editdialogcontent: 'dialogue',
  parenthetical: 'parenthetical',
  editdialogparen: 'parenthetical',
  transition: 'transition',
  shot: 'shot',
  text: 'general',
  general: 'general',
  note: 'note',
  lyrics: 'lyrics',
  act: 'newAct',
  'new act': 'newAct',
  endact: 'endOfAct',
  'end of act': 'endOfAct',
  outline: 'section',
  sequence: 'section',
};

/** Control characters that open and close an inline style. */
const MARK_OPEN: Record<string, string> = { '\x01': 'bold', '\x03': 'italic', '\x05': 'underline' };
const MARK_CLOSE: Record<string, string> = { '\x02': 'bold', '\x04': 'italic', '\x06': 'underline' };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function parseWriterDuet(data: ArrayBuffer): Promise<ArchiveImportResult> {
  const zip = await loadImportArchive(data, 'WriterDuet', 'wdz');
  const entry = findArchiveEntry(zip, /(^|\/)script\.json$/i) ?? findArchiveEntry(zip, /\.json$/i);
  if (!entry) {
    throw new Error(`Not a WriterDuet script: the file has no script.json${describeArchiveContents(zip)}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readArchiveText(entry));
  } catch (err) {
    throw new Error(
      `Not a valid WriterDuet file: ${entry.name} is not readable JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  return parseWriterDuetJson(parsed);
}

/** Read the `script.json` object itself. Exported for the tests. */
export function parseWriterDuetJson(parsed: unknown): ArchiveImportResult {
  if (!isObject(parsed)) {
    throw new Error('Not a valid WriterDuet file: script.json does not hold a script.');
  }

  let scriptLines: Json | null = null;
  let titleLines: Json | null = null;

  if (isObject(parsed.b)) {
    const branches = parsed.b;
    const main = selectScriptBranch(branches);
    if (main !== undefined) scriptLines = linesOf(replayBranch(main));
    if (branches[TITLE_BRANCH] !== undefined) titleLines = linesOf(replayBranch(branches[TITLE_BRANCH]));
  } else if (isObject(parsed.data)) {
    // Already a snapshot rather than a log.
    scriptLines = parsed.data;
  }

  if (!scriptLines) {
    throw new Error(
      'Not a valid WriterDuet file: script.json has no script in it. ' +
        'Export the script from WriterDuet as Final Draft (.fdx) or Fountain and import that instead.',
    );
  }

  const warnings: string[] = [];
  const unknownTypes = new Set<string>();
  const nodes: ImportNode[] = [];
  let pendingPageBreak = false;

  for (const line of orderedLines(scriptLines)) {
    const rawType = String(line.type);
    let type = LINE_TYPES[rawType.trim().toLowerCase()];
    if (!type) {
      if (rawType.trim().toLowerCase() === 'image') {
        warnings.push('Images in the WriterDuet script were not imported.');
        continue;
      }
      unknownTypes.add(rawType);
      type = 'action';
    }

    const node: ImportNode = { type, content: runsToContent(styledRuns(lineText(line))) };
    if (type === 'section') node.attrs = { level: 1 };
    if (line.pb || pendingPageBreak) {
      // A break before a note or section would land somewhere unprinted; keep
      // it for the next element that reaches the page.
      if (type === 'note' || type === 'section') {
        pendingPageBreak = true;
      } else {
        node.attrs = { ...node.attrs, startsNewPage: true };
        pendingPageBreak = false;
      }
    }
    nodes.push(node);
  }

  if (unknownTypes.size > 0) {
    warnings.push(`Unrecognised WriterDuet element types imported as Action: ${[...unknownTypes].join(', ')}.`);
  }

  const fields = titleLines ? titlePageFields(orderedLines(titleLines)) : {};
  const titlePage = buildTitlePageBlocks(fields) as ImportNode[];

  return {
    doc: {
      type: 'doc',
      content: [...titlePage, ...(nodes.length > 0 ? nodes : [{ type: 'action', content: [] }])],
    },
    title: typeof fields.tpTitle === 'string' ? fields.tpTitle.replace(/\s*\n\s*/g, ' ') : '',
    warnings: [...new Set(warnings)],
  };
}

// ── Operation-log replay ──────────────────────────────────────────────────

/** The script branch: `-` by convention, else the first live one that is not the title page. */
function selectScriptBranch(branches: Json): unknown {
  if (branches[MAIN_BRANCH] !== undefined) return branches[MAIN_BRANCH];
  for (const [key, branch] of Object.entries(branches)) {
    if (key === TITLE_BRANCH || !isObject(branch)) continue;
    const details = branch.details;
    if (isObject(details) && (details.removed || details.branchType === 'empty')) continue;
    if (isObject(branch.h)) return branch;
  }
  return undefined;
}

function decodeValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    // A bare string that was never JSON-encoded.
    return v;
  }
}

/** The object at `segs` under `root`, created on the way down. */
function objectAt(root: Json, segs: string[]): Json {
  let cur = root;
  for (const seg of segs) {
    if (!isObject(cur[seg])) cur[seg] = {};
    cur = cur[seg] as Json;
  }
  return cur;
}

function setAt(root: Json, segs: string[], value: unknown): void {
  if (segs.length === 0) return;
  const parent = objectAt(root, segs.slice(0, -1));
  const last = segs[segs.length - 1];
  if (value === null) delete parent[last];
  else parent[last] = value;
}

/** Replay a branch's operation log into the state it describes. */
function replayBranch(branch: unknown): Json {
  const state: Json = {};
  if (!isObject(branch) || !isObject(branch.h)) return state;
  const log = branch.h;

  // Firebase push ids sort chronologically.
  for (const key of Object.keys(log).sort()) {
    const op = log[key];
    if (!isObject(op)) continue;
    const value = decodeValue(op.v);
    const path = typeof op.l === 'string' ? op.l.replace(/^\/+|\/+$/g, '') : '';
    const segs = path ? path.split('/') : [];

    if (op.a === 's') {
      if (segs.length === 0) {
        for (const k of Object.keys(state)) delete state[k];
        if (isObject(value)) Object.assign(state, value);
      } else {
        setAt(state, segs, value);
      }
    } else if (op.a === 'u') {
      if (!isObject(value)) continue;
      const target = objectAt(state, segs);
      for (const [childKey, childValue] of Object.entries(value)) {
        if (childValue === null) delete target[childKey];
        else target[childKey] = childValue;
      }
    } else {
      setAt(state, segs, value);
    }
  }
  return state;
}

function linesOf(state: Json): Json | null {
  return isObject(state.data) ? state.data : null;
}

/** Live lines, in reading order. */
function orderedLines(lines: Json): Json[] {
  return Object.keys(lines)
    .sort()
    .map((id) => lines[id])
    .filter((line): line is Json => isObject(line) && typeof line.type === 'string' && !line.removed && !line.deleted);
}

// ── Text ──────────────────────────────────────────────────────────────────

/** A line's text with its style control characters still in it. */
function lineText(line: Json): string {
  if (typeof line.text === 'string') return line.text;

  const changes: unknown[][] = [];
  for (const field of [line.content, line['.c']]) {
    if (!isObject(field)) continue;
    for (const change of Object.values(field)) {
      if (Array.isArray(change)) changes.push(change);
    }
  }
  // Oldest first; the sort is stable, so ties keep their stored order.
  changes.sort((a, b) => (Number(a[2]) || 0) - (Number(b[2]) || 0));

  let text = '';
  for (const change of changes) {
    const ops = change[1];
    if (!Array.isArray(ops)) continue;
    for (const op of ops) {
      if (!Array.isArray(op) || !Array.isArray(op[1])) continue;
      const args = op[1] as unknown[];
      const pos = Math.min(Math.max(Number(args[2]) || 0, 0), text.length);
      if (op[0] === 'i' && typeof args[3] === 'string') {
        text = text.slice(0, pos) + args[3] + text.slice(pos);
      } else if (op[0] === 'd') {
        text = text.slice(0, pos) + text.slice(pos + (Number(args[3]) || 0));
      }
    }
  }
  return text;
}

/** Split text at its style control characters into marked runs. */
function styledRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const active = new Set<string>();
  let buffer = '';
  const flush = () => {
    if (buffer) runs.push({ text: buffer, marks: [...active] });
    buffer = '';
  };

  for (const ch of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    if (MARK_OPEN[ch]) {
      flush();
      active.add(MARK_OPEN[ch]);
    } else if (MARK_CLOSE[ch]) {
      flush();
      active.delete(MARK_CLOSE[ch]);
    } else if (ch === '\n' || ch >= ' ') {
      buffer += ch;
    }
    // Any other control character is WriterDuet bookkeeping, not text.
  }
  flush();

  // Trailing newlines would become stray hard breaks at the end of the block.
  const last = runs[runs.length - 1];
  if (last) last.text = last.text.replace(/\n+$/, '');
  return runs;
}

// ── Title page ────────────────────────────────────────────────────────────

const CREDIT_ONLY = /^(written|screenplay|story|teleplay|script|pilot)?\s*(by)$/i;
const CREDIT_WITH_NAME = /^((?:written|screenplay|story|teleplay|script)\s+by|by)\s+(.+)$/i;
const DRAFT = /\bdraft\b/i;
const DATE = /^(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4})$/i;
const COPYRIGHT = /©|\(c\)|\bcopyright\b/i;
const WGA = /\bWGA\b/i;

/**
 * WriterDuet's title page is free lines rather than fields, so the fields are
 * recovered by the conventions every title page follows: the title, then the
 * credit and the writer, then a draft, a date, a copyright and a contact
 * block. Anything that fits none of them lands in the contact block, which is
 * where the left-over lines of a title page almost always belong.
 */
function titlePageFields(lines: Json[]): TitlePageFields {
  const texts = lines
    .map((line) => ({ type: String(line.type).toLowerCase(), text: plainTextOf({ type: 'p', content: runsToContent(styledRuns(lineText(line))) }).trim() }))
    .filter((l) => l.text !== '');
  if (texts.length === 0) return {};

  const fields: TitlePageFields = {};
  let titleIndex = texts.findIndex((l) => l.type === 'title');
  if (titleIndex < 0) titleIndex = 0;
  fields.tpTitle = texts[titleIndex].text;

  const rest = texts.filter((_, i) => i !== titleIndex).map((l) => l.text);
  const contact: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const text = rest[i];
    const withName = CREDIT_WITH_NAME.exec(text);
    if (!fields.tpWrittenBy && CREDIT_ONLY.test(text) && i + 1 < rest.length) {
      fields.tpCredit = text;
      fields.tpWrittenBy = rest[++i];
    } else if (!fields.tpWrittenBy && withName) {
      fields.tpCredit = withName[1];
      fields.tpWrittenBy = withName[2];
    } else if (!fields.tpDraft && DRAFT.test(text)) {
      fields.tpDraft = text;
    } else if (!fields.tpDraftDate && DATE.test(text)) {
      fields.tpDraftDate = text;
    } else if (!fields.tpCopyright && COPYRIGHT.test(text)) {
      fields.tpCopyright = text;
    } else if (!fields.tpWgaRegistration && WGA.test(text)) {
      fields.tpWgaRegistration = text;
    } else {
      contact.push(text);
    }
  }
  if (contact.length > 0) fields.tpContact = contact.join('\n');
  return fields;
}

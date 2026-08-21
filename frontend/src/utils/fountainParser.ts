// Fountain markup format parser
// Spec: https://fountain.io/syntax
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
 * Fountain title-page keys, mapped to the attributes of OpenDraft's titlePage
 * node. These mirror what {@link exportFountain} writes.
 *
 * Without this the exporter's own output could not be read back: `Title:` and
 * `Author:` fell through to the default Action rule, so a script with a title
 * page reopened with two stray lines of Action at the top and no title page —
 * on every save of a `.fountain` opened in place.
 */
const TITLE_PAGE_KEYS: Record<string, string> = {
  title: 'tpTitle',
  credit: 'tpBasedOn',
  author: 'tpWrittenBy',
  authors: 'tpWrittenBy',
  'written by': 'tpWrittenBy',
  source: 'tpBasedOn',
  'draft date': 'tpDraftDate',
  contact: 'tpContact',
  copyright: 'tpCopyright',
  notes: 'tpNotes',
};

/**
 * Consume the title page, if the document opens with one.
 *
 * Per the spec it is `key: value` pairs at the very top, ending at the first
 * blank line, with indented continuation lines. Returns the line index to carry
 * on from, and the node if anything was found.
 */
function parseTitlePage(lines: string[]): { next: number; nodes: TipTapNode[] } {
  // A title page has to start on the first line and its first line has to be a
  // key. Anything else and this is an ordinary script.
  if (!/^[A-Za-z][A-Za-z ]*:/.test(lines[0] ?? '')) return { next: 0, nodes: [] };

  const attrs: Record<string, unknown> = { field: 'title' };
  let found = false;
  let i = 0;
  let currentKey: string | null = null;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { i++; break; }

    const m = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(line);
    if (m) {
      currentKey = TITLE_PAGE_KEYS[m[1].trim().toLowerCase()] ?? null;
      if (currentKey && m[2].trim() !== '') {
        attrs[currentKey] = m[2].trim();
        found = true;
      }
      continue;
    }
    // An indented continuation of the previous key — the spec allows the value
    // to run onto following lines.
    if (currentKey && /^\s+\S/.test(line)) {
      const prev = typeof attrs[currentKey] === 'string' ? `${attrs[currentKey]}\n` : '';
      attrs[currentKey] = `${prev}${line.trim()}`;
      found = true;
      continue;
    }
    // Not a key and not a continuation — this was never a title page.
    return { next: 0, nodes: [] };
  }

  if (!found) return { next: 0, nodes: [] };
  // Expanded into the laid-out run the paginator and exporters measure, rather
  // than the single attrs-only node this used to return — see titlePageBlocks.
  const blocks = buildTitlePageBlocks(attrs as TitlePageFields) as TipTapNode[];
  if (blocks.length === 0) return { next: 0, nodes: [] };
  return { next: i, nodes: blocks };
}

/**
 * Every separator a line of text can arrive with, other than the plain `\n`
 * this parser works in.
 *
 * Splitting on `\n` alone is only safe for text that was written to a file by
 * something that agrees on newlines. Text off a clipboard is not: pasting from
 * an iPad (and from older editors on any platform) can arrive with lone
 * carriage returns, and rich text converted to plain text carries Unicode's
 * own line (U+2028) and paragraph (U+2029) separators. None of those split,
 * so the whole paste stayed one line — and one line of a screenplay, whatever
 * it says, parses as a single Action block. That is what "Paste as Fountain
 * inserts everything as Action" looked like from the outside.
 */
const LINE_SEPARATORS = /\r\n?|\u2028|\u2029|\u0085/g;

/** Split text into lines, whichever separator convention it arrived with. */
function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').replace(LINE_SEPARATORS, '\n').split('\n');
}

/**
 * Is this text single-spaced — no blank line anywhere between its lines?
 *
 * Fountain marks a character cue with the blank line before it. Text that has
 * no blank lines anywhere never lost them in transit — it never had them: rich
 * text converted to plain text, and a script copied out of an app that lays
 * cues out by indentation rather than by spacing, both arrive single-spaced.
 * Read cues by their shape there, or every cue, parenthetical and line of
 * dialogue in the paste comes through as Action.
 *
 * Blank lines at the ends do not count. `split` leaves an empty last element
 * for the trailing newline that clipboard text almost always carries, and
 * counting that as a blank line turned this off for the most ordinary paste
 * there is — the whole point of the rule, defeated by one invisible character.
 */
function isSingleSpaced(lines: string[]): boolean {
  let first = 0;
  let last = lines.length - 1;
  while (first <= last && lines[first].trim() === '') first++;
  while (last >= first && lines[last].trim() === '') last--;
  if (last - first < 1) return false;
  return !lines.slice(first, last + 1).some((line) => line.trim() === '');
}

/** Scene heading by its opening: `INT.`, `EXT.`, `EST.`, `INT./EXT.`, `I/E.` */
function isSceneHeadingLine(trimmed: string): boolean {
  return /^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/.test(trimmed.toUpperCase());
}

/** Transition by its shape: all caps, ending in `TO:`. */
function isTransitionLine(trimmed: string): boolean {
  return /^[A-Z\s]+TO:$/.test(trimmed);
}

export function parseFountain(text: string): TipTapNode {
  const lines = splitLines(text);
  const singleSpaced = isSingleSpaced(lines);
  const nodes: TipTapNode[] = [];
  let i = 0;

  const titlePage = parseTitlePage(lines);
  if (titlePage.nodes.length > 0) {
    nodes.push(...titlePage.nodes);
    i = titlePage.next;
  }
  // A `===` page break applies to whatever element comes next.
  let pendingPageBreak = false;

  const push = (node: TipTapNode) => {
    if (pendingPageBreak) {
      node.attrs = { ...node.attrs, startsNewPage: true };
      pendingPageBreak = false;
    }
    nodes.push(node);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') {
      i++;
      continue;
    }

    // Page break: a line of three or more equals signs
    if (/^={3,}$/.test(trimmed)) {
      pendingPageBreak = true;
      i++;
      continue;
    }

    // Synopsis line: starts with = (must follow a scene heading)
    if (trimmed.startsWith('= ') && nodes.length > 0 && nodes[nodes.length - 1].type === 'sceneHeading') {
      const prev = nodes[nodes.length - 1];
      if (!prev.attrs) prev.attrs = {};
      prev.attrs.synopsis = trimmed.substring(2).trim();
      i++;
      continue;
    }

    // Forced action: line starts with !.  Checked before every other rule so
    // it can override the ALL-CAPS character and scene-heading heuristics.
    if (trimmed.startsWith('!')) {
      // Indentation after the `!` is content — this is how General and any
      // hand-aligned Action block carry their alignment through Fountain.
      push(makeNode('action', actionIndent(trimmed.substring(1))));
      i++;
      continue;
    }

    // Lyrics: line starts with ~
    if (trimmed.startsWith('~')) {
      push(makeNode('lyrics', trimmed.substring(1)));
      i++;
      continue;
    }

    // Forced scene heading: line starts with .
    if (trimmed.startsWith('.') && trimmed.length > 1 && trimmed[1] !== '.') {
      push(makeSceneHeading(trimmed.substring(1).trim()));
      i++;
      continue;
    }

    // Scene heading: starts with INT., EXT., EST., INT/EXT., I/E.
    if (isSceneHeadingLine(trimmed)) {
      push(makeSceneHeading(trimmed));
      i++;
      continue;
    }

    // Centered text: >text<
    if (trimmed.startsWith('>') && trimmed.endsWith('<') && trimmed.length > 1) {
      const centered = makeNode('action', trimmed.slice(1, -1).trim());
      centered.attrs = { ...centered.attrs, textAlign: 'center' };
      push(centered);
      i++;
      continue;
    }

    // Forced transition: line starts with >
    if (trimmed.startsWith('>')) {
      push(makeNode('transition', trimmed.substring(1).trim()));
      i++;
      continue;
    }

    // Transition: all caps ending with TO:
    if (isTransitionLine(trimmed)) {
      push(makeNode('transition', trimmed));
      i++;
      continue;
    }

    // Forced character: line starts with @
    if (trimmed.startsWith('@')) {
      let charName = trimmed.substring(1).trim();
      // Check for dual dialogue marker ^
      const isDual = charName.endsWith('^');
      if (isDual) charName = charName.replace(/\s*\^$/, '');
      const charNode = makeNode('character', charName);
      if (isDual) charNode.attrs = { ...charNode.attrs, dualDialogue: true };
      push(charNode);
      i++;
      i = collectDialogueBlock(lines, i, push, singleSpaced);
      continue;
    }

    // Character: all uppercase, preceded by an empty line, and followed by the
    // dialogue it introduces.
    if (isCharacterLine(trimmed.replace(/\s*\^$/, ''))
      // Single-spaced text has no blank line to go on, so shape is the whole
      // test — and it has to replace the blank-line rule rather than fall back
      // to it, because `isPrecededByEmptyLine` is true at the first line. That
      // exempted the opening line from the shape test, and most pasted scripts
      // open with `FADE IN:` — which became a cue with the scene heading under
      // it as its dialogue.
      && (singleSpaced ? looksLikeCue(trimmed) : isPrecededByEmptyLine(lines, i))
      && isFollowedByDialogue(lines, i, singleSpaced)) {
      let charName = trimmed;
      const isDual = charName.endsWith('^');
      if (isDual) charName = charName.replace(/\s*\^$/, '').trim();
      const charNode = makeNode('character', charName);
      if (isDual) charNode.attrs = { ...charNode.attrs, dualDialogue: true };
      push(charNode);
      i++;
      i = collectDialogueBlock(lines, i, push, singleSpaced);
      continue;
    }

    // Default: action — the one element that keeps the writer's indentation.
    push(makeNode('action', actionIndent(line)));
    i++;
  }

  // Post-process: merge dual dialogue pairs
  const merged = mergeDualDialogue(nodes);

  return {
    type: 'doc',
    content: merged.length > 0 ? merged : [makeNode('action', '')],
  };
}

// ── Inline emphasis ─────────────────────────────────────────────────────────

/**
 * Fountain escapes a delimiter with a backslash.  Swapping escaped delimiters
 * for control characters before matching keeps them out of the emphasis
 * regexes entirely; {@link restoreEscapes} puts the literal character back.
 */
const ESCAPE_SENTINELS: Record<string, string> = {
  '*': '\u0011',
  '_': '\u0012',
  '\\': '\u0013',
};
const SENTINEL_TO_CHAR: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPE_SENTINELS).map(([char, sentinel]) => [sentinel, char]),
);

function protectEscapes(text: string): string {
  return text.replace(/\\([*_\\])/g, (_, char: string) => ESCAPE_SENTINELS[char] ?? char);
}

// Built rather than written as a regex literal, so the sentinels are declared
// in exactly one place (and so control characters stay out of a literal).
const SENTINEL_PATTERN = new RegExp(`[${Object.values(ESCAPE_SENTINELS).join('')}]`, 'g');

function restoreEscapes(text: string): string {
  return text.replace(SENTINEL_PATTERN, (s) => SENTINEL_TO_CHAR[s] ?? s);
}

/**
 * Emphasis delimiters, most specific first.  Each pattern requires the run to
 * start and end on a non-space character, which is what keeps arithmetic
 * ("2 * 3") and unpaired delimiters from being read as markup.
 *
 * The trailing `??` on the optional tail matters.  A greedy `?` makes the engine
 * prefer a *longer* run, so `**A** and **B**` matched from the first `**` to the
 * last one and swallowed the middle delimiters as literal text.  Made lazy, the
 * shortest well-formed run wins and each pair closes where it should.
 */
const EMPHASIS_RULES: { re: RegExp; marks: string[] }[] = [
  { re: /\*\*\*(\S(?:[\s\S]*?\S)??)\*\*\*/, marks: ['bold', 'italic'] },
  { re: /\*\*(\S(?:[\s\S]*?\S)??)\*\*/, marks: ['bold'] },
  { re: /\*(\S(?:[\s\S]*?\S)??)\*/, marks: ['italic'] },
  { re: /_(\S(?:[\s\S]*?\S)??)_/, marks: ['underline'] },
];

/** Emit text (and hard breaks for embedded newlines) carrying `marks`. */
function pushText(text: string, marks: string[], out: TipTapNode[]): void {
  if (text === '') return;
  restoreEscapes(text)
    .split('\n')
    .forEach((segment, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (segment === '') return;
      const node: TipTapNode = { type: 'text', text: segment };
      if (marks.length > 0) node.marks = marks.map((type) => ({ type }));
      out.push(node);
    });
}

/**
 * Split text on the *leftmost* emphasis run, recursing into the run itself so
 * nested emphasis (`**bold *and italic* **`) keeps both marks.  Text with no
 * well-formed run is emitted verbatim, so stray asterisks survive as
 * characters rather than swallowing the rest of the line.
 *
 * Leftmost, not first-rule-that-matches: whichever delimiter *opens* first is
 * the outer one.  Taking the rules in order instead stranded the outer pair of
 * `_**bold**_` as two literal underscores, because the `**` rule was consulted
 * before the `_` rule even though its delimiter starts a character later.
 * Ties — `***x***`, where all three asterisk rules match at the same index —
 * go to the earlier rule, which is why they are listed longest-delimiter first.
 */
function splitEmphasis(text: string, marks: string[], out: TipTapNode[]): void {
  let best: { match: RegExpExecArray; marks: string[] } | null = null;
  for (const rule of EMPHASIS_RULES) {
    const match = rule.re.exec(text);
    if (!match) continue;
    if (!best || match.index < best.match.index) best = { match, marks: rule.marks };
  }
  if (!best) {
    pushText(text, marks, out);
    return;
  }
  const { match } = best;
  splitEmphasis(text.slice(0, match.index), marks, out);
  splitEmphasis(match[1], [...marks, ...best.marks], out);
  splitEmphasis(text.slice(match.index + match[0].length), marks, out);
}

/** Parse Fountain inline emphasis into marked text nodes. */
function parseInline(text: string): TipTapNode[] {
  const out: TipTapNode[] = [];
  splitEmphasis(protectEscapes(text), [], out);
  return out;
}

/**
 * Build a screenplay node from text.
 *
 * Multi-line text becomes one node with `hardBreak` nodes between the lines,
 * rather than a text node containing literal newlines — only the former
 * survives a round-trip through the exporters.
 *
 * Note this does not change how the parser *groups* lines into blocks; it only
 * handles text that already arrives with newlines in it. Fountain's "every
 * carriage return is intent" rule arguably means consecutive action lines
 * should become one node with breaks rather than N nodes, but changing the
 * grouping strategy would alter existing imports and is left alone here.
 */
function makeNode(type: string, text: string): TipTapNode {
  if (text === '') {
    return { type, content: [] };
  }
  return { type, content: parseInline(text) };
}

/**
 * Action is the one element whose indentation the spec preserves: "tabs and
 * spaces are retained in Action elements, allowing writers to indent a line.
 * Tabs are converted to four spaces."
 *
 * Every other rule matches on the trimmed line, because a scene heading or cue
 * is recognised by its text rather than its position. Only what actually
 * becomes Action comes through here, so deliberately aligned material — onscreen
 * records, archival entries, the General blocks this app writes as forced
 * Action — survives the round trip instead of being flattened to the margin.
 *
 * Trailing whitespace is dropped: it is never content, and the two-trailing-
 * spaces "intentional blank line" convention belongs to dialogue blocks, which
 * do not come through this path.
 */
function actionIndent(line: string): string {
  return line.replace(/\t/g, '    ').replace(/\s+$/, '');
}

/**
 * Split a trailing `#47#` scene number off a heading line.
 *
 * Fountain writes the number at the end of the heading wrapped in hashes, and
 * it belongs in the node's attribute rather than its text. Left in the text it
 * is re-emitted as literal characters and the exporter appends the attribute's
 * number as well, so the heading grows another `#47#` on every save.
 *
 * Per the spec the number is "any alphanumerics (plus dashes and periods)".
 */
function splitSceneNumber(text: string): { text: string; sceneNumber?: string } {
  const match = /^(.*?)\s*#([A-Za-z0-9\-.]+)#$/.exec(text);
  if (!match) return { text };
  return { text: match[1], sceneNumber: match[2] };
}

function makeSceneHeading(text: string): TipTapNode {
  const { text: heading, sceneNumber } = splitSceneNumber(text);
  const node = makeNode('sceneHeading', heading);
  if (sceneNumber) node.attrs = { ...node.attrs, sceneNumber };
  return node;
}

function isCharacterLine(line: string): boolean {
  // All uppercase, not empty, no lowercase letters
  const cleaned = line.replace(/\(.*\)/, '').trim();
  return cleaned.length > 0 && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
}

/**
 * Does an all-caps line look like a character cue rather than a line of
 * shouted Action?
 *
 * Only consulted for single-spaced text, where the blank line the spec uses to
 * tell the two apart is not available. A cue is a name: short, and not a
 * sentence, so the length cap and the trailing punctuation are what separate
 * `SAM` from `THE DOOR SLAMS SHUT.`
 */
const CUE_MAX_LENGTH = 45;

function looksLikeCue(line: string): boolean {
  const cleaned = line.replace(/\(.*\)/, '').replace(/\s*\^$/, '').trim();
  if (cleaned.length === 0 || cleaned.length > CUE_MAX_LENGTH) return false;
  return !/[.,!?;:—-]$/.test(cleaned);
}

/**
 * Does this line say outright that it is not dialogue?
 *
 * A scene heading, a transition or a forced element is unambiguous wherever it
 * lands: whatever came before it, it ends the block.
 */
function opensHardElement(trimmed: string): boolean {
  if (trimmed === '') return true;
  // Forced action, character, transition/centred text, and page break. `~`
  // (lyrics) is deliberately absent: lyrics belong inside a dialogue block.
  if (/^[!@>=]/.test(trimmed)) return true;
  // Forced scene heading — `.INT` and not an ellipsis.
  if (/^\.[^.]/.test(trimmed)) return true;
  return isSceneHeadingLine(trimmed) || isTransitionLine(trimmed);
}

/**
 * Does this line open an element of its own?
 *
 * The end of a dialogue block is normally the next blank line. Single-spaced
 * text has none, so the block has to end where the next element begins —
 * without this the first cue in a paste swallowed everything after it as
 * dialogue.
 */
function opensNewElement(lines: string[], index: number): boolean {
  const trimmed = (lines[index] ?? '').trim();
  if (opensHardElement(trimmed)) return true;
  return isCharacterLine(trimmed.replace(/\s*\^$/, ''))
    && looksLikeCue(trimmed)
    && isFollowedByText(lines, index);
}

function isPrecededByEmptyLine(lines: string[], index: number): boolean {
  if (index === 0) return true;
  return lines[index - 1].trim() === '';
}

/**
 * The other half of the spec's character rule: "A Character element is any line
 * entirely in uppercase, with one empty line before it **and without an empty
 * line after it**."
 *
 * Only the "before" half was checked, so any all-caps line standing on its own
 * became a cue — `FADE IN:` most visibly, which then made the paragraph under
 * it dialogue. A cue with nothing after it is not a cue; it is Action.
 */
function isFollowedByText(lines: string[], index: number): boolean {
  const next = lines[index + 1];
  return next !== undefined && next.trim() !== '';
}

/**
 * The cue's other half, for single-spaced text: is the line under it something
 * that can actually be its dialogue?
 *
 * A blank line answers this in ordinary Fountain. Single-spaced there is none,
 * so a scene heading under an all-caps line has to be what rules the line out
 * — otherwise a cue is emitted with a scene heading as its dialogue, or worse,
 * with nothing under it at all.
 */
function isFollowedByDialogue(lines: string[], index: number, singleSpaced: boolean): boolean {
  if (!isFollowedByText(lines, index)) return false;
  return !singleSpaced || !opensHardElement((lines[index + 1] ?? '').trim());
}

const DIALOGUE_TYPES = new Set(['character', 'dialogue', 'parenthetical']);

/**
 * Post-process: find character nodes marked with dualDialogue=true and merge
 * the previous dialogue group with the current one into a dualDialogue container.
 */
function mergeDualDialogue(nodes: TipTapNode[]): TipTapNode[] {
  const result: TipTapNode[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === 'character' && node.attrs?.dualDialogue) {
      // This character starts the right column — find the previous dialogue group for the left column
      // Remove dualDialogue marker from attrs
      delete node.attrs!.dualDialogue;
      if (Object.keys(node.attrs!).length === 0) delete (node as any).attrs;

      // Collect right column: this character + following dialogue/parenthetical
      const rightCol: TipTapNode[] = [node];
      for (let j = i + 1; j < nodes.length; j++) {
        if (DIALOGUE_TYPES.has(nodes[j].type) && nodes[j].type !== 'character') {
          rightCol.push(nodes[j]);
          i = j;
        } else {
          i = j - 1;
          break;
        }
      }

      // Find previous dialogue group in result (walk backwards to find character)
      const leftCol: TipTapNode[] = [];
      while (result.length > 0) {
        const last = result[result.length - 1];
        if (DIALOGUE_TYPES.has(last.type)) {
          leftCol.unshift(result.pop()!);
        } else {
          break;
        }
      }

      if (leftCol.length > 0) {
        result.push({
          type: 'dualDialogue',
          content: [
            { type: 'dualDialogueColumn', content: leftCol },
            { type: 'dualDialogueColumn', content: rightCol },
          ],
        });
      } else {
        // No previous dialogue group found — just add nodes normally
        result.push(...rightCol);
      }
    } else {
      result.push(node);
    }
  }

  return result;
}

function collectDialogueBlock(
  lines: string[],
  i: number,
  push: (node: TipTapNode) => void,
  singleSpaced = false,
): number {
  const first = i;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      break;
    }

    // The line straight after a cue is always its dialogue — a cue with
    // nothing under it was never treated as a cue. Past that, single-spaced
    // text ends the block at the next element rather than at a blank line.
    if (singleSpaced && i > first && opensNewElement(lines, i)) {
      break;
    }

    // Parenthetical
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
      push(makeNode('parenthetical', trimmed));
      i++;
      continue;
    }

    // Lyrics sung inside a dialogue block
    if (trimmed.startsWith('~')) {
      push(makeNode('lyrics', trimmed.substring(1)));
      i++;
      continue;
    }

    // Dialogue
    push(makeNode('dialogue', trimmed));
    i++;
  }
  return i;
}

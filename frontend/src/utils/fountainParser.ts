// Fountain markup format parser
// Spec: https://fountain.io/syntax

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

export function parseFountain(text: string): TipTapNode {
  const lines = text.split('\n');
  const nodes: TipTapNode[] = [];
  let i = 0;
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
      push(makeNode('action', trimmed.substring(1)));
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
      push(makeNode('sceneHeading', trimmed.substring(1).trim()));
      i++;
      continue;
    }

    // Scene heading: starts with INT., EXT., EST., INT/EXT., I/E.
    if (/^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/.test(trimmed.toUpperCase())) {
      push(makeNode('sceneHeading', trimmed));
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
    if (/^[A-Z\s]+TO:$/.test(trimmed)) {
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
      i = collectDialogueBlock(lines, i, push);
      continue;
    }

    // Character: all uppercase, preceded by empty line
    if (isCharacterLine(trimmed.replace(/\s*\^$/, '')) && isPrecededByEmptyLine(lines, i)) {
      let charName = trimmed;
      const isDual = charName.endsWith('^');
      if (isDual) charName = charName.replace(/\s*\^$/, '').trim();
      const charNode = makeNode('character', charName);
      if (isDual) charNode.attrs = { ...charNode.attrs, dualDialogue: true };
      push(charNode);
      i++;
      i = collectDialogueBlock(lines, i, push);
      continue;
    }

    // Default: action
    push(makeNode('action', trimmed));
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
 */
const EMPHASIS_RULES: { re: RegExp; marks: string[] }[] = [
  { re: /\*\*\*(\S(?:[\s\S]*?\S)?)\*\*\*/, marks: ['bold', 'italic'] },
  { re: /\*\*(\S(?:[\s\S]*?\S)?)\*\*/, marks: ['bold'] },
  { re: /\*(\S(?:[\s\S]*?\S)?)\*/, marks: ['italic'] },
  { re: /_(\S(?:[\s\S]*?\S)?)_/, marks: ['underline'] },
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
 * Split text on the first emphasis run found, recursing into the run itself so
 * nested emphasis (`**bold *and italic* **`) keeps both marks.  Text with no
 * well-formed run is emitted verbatim, so stray asterisks survive as
 * characters rather than swallowing the rest of the line.
 */
function splitEmphasis(text: string, marks: string[], out: TipTapNode[]): void {
  for (const rule of EMPHASIS_RULES) {
    const match = rule.re.exec(text);
    if (!match) continue;
    splitEmphasis(text.slice(0, match.index), marks, out);
    splitEmphasis(match[1], [...marks, ...rule.marks], out);
    splitEmphasis(text.slice(match.index + match[0].length), marks, out);
    return;
  }
  pushText(text, marks, out);
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

function isCharacterLine(line: string): boolean {
  // All uppercase, not empty, no lowercase letters
  const cleaned = line.replace(/\(.*\)/, '').trim();
  return cleaned.length > 0 && cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
}

function isPrecededByEmptyLine(lines: string[], index: number): boolean {
  if (index === 0) return true;
  return lines[index - 1].trim() === '';
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
): number {
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
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

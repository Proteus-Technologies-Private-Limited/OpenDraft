/**
 * Global character rename.
 *
 * Renaming a character is more than Find & Replace: every cue has to change
 * while keeping its extension — `SARAH (V.O.)` becomes `SAM (V.O.)`, not `SAM` —
 * and the name's appearances in action, dialogue and headings are only
 * *offered*, because a name like WILL or HOPE is also an ordinary word.
 *
 * The edit is made text node by text node in a single transaction, so it is one
 * undo step, keeps the marks already on the name (script notes, tags, revision
 * highlights, bold) and rides through collaboration like any other edit.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { characterKey } from '../utils/nodeText';

export interface RenameMatch {
  /** Document range of the matched name. */
  from: number;
  to: number;
  /** The text as it stands in the script. */
  text: string;
  /** What it becomes — the new name in the same case style. */
  replacement: string;
  /** A cue is always renamed; a mention is offered for review. */
  kind: 'cue' | 'mention';
  /** Node type of the block the match is in, e.g. `action`. */
  blockType: string;
  /** The block's text on one line, for showing the match in context. */
  context: string;
  /** Offset of the match inside `context`. */
  contextOffset: number;
}

export interface RenameMatches {
  cues: RenameMatch[];
  mentions: RenameMatch[];
  /** Cues of this character the name could not be located in (e.g. split by a line break). */
  skippedCues: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A whole-word, case-insensitive pattern for `name`. Spaces in the name match
 * any run of spaces, so `MARY  JANE` typed with two spaces still matches.
 */
function namePattern(name: string): RegExp {
  const words = name.trim().split(/\s+/).map(escapeRegExp);
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[ \\t]+')}(?![\\p{L}\\p{N}])`, 'giu');
}

function isAllCaps(s: string): boolean {
  return s === s.toUpperCase() && s !== s.toLowerCase();
}

function isAllLower(s: string): boolean {
  return s === s.toLowerCase() && s !== s.toUpperCase();
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function isTitleCase(s: string): boolean {
  return !isAllCaps(s) && s === titleCase(s);
}

/**
 * The new name written the way the old one was: SARAH → SAM, Sarah → Sam.
 * Anything else (mixed case like McKENZIE) takes the new name as typed.
 */
export function matchCase(found: string, replacement: string): string {
  if (isAllCaps(found)) return replacement.toUpperCase();
  if (isAllLower(found)) return replacement.toLowerCase();
  if (isTitleCase(found)) return titleCase(replacement);
  return replacement;
}

/**
 * A textblock's inline content as a string in which offset `i` sits at
 * document position `start + i`: every non-text inline node (a hard break, an
 * image, a footnote marker) stands in as one character per position it takes.
 */
function blockString(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += child.text ?? '';
    else out += child.type.name === 'hardBreak' ? '\n' : '￼'.repeat(child.nodeSize);
  });
  return out;
}

/** Ranges of `text` inside parentheses — a cue's extensions. */
function parenRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /\([^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * Every place the character named `oldName` would change if renamed to
 * `newName`. Cues are found by their canonical key, so `Sarah (cont'd)` is a
 * cue of SARAH; mentions are whole-word matches outside cues that are not
 * written all in lower case (so the name WILL does not take the verb "will").
 */
export function findCharacterRenameMatches(doc: PMNode, oldName: string, newName: string): RenameMatches {
  const oldKey = characterKey(oldName);
  const cues: RenameMatch[] = [];
  const mentions: RenameMatch[] = [];
  let skippedCues = 0;
  if (!oldKey || !newName.trim()) return { cues, mentions, skippedCues };
  const pattern = namePattern(oldKey);
  const target = newName.trim().replace(/\s+/g, ' ');

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const text = blockString(node);
    const context = text.replace(/[\n￼]/g, ' ');
    const isCue = node.type.name === 'character';
    if (isCue && characterKey(node.textContent) !== oldKey) return false;

    const parens = isCue ? parenRanges(text) : [];
    let foundCue = false;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const at = m.index;
      const end = at + m[0].length;
      if (isCue) {
        // The name is the part of the cue outside its extensions.
        if (parens.some(([a, b]) => at < b && end > a)) continue;
        cues.push({
          from: start + at, to: start + end, text: m[0], replacement: matchCase(m[0], target),
          kind: 'cue', blockType: node.type.name, context, contextOffset: at,
        });
        foundCue = true;
        break;
      }
      if (isAllLower(m[0])) continue;
      mentions.push({
        from: start + at, to: start + end, text: m[0], replacement: matchCase(m[0], target),
        kind: 'mention', blockType: node.type.name, context, contextOffset: at,
      });
    }
    if (isCue && !foundCue) skippedCues++;
    return false;
  });

  return { cues, mentions, skippedCues };
}

/**
 * Rewrites every match into `tr`, each keeping the marks of the text it
 * replaces. Returns how many were changed.
 */
export function applyCharacterRename(tr: Transaction, matches: RenameMatch[]): number {
  let changed = 0;
  const ordered = [...matches].sort((a, b) => a.from - b.from);
  for (const m of ordered) {
    if (m.text === m.replacement) continue;
    const from = tr.mapping.map(m.from);
    const to = tr.mapping.map(m.to, -1);
    if (from >= to) continue;
    const marks = tr.doc.nodeAt(from)?.marks ?? [];
    tr.replaceWith(from, to, tr.doc.type.schema.text(m.replacement, marks));
    changed++;
  }
  return changed;
}

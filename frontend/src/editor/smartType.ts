/**
 * SmartType: completion for the screenplay elements that name things.
 *
 * A scene heading, a character cue and a transition are all made of parts a
 * writer repeats from scene to scene: the INT./EXT. prefix, the location, the
 * time of day, the character's name, an extension like (V.O.), CUT TO:. Typing
 * them again (and getting the spelling slightly different each time) is the
 * most mechanical part of writing a screenplay.
 *
 * SmartType offers those parts as you type them, from two sources:
 *
 * - built-in lists, so the first scene is helped too (scene prefixes, times of
 *   day, character extensions and the standard transitions);
 * - what the script already uses, so a location or a character only has to be
 *   typed once.
 *
 * Everything here is pure: the editor collects the blocks, this module decides
 * what to offer. The same rules therefore apply in tests with no editor and no
 * DOM (see smartType.test.ts), and the popup can be any component.
 *
 * A suggestion is a replacement range inside the current block (`from`, a
 * character offset) and the items to put there. Only the end of the block is
 * ever completed: a caret in the middle of a word has no unambiguous end.
 */

import { parseHeading } from '../utils/scriptStatistics';
import { characterKey } from '../utils/nodeText';

/** Most suggestions offered at once, so the popup stays a glance. */
export const MAX_ITEMS = 12;

/** The scene-heading prefixes the industry uses. */
export const SCENE_PREFIXES: readonly string[] = [
  'INT. ', 'EXT. ', 'INT./EXT. ', 'EST. ', 'I/E. ',
];

/** Times of day offered after " - ", even in a script that never used one. */
export const TIMES_OF_DAY: readonly string[] = [
  'DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING',
  'DAWN', 'DUSK', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME TIME',
];

/** Parenthetical extensions a character cue can carry. */
export const CHARACTER_EXTENSIONS: readonly string[] = [
  '(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)",
];

/** Transitions offered in a transition block. */
export const TRANSITIONS: readonly string[] = [
  'CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:',
  'FADE TO:', 'FADE OUT.', 'FADE TO BLACK.', 'INTERCUT WITH:',
];

/**
 * What the script already contains, harvested once per edit instead of per
 * keystroke. Order is first-use order, which is the order writers expect.
 */
export interface ScriptIndex {
  characters: string[];
  locations: string[];
  times: string[];
  transitions: string[];
}

/** The smallest shape of a document block this module needs. */
export interface BlockLike {
  /** TipTap node name: `character`, `sceneHeading`, `transition`, ... */
  type: string;
  /** The block's plain text. */
  text: string;
}

/** A completion: replace `text.slice(from)` with one of `items`. */
export interface SmartTypeSuggestion {
  /** Character offset in the block where the replaced text starts. */
  from: number;
  items: string[];
}

export function emptyScriptIndex(): ScriptIndex {
  return { characters: [], locations: [], times: [], transitions: [] };
}

export type SmartTypeKeyAction = 'down' | 'up' | 'accept' | 'dismiss' | 'pass';

/** The smallest shape of a transaction the local-input check needs. */
export interface SmartTypeTransactionLike {
  docChanged: boolean;
  mapping: {
    maps: ReadonlyArray<{
      forEach: (callback: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void) => void;
    }>;
  };
  getMeta: (key: string) => unknown;
}

/**
 * Whether a transaction is the writer typing in the block the caret is in.
 *
 * `update` fires for far more than typing: a collaborator's Yjs update, undo,
 * and the auto-CONT'D pass all dispatch transactions. Opening the popup for
 * those means the writer's next Enter can accept a name they never asked for
 * (a remote edit in another cue would fill the popup here). Remote edits are
 * tagged `y-sync$` by y-prosemirror, undo carries `history$`, and the
 * programmatic passes set `addToHistory: false`; anything left must also
 * touch the current block, so a peer typing elsewhere is ignored.
 */
export function isLocalSmartTypeUpdate(
  transaction: SmartTypeTransactionLike,
  blockStart: number,
  blockEnd: number,
): boolean {
  if (!transaction.docChanged) return false;
  if (transaction.getMeta('y-sync$')) return false;
  if (transaction.getMeta('history$')) return false;
  if (transaction.getMeta('addToHistory') === false) return false;
  return transaction.mapping.maps.some((map) => {
    let touched = false;
    map.forEach((oldStart, oldEnd) => {
      if (oldStart <= blockEnd && oldEnd >= blockStart) touched = true;
    });
    return touched;
  });
}

/** Characters from scripts that go through an IME (CJK, kana, Hangul, Zhuyin). */
const NON_LATIN_INPUT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;

/**
 * Whether an active composition should keep the popup closed.
 *
 * A blanket `view.composing` check also suppressed Latin keyboards: Gboard
 * keeps each word in composition until a space or commit, so a one-word cue
 * ("MAR") never got a suggestion. The popup would only rewrite the text on
 * accept, which also ends the composition; non-Latin input is the case where
 * rewriting mid-composition is unsafe, so that is what is guarded.
 */
export function isNonLatinComposition(composing: boolean, text: string): boolean {
  return composing && NON_LATIN_INPUT.test(text);
}

/**
 * What a key does while the popup is open. A location or transition only
 * accepts Enter/Tab after the writer has stepped into the list with an arrow
 * key; a character cue accepts at once. Everything else goes to the editor.
 */
export function smartTypeKeyAction(
  requireNavigation: boolean,
  navigated: boolean,
  key: string,
): SmartTypeKeyAction {
  if (key === 'ArrowDown') return 'down';
  if (key === 'ArrowUp') return 'up';
  if (key === 'Escape') return 'dismiss';
  if (key === 'Enter' || key === 'Tab') {
    return requireNavigation && !navigated ? 'pass' : 'accept';
  }
  return 'pass';
}

/**
 * The row an arrow key moves to.
 *
 * Where Enter/Tab only accept after an arrow key (headings, transitions) no
 * row is highlighted until then, so the first Down lands on the first row and
 * the first Up on the last — Down then Enter takes the first suggestion, not
 * the second.
 */
export function smartTypeMove(
  selected: number,
  navigated: boolean,
  requireNavigation: boolean,
  direction: 'down' | 'up',
  count: number,
): number {
  if (count <= 0) return 0;
  if (requireNavigation && !navigated) return direction === 'down' ? 0 : count - 1;
  return direction === 'down'
    ? Math.min(selected + 1, count - 1)
    : Math.max(selected - 1, 0);
}

/** The smallest shape of a document node the collector needs. */
export interface BlockNodeLike {
  isTextblock: boolean;
  type: { name: string };
  textContent: string;
}

export interface BlockDocLike {
  descendants: (callback: (node: BlockNodeLike, pos: number) => boolean | void) => void;
}

/**
 * Every text block in the document, including the ones inside wrappers such as
 * dual dialogue columns and AV cells. `doc.forEach` only visits top-level
 * blocks, which is why a character who speaks only in dual dialogue used to be
 * missing from the index.
 *
 * `excludePos` leaves out the block being typed: pausing on "MARG" must not
 * offer "MARG" back from the unfinished line itself.
 */
export function collectScriptBlocks(doc: BlockDocLike, excludePos: number | null = null): BlockLike[] {
  const blocks: BlockLike[] = [];
  doc.descendants((node, pos) => {
    if (excludePos !== null && pos === excludePos) return false;
    if (node.isTextblock) {
      blocks.push({ type: node.type.name, text: node.textContent });
    }
    return true;
  });
  return blocks;
}

function pushUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

/**
 * Split a scene heading into its location and time.
 *
 * `parseHeading` (utils/scriptStatistics) is the app's one reader, and is used
 * for the location. It only knows the times of day in its own list, though;
 * a writer who uses "NOON" or "MAGIC HOUR" would have the whole slugline read
 * back as a location. Since SmartType should offer back whatever the script
 * actually uses, the time is taken from after the last " - " when there is
 * one, with any trailing "(1973)" / "[FLASHBACK]" notes removed.
 *
 * The trade-off: a sub-location with no time, "INT. HOUSE - KITCHEN", offers
 * KITCHEN as a time. There is no way to tell it from a custom time like NOON,
 * and the cost is only a stray completion, so custom times win.
 */
function splitHeading(raw: string): { location: string; time: string } {
  const text = raw.trim();
  const dash = text.lastIndexOf(' - ');
  if (dash < 0) {
    const { location, timeOfDay } = parseHeading(text);
    return { location, time: timeOfDay };
  }
  const { location } = parseHeading(text.slice(0, dash));
  const time = text.slice(dash + 3)
    .replace(/(\s*(?:\([^)]*\)|\[[^\]]*\]))*\s*$/, '')
    .trim()
    .toUpperCase();
  return { location, time };
}

/**
 * Collect characters, locations, times and transitions from the document, in
 * the order they first appear.
 */
export function buildScriptIndex(blocks: Iterable<BlockLike>): ScriptIndex {
  const index = emptyScriptIndex();
  for (const block of blocks) {
    if (block.type === 'character') {
      // `characterKey` drops the extension and normalises case, so
      // "MARGO (V.O.)" and "margo" are one character.
      pushUnique(index.characters, characterKey(block.text));
    } else if (block.type === 'sceneHeading') {
      const { location, time } = splitHeading(block.text);
      pushUnique(index.locations, location);
      pushUnique(index.times, time);
    } else if (block.type === 'transition') {
      pushUnique(index.transitions, block.text.trim().toUpperCase());
    }
  }
  return index;
}

/**
 * Candidates that start with what has been typed, case-insensitively, without
 * the exact match (nothing to complete) and without duplicates. The typed text
 * is never lower-cased in the document, so the comparison has to ignore case.
 */
function filter(candidates: readonly string[], typed: string): string[] {
  const needle = typed.toUpperCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const key = candidate.toUpperCase();
    if (key === needle || !key.startsWith(needle) || seen.has(key)) continue;
    out.push(candidate);
    seen.add(key);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function suggestion(from: number, items: string[]): SmartTypeSuggestion | null {
  return items.length > 0 ? { from, items } : null;
}

const SCENE_PREFIX_RE = /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?|EST\.?)\s+/i;

/**
 * What to offer for `text` with the caret at `caret`.
 *
 * `element` is the TipTap node name of the block. Elements SmartType does not
 * know (action, dialogue, ...) get nothing, so the caller can call this for
 * every block without deciding first.
 */
export function suggestSmartType(
  element: string,
  text: string,
  caret: number,
  index: ScriptIndex,
): SmartTypeSuggestion | null {
  // Completion only makes sense at the end of the block: replacing a range
  // around a caret in the middle would silently eat the words after it.
  if (caret !== text.length) return null;
  if (text.trim() === '') return null;

  if (element === 'character') {
    // After "(" the only thing that can follow is an extension.
    const open = text.lastIndexOf('(');
    if (open >= 0) return suggestion(open, filter(CHARACTER_EXTENSIONS, text.slice(open)));
    return suggestion(0, filter(index.characters, text));
  }

  if (element === 'sceneHeading') {
    // Times of day live after the last " - ".
    const dash = text.lastIndexOf(' - ');
    if (dash >= 0) {
      const from = dash + 3;
      return suggestion(from, filter([...TIMES_OF_DAY, ...index.times], text.slice(from)));
    }
    // Before a prefix is complete, offer prefixes. "INT." has no trailing
    // space yet, so the regex below does not match it and this branch runs.
    const prefix = SCENE_PREFIX_RE.exec(text);
    if (!prefix) return suggestion(0, filter(SCENE_PREFIXES, text));
    // The location is what follows "INT. " or "EXT. ".
    const from = prefix[0].length;
    return suggestion(from, filter(index.locations, text.slice(from)));
  }

  if (element === 'transition') {
    return suggestion(0, filter([...TRANSITIONS, ...index.transitions], text));
  }

  return null;
}

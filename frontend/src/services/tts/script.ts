/**
 * Turns a screenplay into the lines Table Read speaks (issue #131).
 *
 * Each {@link ReadLine} is one block of the script — a scene heading, a speech,
 * a parenthetical — with who reads it, the text shown in the live preview, the
 * text actually sent to the voice, and the document positions needed to
 * highlight it in the editor.
 *
 * The spoken text differs from the written text on purpose: "INT. KITCHEN -
 * NIGHT" is read "Interior. Kitchen. Night.", and capitalised names are put
 * in title case so a voice says "Sarah" rather than spelling S-A-R-A-H. Every
 * character of the spoken text maps back to the written text, so the word a
 * voice is saying can still be highlighted where the writer wrote it.
 *
 * Kept free of React and Tauri so it can be unit-tested in node.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import { characterKey, singleLine } from '../../utils/nodeText';

export type LineKind =
  | 'sceneHeading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'lyrics'
  | 'heading';

export interface ReadLine {
  index: number;
  kind: LineKind;
  /**
   * Character key (see characterKey) of the character speaking, for dialogue
   * and lyrics; null when the narrator reads the line. A parenthetical keeps
   * the speaker it belongs to for display, but is read by the narrator.
   */
  speaker: string | null;
  /** The character's cue as written ("JOHN (V.O.)"), for display. */
  cue: string | null;
  /**
   * For dialogue: the parenthetical just before it ("under her breath"), as
   * a delivery note for voices that take one. Kept whether or not
   * parentheticals are read aloud.
   */
  direction: string | null;
  /** The line as written, hard breaks turned into spaces. */
  text: string;
  /** What the voice is given. */
  spoken: string;
  /**
   * `map[i]` is the index in `text` of spoken character `i`; it has one extra
   * entry, `text.length`, so an end index maps too.
   */
  map: number[];
  /** Document position of each character of `text`, for highlighting a word. */
  positions: number[];
  /** Range of the whole block's content in the document. */
  from: number;
  to: number;
  /** Which scene the line belongs to; -1 before the first scene heading. */
  sceneIndex: number;
}

export interface BuildOptions {
  readSceneHeadings: boolean;
  readAction: boolean;
  readParentheticals: boolean;
  readTransitions: boolean;
  announceCharacters: boolean;
}

/** Containers whose contents are never read: title page, outline and notes, AV tables. */
const SKIPPED = new Set(['titlePage', 'note', 'section', 'castList', 'avBlock', 'screenplayImage']);

const HEADING_TYPES = new Set(['newAct', 'endOfAct', 'showEpisode']);
const NARRATION_TYPES = new Set(['action', 'general', 'shot', 'customElement']);

// ── Speakable text ──────────────────────────────────────────────────────────

/** Scene-heading prefixes and how a reader says them. Longest first. */
const SCENE_PREFIXES: [RegExp, string][] = [
  [/^(?:INT\.?\s*\/\s*EXT\.?|INT\.?\s*-\s*EXT\.?|I\s*\/\s*E\.?)(?=\s|$)/i, 'Interior, exterior.'],
  [/^(?:EXT\.?\s*\/\s*INT\.?|EXT\.?\s*-\s*INT\.?|E\s*\/\s*I\.?)(?=\s|$)/i, 'Exterior, interior.'],
  [/^INT\.?(?=\s|$)/i, 'Interior.'],
  [/^EXT\.?(?=\s|$)/i, 'Exterior.'],
  [/^EST\.?(?=\s|$)/i, 'Establishing.'],
];

/**
 * Capitalised words that are better spelled out than read as a word. Words
 * with no vowel at all (TV, NYPD, CCTV) are spelled out regardless.
 */
const ACRONYMS = new Set([
  'FBI', 'CIA', 'USA', 'UK', 'EU', 'UN', 'OK', 'ID', 'ER', 'ICU', 'CEO', 'CFO', 'DNA', 'GPS',
  'POV', 'VO', 'OS', 'OC', 'AI', 'IT', 'HQ', 'LA', 'NYC', 'ATM', 'IV', 'IOU', 'AKA', 'ASAP',
  'NASA', 'NATO', 'SWAT', 'UFO', 'USB', 'VIP', 'AM', 'PM', 'DA', 'EMT', 'ETA', 'CPR', 'MRI',
]);

function titleCase(word: string): string {
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/** Spoken form of one all-caps word, same length so the mapping stays 1:1. */
function speakWord(word: string): string {
  const bare = word.replace(/['’]/g, '');
  if (bare.length < 2) return word;
  if (ACRONYMS.has(bare)) return word;
  if (!/[AEIOUY]/.test(bare)) return word;
  return titleCase(word);
}

interface Piece {
  /** [start, end) in the written text */
  a: number;
  b: number;
  out: string;
}

/**
 * The spoken text for a line and its map back to the written text.
 * Exported for tests.
 */
export function speakable(text: string, kind: LineKind): { spoken: string; map: number[] } {
  const pieces: Piece[] = [];
  let i = 0;

  if (kind === 'sceneHeading') {
    // A leading scene number ("12 INT. …" or "12. INT. …") is not read.
    const num = /^\s*\d+[A-Z]?\.?\s+/.exec(text);
    if (num) {
      pieces.push({ a: 0, b: num[0].length, out: '' });
      i = num[0].length;
    }
    for (const [re, said] of SCENE_PREFIXES) {
      const m = re.exec(text.slice(i));
      if (m) {
        pieces.push({ a: i, b: i + m[0].length, out: said });
        i += m[0].length;
        break;
      }
    }
  }

  // Words in capitals, and dash separators in headings ("KITCHEN - NIGHT").
  const re = kind === 'sceneHeading' || kind === 'heading'
    ? /\s+[-–—]+\s+|[A-Z][A-Z'’]+(?![a-z])/g
    : /[A-Z][A-Z'’]+(?![a-z])/g;
  re.lastIndex = i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) pieces.push({ a: i, b: m.index, out: text.slice(i, m.index) });
    const token = m[0];
    const out = /^\s/.test(token) ? '. ' : speakWord(token);
    pieces.push({ a: m.index, b: m.index + token.length, out });
    i = m.index + token.length;
  }
  if (i < text.length) pieces.push({ a: i, b: text.length, out: text.slice(i) });

  let spoken = '';
  const map: number[] = [];
  for (const p of pieces) {
    const span = p.b - p.a;
    for (let k = 0; k < p.out.length; k++) {
      map.push(p.a + (p.out.length === span ? k : Math.floor((k * span) / p.out.length)));
    }
    spoken += p.out;
  }
  map.push(text.length);
  return { spoken, map };
}

// ── Walking the document ────────────────────────────────────────────────────

/** Text of a textblock with each character's document position. */
function blockText(node: PMNode, pos: number): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  const start = pos + 1;
  node.forEach((child, offset) => {
    if (child.isText) {
      const t = child.text || '';
      for (let k = 0; k < t.length; k++) positions.push(start + offset + k);
      text += t;
      return;
    }
    // Hard breaks (and any other inline leaf) read as a space.
    if (child.isLeaf) {
      positions.push(start + offset);
      text += ' ';
    }
  });
  return { text, positions };
}

/** Collapse whitespace while keeping positions aligned with the characters kept. */
function tidy(text: string, positions: number[]): { text: string; positions: number[] } {
  let out = '';
  const pos: number[] = [];
  let lastSpace = true; // drops leading whitespace
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (/\s/.test(ch)) {
      if (lastSpace) continue;
      out += ' ';
      pos.push(positions[k]);
      lastSpace = true;
    } else {
      out += ch;
      pos.push(positions[k]);
      lastSpace = false;
    }
  }
  if (out.endsWith(' ')) {
    out = out.slice(0, -1);
    pos.pop();
  }
  return { text: out, positions: pos };
}

/** Name a narrator says before a speech: "JOHN (V.O.)" → "John". */
function announcedName(cue: string): string {
  return characterKey(cue).replace(/[A-Z][A-Z'’]+/g, (w) => titleCase(w));
}

export function buildReadLines(doc: PMNode, opts: BuildOptions): ReadLine[] {
  const lines: ReadLine[] = [];
  let speaker: string | null = null;
  let cue: string | null = null;
  let direction: string | null = null;
  let sceneIndex = -1;

  const push = (
    kind: LineKind,
    node: PMNode,
    pos: number,
    who: string | null,
    cueText: string | null,
    override?: { spoken: string },
    note: string | null = null,
  ) => {
    const raw = blockText(node, pos);
    const { text, positions } = tidy(raw.text, raw.positions);
    if (!text.trim()) return;
    // An override says something other than what is written (a cue read as a
    // bare name), so its words map onto the written line proportionally.
    const { spoken, map } = override
      ? {
          spoken: override.spoken,
          map: [
            ...Array.from({ length: override.spoken.length }, (_, k) => Math.floor((k * text.length) / override.spoken.length)),
            text.length,
          ],
        }
      : speakable(text, kind);
    if (!spoken.trim()) return;
    lines.push({
      index: lines.length,
      kind,
      speaker: who,
      cue: cueText,
      direction: note,
      text,
      spoken,
      map,
      positions,
      from: pos + 1,
      to: pos + node.nodeSize - 1,
      sceneIndex,
    });
  };

  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (SKIPPED.has(type)) return false;
    if (!node.isTextblock) return true;

    if (type === 'sceneHeading') {
      sceneIndex++;
      speaker = null;
      cue = null;
      if (opts.readSceneHeadings) push('sceneHeading', node, pos, null, null);
    } else if (HEADING_TYPES.has(type)) {
      speaker = null;
      cue = null;
      if (opts.readSceneHeadings) push('heading', node, pos, null, null);
    } else if (type === 'character') {
      direction = null;
      cue = singleLine(node.textContent);
      speaker = characterKey(cue) || null;
      if (opts.announceCharacters && speaker) {
        const name = announcedName(cue);
        push('character', node, pos, null, cue, { spoken: `${name}.` });
      }
    } else if (type === 'dialogue' || type === 'lyrics') {
      push(type, node, pos, speaker, cue, undefined, direction);
      direction = null;
    } else if (type === 'parenthetical') {
      direction = singleLine(node.textContent).replace(/^\(\s*|\s*\)$/g, '') || null;
      if (opts.readParentheticals) push('parenthetical', node, pos, speaker, cue);
    } else if (type === 'transition') {
      speaker = null;
      cue = null;
      if (opts.readTransitions) push('transition', node, pos, null, null);
    } else if (NARRATION_TYPES.has(type)) {
      speaker = null;
      cue = null;
      if (opts.readAction) push('action', node, pos, null, null);
    }
    return false;
  });

  return lines;
}

/** Index of the first line at or after document position `pos`; 0 when there is none. */
export function lineIndexAt(lines: ReadLine[], pos: number): number {
  const hit = lines.findIndex((l) => l.to >= pos);
  return hit < 0 ? 0 : hit;
}

/** Map a [start, end) range in a line's spoken text to document positions. */
export function spokenRangeToDoc(line: ReadLine, start: number, end: number): { from: number; to: number } | null {
  if (!line.positions.length) return null;
  const s = line.map[Math.max(0, Math.min(start, line.map.length - 1))];
  const eIdx = Math.max(start + 1, Math.min(end, line.map.length - 1));
  let e = line.map[eIdx];
  if (e <= s) e = s + 1;
  const last = line.positions.length - 1;
  const from = line.positions[Math.min(s, last)];
  const to = line.positions[Math.min(e - 1, last)] + 1;
  return to > from ? { from, to } : null;
}

/** Map a [start, end) range in a line's spoken text to its written text. */
export function spokenRangeToText(line: ReadLine, start: number, end: number): { start: number; end: number } {
  const s = line.map[Math.max(0, Math.min(start, line.map.length - 1))];
  let e = line.map[Math.max(0, Math.min(end, line.map.length - 1))];
  if (e <= s) e = Math.min(line.text.length, s + 1);
  return { start: s, end: e };
}

/**
 * Word ranges of `text`, for engines that cannot report the word they are on.
 * Each word carries a weight close to how long it takes to say.
 */
export function wordRanges(text: string): { start: number; end: number; weight: number }[] {
  const out: { start: number; end: number; weight: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    // Punctuation at the end of a word is a pause.
    const pause = /[.!?]$/.test(word) ? 3 : /[,;:—–]$/.test(word) ? 1.5 : 0;
    out.push({ start: m.index, end: m.index + word.length, weight: word.replace(/[^\p{L}\p{N}]/gu, '').length + 1 + pause });
  }
  return out;
}

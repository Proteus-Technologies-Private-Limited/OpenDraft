/**
 * Dialogue Tuner — every line one character speaks, in script order, editable
 * in one place (View → Panels → Dialogue Tuner).
 *
 * Nothing is copied out: each line is read from the element it lives in, and
 * an edit is written back into that same element as the smallest change that
 * turns the old text into the new. So bold, script notes, tags and revision
 * marks on the untouched part of the line stay where they are, revision mode
 * marks the changed part like any typing, collaborators see an ordinary edit,
 * and Undo takes it back.
 */
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { characterKey, singleLine } from './nodeText';

/** Elements that belong to a speech after its cue. */
const SPEECH_TYPES = new Set(['dialogue', 'parenthetical', 'lyrics']);

/** Stand-in for an inline node that is not text or a line break (a footnote marker, an image). */
export const OBJECT_CHAR = '￼';

export interface TunerLine {
  /** Position of the element. */
  pos: number;
  type: string;
  /** The element's text; a line break is `\n`, any other inline object OBJECT_CHAR. */
  text: string;
}

export interface Speech {
  /** Position of the character cue. */
  cuePos: number;
  /** The cue as written, extensions included. */
  cue: string;
  /** Heading of the scene the speech is in, '' before the first one. */
  scene: string;
  /** 1-based scene number in script order, 0 before the first heading. */
  sceneIndex: number;
  lines: TunerLine[];
  /** The element just before the cue, for context — often the other side of the exchange. */
  before: { type: string; text: string; speaker: string } | null;
}

export interface Speaker {
  name: string;
  /** Number of speeches. */
  speeches: number;
}

/**
 * A textblock's inline content as text, one character per document position:
 * so offset `i` is position `start + i`, which is what lets an edit be
 * written back exactly.
 */
export function blockText(node: PMNode): string {
  let out = '';
  node.forEach((child) => {
    if (child.isText) out += child.text ?? '';
    else out += child.type.name === 'hardBreak' ? '\n' : OBJECT_CHAR.repeat(child.nodeSize);
  });
  return out;
}

interface Flat {
  node: PMNode;
  pos: number;
  /** The sibling list it is in — the script, or one column of dual dialogue. */
  parent: PMNode;
  index: number;
}

/** Every text element in order, with where it sits. */
function flatten(doc: PMNode): Flat[] {
  const out: Flat[] = [];
  doc.descendants((node, pos, parent, index) => {
    if (node.isTextblock) {
      out.push({ node, pos, parent: parent!, index });
      return false;
    }
    return true;
  });
  return out;
}

/** Speakers in the script, most speeches first, then by name. */
export function listSpeakers(doc: PMNode): Speaker[] {
  const counts = new Map<string, number>();
  doc.descendants((node) => {
    if (node.isTextblock) {
      if (node.type.name === 'character') {
        const key = characterKey(node.textContent);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return false;
    }
    return true;
  });
  return Array.from(counts, ([name, speeches]) => ({ name, speeches }))
    .sort((a, b) => b.speeches - a.speeches || a.name.localeCompare(b.name));
}

/** Every speech of `name` (any case, extensions ignored), in script order. */
export function collectSpeeches(doc: PMNode, name: string): Speech[] {
  const key = characterKey(name);
  const flat = flatten(doc);
  const speeches: Speech[] = [];
  let scene = '';
  let sceneIndex = 0;
  let lastCue = '';

  for (let i = 0; i < flat.length; i++) {
    const { node, pos, parent, index } = flat[i];
    const type = node.type.name;
    if (type === 'sceneHeading') {
      scene = singleLine(node.textContent);
      sceneIndex++;
      continue;
    }
    if (type !== 'character') continue;
    const cueKey = characterKey(node.textContent);
    const prevCue = lastCue;
    lastCue = cueKey;
    if (cueKey !== key) continue;

    const lines: TunerLine[] = [];
    for (let j = index + 1; j < parent.childCount; j++) {
      const sib = parent.child(j);
      if (!SPEECH_TYPES.has(sib.type.name)) break;
      const f = flat[i + lines.length + 1];
      if (!f || f.node !== sib) break;
      lines.push({ pos: f.pos, type: sib.type.name, text: blockText(sib) });
    }

    const prev = i > 0 ? flat[i - 1] : null;
    speeches.push({
      cuePos: pos,
      cue: singleLine(node.textContent),
      scene,
      sceneIndex,
      lines,
      before: prev && prev.node.textContent.trim()
        ? {
          type: prev.node.type.name,
          text: singleLine(prev.node.textContent),
          speaker: SPEECH_TYPES.has(prev.node.type.name) ? prevCue : '',
        }
        : null,
    });
  }
  return speeches;
}

/** The speaker of the cue, dialogue or parenthetical holding `pos`, or ''. */
export function speakerAt(doc: PMNode, pos: number): string {
  let speaker = '';
  for (const { node, pos: p } of flatten(doc)) {
    if (p > pos) break;
    if (node.type.name === 'character') speaker = characterKey(node.textContent);
    else if (!SPEECH_TYPES.has(node.type.name)) speaker = '';
  }
  return speaker;
}

function inline(schema: Schema, text: string, marks: readonly import('@tiptap/pm/model').Mark[]): PMNode[] {
  const out: PMNode[] = [];
  const clean = text.split(OBJECT_CHAR).join('');
  clean.split('\n').forEach((part, i) => {
    if (i > 0 && schema.nodes.hardBreak) out.push(schema.nodes.hardBreak.create());
    if (part) out.push(schema.text(part, marks));
  });
  return out;
}

/**
 * The transaction that changes the element at `pos` from `oldText` to
 * `newText`, touching only the part that differs. Null when nothing changes,
 * or when the element is no longer what the tuner showed — it was edited in
 * the script, or by a collaborator, after the tuner read it.
 */
export function editLineTransaction(
  state: EditorState,
  pos: number,
  oldText: string,
  newText: string,
): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || !node.isTextblock || blockText(node) !== oldText) return null;
  const next = newText.replace(/\r\n?/g, '\n');
  if (next === oldText) return null;

  let prefix = 0;
  const max = Math.min(oldText.length, next.length);
  while (prefix < max && oldText[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix
    && oldText[oldText.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix++;

  const start = pos + 1;
  const from = start + prefix;
  const to = start + oldText.length - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  // Typed text takes the marks of where it goes, as it would in the editor.
  const marks = state.doc.resolve(from).marks();
  const tr = state.tr;
  if (inserted) tr.replaceWith(from, to, inline(state.schema, inserted, marks));
  else tr.delete(from, to);
  return tr;
}

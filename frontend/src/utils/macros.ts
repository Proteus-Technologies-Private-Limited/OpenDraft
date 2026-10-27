/**
 * Macros — text a writer types often (CONTINUOUS, LATER, a recurring location,
 * a character with an extension), inserted with a shortcut or from
 * Edit → Insert Macro.
 *
 * A macro may name an element type. Then it is inserted as that element: an
 * empty line becomes it, otherwise a new one is added after the current line.
 * Without a type the text goes in at the caret, like typing it.
 *
 * Macros are the writer's own, not the script's, so they live in settings
 * (stores/settingsStore.ts) and travel between machines as a JSON file.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { parseShortcut } from './shortcuts';

export interface Macro {
  id: string;
  /** Shown in the Insert Macro menu. */
  name: string;
  /** What is inserted. A newline becomes a line break inside the element. */
  text: string;
  /** Element the text is inserted as, or '' to insert at the caret. */
  elementType: string;
  /** Shortcut spec in utils/shortcuts notation, or '' for none. */
  shortcut: string;
}

/** Format of an exported macros file. */
export const MACROS_FILE_FORMAT = 'opendraft-macros';
export const MACROS_FILE_VERSION = 1;

export const MAX_MACRO_NAME = 60;
export const MAX_MACRO_TEXT = 2000;

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMacro(partial: Partial<Macro> = {}): Macro {
  return normalizeMacro({ id: newId(), name: '', text: '', elementType: '', shortcut: '', ...partial })!;
}

/**
 * A macro as stored, or null when `raw` cannot be one. Lenient on purpose:
 * this reads hand-edited files and settings written by other versions.
 */
export function normalizeMacro(raw: unknown): Macro | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const text = str(r.text).replace(/\r\n?/g, '\n').slice(0, MAX_MACRO_TEXT);
  const name = str(r.name).replace(/\s+/g, ' ').trim().slice(0, MAX_MACRO_NAME);
  const shortcut = str(r.shortcut);
  return {
    id: str(r.id) || newId(),
    name,
    text,
    elementType: str(r.elementType),
    shortcut: shortcut && parseShortcut(shortcut) ? shortcut : '',
  };
}

export function normalizeMacros(raw: unknown): Macro[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Macro[] = [];
  for (const item of raw) {
    const m = normalizeMacro(item);
    if (!m) continue;
    if (seen.has(m.id)) m.id = newId();
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** The name a macro is listed under: its own, or its text when it has none. */
export function macroLabel(m: Macro): string {
  if (m.name) return m.name;
  const line = m.text.replace(/\s+/g, ' ').trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line || 'Untitled macro';
}

export function serializeMacros(macros: Macro[]): string {
  return JSON.stringify({
    format: MACROS_FILE_FORMAT,
    version: MACROS_FILE_VERSION,
    macros: macros.map(({ name, text, elementType, shortcut }) => ({ name, text, elementType, shortcut })),
  }, null, 2);
}

/**
 * Macros read from an exported file. Accepts the file format above or a bare
 * array. Throws with a message for the writer when the file is not macros.
 */
export function parseMacrosFile(json: string): Macro[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && (data as Record<string, unknown>).format === MACROS_FILE_FORMAT
      ? (data as Record<string, unknown>).macros
      : null;
  if (!Array.isArray(list)) throw new Error('This file does not contain OpenDraft macros.');
  return normalizeMacros(list).map((m) => ({ ...m, id: newId() })).filter((m) => m.text);
}

/**
 * `incoming` added to `existing`, skipping exact repeats. An imported shortcut
 * already taken by an existing macro is dropped, so an import never makes a
 * key ambiguous.
 */
export function mergeMacros(existing: Macro[], incoming: Macro[]): { macros: Macro[]; added: number } {
  const key = (m: Macro) => `${m.name}\u0000${m.text}\u0000${m.elementType}`;
  const have = new Set(existing.map(key));
  const keys = new Set(existing.map((m) => m.shortcut).filter(Boolean));
  const out = [...existing];
  let added = 0;
  for (const m of incoming) {
    if (have.has(key(m))) continue;
    const shortcut = m.shortcut && !keys.has(m.shortcut) ? m.shortcut : '';
    if (shortcut) keys.add(shortcut);
    out.push({ ...m, shortcut });
    have.add(key(m));
    added++;
  }
  return { macros: out, added };
}

/** Ids of macros whose shortcut is also used by another macro or by `reserved`. */
export function shortcutClashes(macros: Macro[], reserved: string[] = []): Set<string> {
  const count = new Map<string, number>();
  for (const s of reserved) if (s) count.set(s, (count.get(s) ?? 0) + 1);
  for (const m of macros) if (m.shortcut) count.set(m.shortcut, (count.get(m.shortcut) ?? 0) + 1);
  return new Set(macros.filter((m) => m.shortcut && (count.get(m.shortcut) ?? 0) > 1).map((m) => m.id));
}

/** Text as inline content: newlines become hard breaks where the schema has them. */
function inlineContent(schema: Schema, text: string): PMNode[] {
  const out: PMNode[] = [];
  const br = schema.nodes.hardBreak;
  text.split('\n').forEach((line, i) => {
    if (i > 0) out.push(br ? br.create() : schema.text(' '));
    if (line) out.push(schema.text(line));
  });
  return out;
}

/**
 * The transaction that inserts `macro` at the selection, or null when it
 * cannot go there (no text, an element type this script does not have, or a
 * caret outside a text element). The caret ends after the inserted text.
 */
export function macroTransaction(state: EditorState, macro: Macro): Transaction | null {
  if (!macro.text) return null;
  const { schema } = state;
  const { $from, $to } = state.selection;
  // Inside one text element only: a selection across elements is not a place to type.
  if (!$from.parent.isTextblock || !$from.sameParent($to)) return null;
  const content = inlineContent(schema, macro.text);
  const tr = state.tr;

  if (!macro.elementType) {
    tr.replaceWith($from.pos, $to.pos, content);
    const end = $from.pos + content.reduce((n, c) => n + c.nodeSize, 0);
    tr.setSelection(TextSelection.create(tr.doc, end));
    return tr.scrollIntoView();
  }

  const type = schema.nodes[macro.elementType];
  if (!type || !type.isTextblock) return null;
  const block = $from.parent;
  const blockStart = $from.before();
  if (block.content.size === 0) {
    // An empty line becomes the macro's element.
    const node = type.createAndFill(null, content);
    if (!node) return null;
    tr.replaceWith(blockStart, blockStart + block.nodeSize, node);
    tr.setSelection(TextSelection.create(tr.doc, blockStart + node.nodeSize - 1));
    return tr.scrollIntoView();
  }
  // Otherwise a new element after the current one, if it is allowed there.
  const after = $from.after();
  const $after = tr.doc.resolve(after);
  const node = type.createAndFill(null, content);
  if (!node || !$after.parent.canReplaceWith($after.index(), $after.index(), type)) return null;
  tr.insert(after, node);
  tr.setSelection(TextSelection.create(tr.doc, after + node.nodeSize - 1));
  return tr.scrollIntoView();
}

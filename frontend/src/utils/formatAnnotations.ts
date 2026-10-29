/**
 * Bookmarks and alternates in Final Draft, Fade In / OSF and Fountain files.
 *
 * Both live on the element as attributes (utils/bookmarks, editor/alternates),
 * so each exporter writes them beside the paragraph and each parser puts them
 * back on the element it reads. What each format can hold differs:
 *
 * Bookmarks have a native home in two of the three. Final Draft writes a
 * bookmark as `Bookmark="name"` on the `<Paragraph>` (seen in files from
 * Final Draft 8 onward), and the Open Screenplay Format spec gives every
 * `<para>` a `bookmark="name"` (OSF 2.0 and 4.0 sample documents — the same
 * attribute the title page uses for its reserved field names). Fountain has
 * none, so a bookmark goes in a note on the element's line, `[[Bookmark:
 * name]]`: not printed, shown in the margin of apps that show notes, and read
 * back as the bookmark it was — the way revision marks already travel
 * (utils/revisionExport).
 *
 * Alternates have no documented equivalent anywhere. Final Draft 12+ keeps alt
 * dialogue in an `<AltCollection>`, but how a paragraph refers into it is not
 * documented and no sample file shows it, so writing one would leave Final
 * Draft holding versions attached to nothing. Instead the versions ride on the
 * paragraph in an OpenDraft-only attribute — Final Draft and Fade In ignore an
 * attribute they do not know, the same way the AV export's `data-av-*`
 * attributes are ignored — so another application sees exactly the version in
 * use and OpenDraft gets every version back. Fountain writes each stored
 * version as a note, `[[Alternate 1/3: …]]`, which prints nowhere.
 *
 * Nothing here ever changes the text of an element: the version in use stays
 * the element's own text in every format.
 */
import type { JSONContent } from '@tiptap/core';
import { BOOKMARKABLE_TYPES, cleanBookmarkName } from './bookmarks';
import { ALTERNATE_TYPES, alternatesOf, versionIndex, type Alternate } from '../editor/alternates';
import { uuid } from './uuid';

const BOOKMARKABLE: ReadonlySet<string> = new Set(BOOKMARKABLE_TYPES);

/** The elements that can carry alternates, read when called so it follows the editor. */
const canHoldAlternates = (type: string | undefined): boolean =>
  !!type && (ALTERNATE_TYPES as readonly string[]).includes(type);

// ── Bookmarks ──────────────────────────────────────────────────────────────

/** The bookmark an element carries, as it is written to a file; null when none. */
export function bookmarkOf(node: JSONContent): string | null {
  if (!node.type || !BOOKMARKABLE.has(node.type)) return null;
  const raw = node.attrs?.bookmark;
  if (typeof raw !== 'string') return null;
  return cleanBookmarkName(raw) || null;
}

/** A bookmark name read from a file, for an element of `nodeType`; null when it cannot hold one. */
export function readBookmark(raw: string | null | undefined, nodeType: string): string | null {
  if (!raw || !BOOKMARKABLE.has(nodeType)) return null;
  return cleanBookmarkName(raw) || null;
}

// ── Alternates as an attribute (Final Draft, OSF) ──────────────────────────

/** Attribute names, in each format's own spelling. */
export const FDX_ALTERNATES_ATTR = 'data-od-alternates';
export const FDX_ALTERNATE_INDEX_ATTR = 'data-od-alternate-index';
export const OSF_ALTERNATES_ATTR = 'od_alternates';
export const OSF_ALTERNATE_INDEX_ATTR = 'od_alternate_index';

/** The stored versions of an element and which one is showing, or null when it has none. */
export function encodeAlternates(node: JSONContent): { json: string; index: number } | null {
  if (!canHoldAlternates(node.type)) return null;
  const holder = { attrs: (node.attrs ?? {}) as Record<string, unknown> };
  const stored = alternatesOf(holder);
  if (stored.length === 0) return null;
  return { json: JSON.stringify(stored), index: versionIndex(holder) };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Versions read back from a file. Anything that is not a version is dropped,
 * and a value that does not parse at all is reported and ignored — a damaged
 * attribute costs the alternates, never the import.
 */
export function decodeAlternates(
  json: string | null | undefined,
  indexRaw: string | null | undefined,
  nodeType: string,
  warnings?: string[],
): { alternates: Alternate[]; alternateIndex: number } | null {
  if (!json || !canHoldAlternates(nodeType)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const message = `Alternate versions on a ${nodeType} line could not be read and were left out`;
    console.warn(`[import] ${message}`, err);
    warnings?.push(message);
    return null;
  }
  const alternates = alternatesOf({ attrs: { alternates: parsed } })
    // Each version's content has to be a list of nodes; anything else could
    // not be shown when the writer steps to it.
    .filter((a) => a.content.every((c) => isObject(c) && typeof c.type === 'string'))
    .map((a) => ({ ...a, id: a.id || uuid() }));
  if (alternates.length === 0) return null;
  const n = Number(indexRaw);
  const alternateIndex = Number.isInteger(n) && n >= 0 && n <= alternates.length ? n : 0;
  return { alternates, alternateIndex };
}

/** Where a format keeps the bookmark and the versions on a paragraph element. */
interface ParagraphAttrNames {
  bookmark: string;
  alternates: string;
  alternateIndex: string;
}

const FDX_NAMES: ParagraphAttrNames = {
  bookmark: 'Bookmark', alternates: FDX_ALTERNATES_ATTR, alternateIndex: FDX_ALTERNATE_INDEX_ATTR,
};
const OSF_NAMES: ParagraphAttrNames = {
  bookmark: 'bookmark', alternates: OSF_ALTERNATES_ATTR, alternateIndex: OSF_ALTERNATE_INDEX_ATTR,
};

function paragraphAnnotations(
  el: Element,
  nodeType: string,
  names: ParagraphAttrNames,
  warnings?: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const bookmark = readBookmark(el.getAttribute(names.bookmark), nodeType);
  if (bookmark) out.bookmark = bookmark;
  const versions = decodeAlternates(
    el.getAttribute(names.alternates), el.getAttribute(names.alternateIndex), nodeType, warnings,
  );
  if (versions) Object.assign(out, versions);
  return out;
}

/** The bookmark and alternates on a Final Draft `<Paragraph>`, as element attributes. */
export function fdxParagraphAnnotations(el: Element, nodeType: string, warnings?: string[]): Record<string, unknown> {
  return paragraphAnnotations(el, nodeType, FDX_NAMES, warnings);
}

/** The bookmark and alternates on an OSF `<para>`, as element attributes. */
export function osfParagraphAnnotations(el: Element, nodeType: string, warnings?: string[]): Record<string, unknown> {
  return paragraphAnnotations(el, nodeType, OSF_NAMES, warnings);
}

// ── Fountain notes ─────────────────────────────────────────────────────────

/** Only lines of text: a Fountain note holds one line, not a run of elements. */
export const FOUNTAIN_ALTERNATE_TYPES: ReadonlySet<string> = new Set(['action', 'dialogue']);

/**
 * Text made safe to sit inside `[[ … ]]`. A bracket gets a backslash, so no
 * `[[` or `]]` can appear inside, and a space keeps an escaped closing bracket
 * from running into the note's own `]]`. {@link unescapeNoteText} undoes it.
 */
function escapeNoteText(text: string): string {
  const out = text.replace(/[\r\n]+/g, ' ').replace(/[[\]]/g, (c) => `\\${c}`);
  return out.endsWith(']') ? `${out} ` : out;
}

/** Undo {@link escapeNoteText}: only a backslash before a bracket was added by it. */
function unescapeNoteText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && (text[i + 1] === '[' || text[i + 1] === ']')) {
      out += text[i + 1];
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

/** The note that bookmarks a Fountain line, e.g. `[[Bookmark: Act two]]`. */
export function fountainBookmarkNote(name: string): string {
  return `[[Bookmark: ${escapeNoteText(name)}]]`;
}

/**
 * The notes holding an element's other versions, numbered as the writer sees
 * them: with version 2 of 3 in the script, `[[Alternate 1/3: …]]` and
 * `[[Alternate 3/3: …]]`. `render` turns a version's content into Fountain
 * text, emphasis and all.
 */
export function fountainAlternateNotes(
  node: JSONContent,
  render: (version: JSONContent) => string,
): string[] {
  if (!node.type || !FOUNTAIN_ALTERNATE_TYPES.has(node.type)) return [];
  const holder = { attrs: (node.attrs ?? {}) as Record<string, unknown> };
  const stored = alternatesOf(holder);
  if (stored.length === 0) return [];
  const total = stored.length + 1;
  const showing = versionIndex(holder);
  // The stored list runs from the version after the one showing, round.
  return stored
    .map((alt, k) => ({ number: ((showing + 1 + k) % total) + 1, alt }))
    .sort((a, b) => a.number - b.number)
    .map(({ number, alt }) => {
      const text = render({ type: node.type, content: alt.content }).trim();
      return `[[Alternate ${number}/${total}: ${escapeNoteText(text)}]]`;
    });
}

export type FountainAnnotation =
  | { kind: 'bookmark'; name: string }
  | { kind: 'alternate'; number: number; total: number; text: string };

/**
 * What a Fountain note records, when it is one OpenDraft wrote for a bookmark
 * or an alternate; null for an ordinary note. The body is the note without
 * its brackets.
 */
export function parseFountainAnnotation(body: string): FountainAnnotation | null {
  const trimmed = body.trim();
  const bookmark = /^Bookmark:\s*([\s\S]+)$/.exec(trimmed);
  if (bookmark) {
    const name = cleanBookmarkName(unescapeNoteText(bookmark[1]));
    return name ? { kind: 'bookmark', name } : null;
  }
  const alternate = /^Alternate (\d{1,3})\/(\d{1,3}):\s?([\s\S]*)$/.exec(trimmed);
  if (alternate) {
    const number = Number(alternate[1]);
    const total = Number(alternate[2]);
    if (total < 2 || number < 1 || number > total) return null;
    return { kind: 'alternate', number, total, text: unescapeNoteText(alternate[3]).trim() };
  }
  return null;
}

/**
 * Put an element's versions back together from its alternate notes. They
 * have to agree — one total, each number once, exactly one missing, which is
 * the version in the script — or null is returned and the caller keeps them
 * as the ordinary notes they then are.
 */
export function restoreFountainAlternates(
  found: Array<{ number: number; total: number; text: string }>,
  parseInline: (text: string) => JSONContent[],
): { alternates: Alternate[]; alternateIndex: number } | null {
  if (found.length === 0) return null;
  const total = found[0].total;
  if (found.length !== total - 1 || found.some((f) => f.total !== total)) return null;
  const byNumber = new Map<number, string>();
  for (const f of found) {
    if (byNumber.has(f.number)) return null;
    byNumber.set(f.number, f.text);
  }
  let showing = -1;
  for (let n = 1; n <= total; n++) if (!byNumber.has(n)) showing = n - 1;
  if (showing < 0) return null;
  const alternates: Alternate[] = [];
  for (let k = 1; k < total; k++) {
    const number = ((showing + k) % total) + 1;
    alternates.push({ id: uuid(), content: parseInline(byNumber.get(number) ?? '') });
  }
  return { alternates, alternateIndex: showing };
}

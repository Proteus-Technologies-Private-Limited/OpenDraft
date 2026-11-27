/**
 * Everything the Sidekick does with the script itself: capture a selection
 * (or something dragged out of it) with its formatting, find a task's text
 * again, put a kept excerpt back, and draw an excerpt as formatted text.
 *
 * Capture and lookup take an EditorState, not a view, so they are tested
 * against the real screenplay schema without a browser.
 */
import { DOMParser as PMDOMParser, DOMSerializer, Fragment, Slice, type Schema, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import type { Excerpt, SourceAnchor, TaskSource } from './model';

/** How much of a selection is kept, so one stray Select All cannot fill the script. */
export const MAX_EXCERPT_CHARS = 20_000;

export interface Capture {
  excerpt: Excerpt;
  source: TaskSource;
}

export const emptyExcerpt: Excerpt = { content: [], openStart: 0, openEnd: 0, text: '' };
export const unlinkedSource: TaskSource = { sceneHeading: null, sceneUid: null, sceneIndex: null, elementType: null, navigation: 'none' };

function textOf(slice: Slice): string {
  return slice.content.textBetween(0, slice.content.size, '\n\n', '\n').trim();
}

/** The scene (heading, uid, index) a document position sits in. */
export function sceneAt(doc: PMNode, pos: number): Pick<TaskSource, 'sceneHeading' | 'sceneUid' | 'sceneIndex'> {
  let heading: PMNode | null = null;
  let index = -1;
  doc.forEach((child, offset) => {
    if (offset > pos) return;
    if (child.type.name === 'sceneHeading') {
      heading = child;
      index += 1;
    }
  });
  const found = heading as PMNode | null;
  return {
    sceneHeading: found ? found.textContent.trim() || null : null,
    sceneUid: found && typeof found.attrs.sceneUid === 'string' && found.attrs.sceneUid ? found.attrs.sceneUid : null,
    sceneIndex: index >= 0 ? index : null,
  };
}

export function sourceAt(doc: PMNode, pos: number, navigation: 'selection' | 'cursor'): TaskSource {
  const scene = sceneRangeAt(doc, pos);
  const { text, positions } = indexText(doc, scene);
  const index = positions.indexOf(pos);
  return {
    ...sceneAt(doc, pos),
    elementType: doc.resolve(pos).parent.type.name,
    navigation,
    anchor: {
      offset: pos - scene.from,
      before: index < 0 ? '' : text.slice(Math.max(0, index - 32), index),
      after: index < 0 ? '' : text.slice(index, index + 32),
    },
  };
}

function excerptFromSlice(slice: Slice): Excerpt | null {
  const text = textOf(slice);
  if (!text) return null;
  if (text.length > MAX_EXCERPT_CHARS) {
    throw new Error(`That selection is too long to file (${text.length.toLocaleString()} characters; the limit is ${MAX_EXCERPT_CHARS.toLocaleString()}). Select a smaller part.`);
  }
  const json = slice.toJSON() as { content?: Excerpt['content']; openStart?: number; openEnd?: number } | null;
  return {
    content: json?.content ?? [],
    openStart: json?.openStart ?? 0,
    openEnd: json?.openEnd ?? 0,
    text,
  };
}

/** The current selection, with its formatting and where it is; null when nothing is selected. */
export function captureSelection(state: EditorState): Capture | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  // includeParents: a selection inside one element keeps that element (its
  // type and attributes) — as ProseMirror's own drag slice does — rather than
  // coming back as bare text.
  const excerpt = excerptFromSlice(state.doc.slice(from, to, true));
  if (!excerpt) return null;
  return {
    excerpt,
    source: sourceAt(state.doc, from, 'selection'),
  };
}

/** Delete a moved range and keep the caret at its start. */
export function moveSelection(state: EditorState, selection: Selection): Transaction {
  const tr = state.tr.setSelection(selection);
  // Deleting the exact range preserves the opening element when the cut starts
  // at its first character. The open slice can then rejoin it on insertion.
  if (selection instanceof TextSelection) tr.delete(selection.from, selection.to);
  else tr.deleteSelection();
  return tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(selection.from, -1))));
}

/** Read outside text through the screenplay schema, with plain text as a fallback. */
export function captureExternalDrop(schema: Schema, data: DataTransfer): Capture | null {
  const html = data.getData('text/html');
  if (html) {
    const slice = sliceFromHtml(schema, html);
    const excerpt = slice && excerptFromSlice(slice);
    if (excerpt) return { excerpt, source: unlinkedSource };
  }
  const text = data.getData('text/plain');
  if (text?.trim()) {
    const excerpt = excerptFromSlice(sliceFromText(schema, text));
    if (excerpt) return { excerpt, source: unlinkedSource };
  }
  return null;
}

/** HTML parsed in an inert template: nothing in it runs, loads or renders. */
function sliceFromHtml(schema: Schema, html: string): Slice | null {
  try {
    const template = document.createElement('template');
    template.innerHTML = html;
    return PMDOMParser.fromSchema(schema).parseSlice(template.content);
  } catch (err) {
    console.warn('[sidekick] could not read the dropped HTML; using its text', err);
    return null;
  }
}

function sliceFromText(schema: Schema, text: string): Slice {
  const action = schema.nodes.action ?? schema.topNodeType.contentMatch.defaultType;
  if (!action) return Slice.empty;
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return new Slice(Fragment.from(paragraphs.map((p) => action.create(null, schema.text(p)))), 0, 0);
}

// ── Finding a task in the script ──

export interface Located {
  from: number;
  to: number;
  /** True when the saved selection was found. Cursor targets are collapsed. */
  exact: boolean;
}

interface SceneRange {
  from: number;
  end: number;
}

function sceneRanges(doc: PMNode) {
  const heads: Array<{ from: number; node: PMNode }> = [];
  doc.forEach((node, from) => {
    if (node.type.name === 'sceneHeading') heads.push({ from, node });
  });
  return heads.map((head, i) => ({ ...head, end: heads[i + 1]?.from ?? doc.content.size }));
}

function sceneRangeAt(doc: PMNode, pos: number): SceneRange {
  const scenes = sceneRanges(doc);
  const next = scenes.findIndex((scene) => scene.from > pos);
  const previous = next < 0 ? scenes[scenes.length - 1] : scenes[next - 1];
  return previous ?? { from: 0, end: scenes[0]?.from ?? doc.content.size };
}

function findScene(doc: PMNode, source: TaskSource): SceneRange | null {
  const scenes = sceneRanges(doc);
  if (source.anchor && source.sceneIndex === null) return { from: 0, end: scenes[0]?.from ?? doc.content.size };
  const byUid = source.sceneUid ? scenes.find((scene) => scene.node.attrs.sceneUid === source.sceneUid) : undefined;
  if (byUid) return byUid;
  if (!source.sceneHeading) return null;
  const heading = source.sceneHeading.trim().toUpperCase();
  const matches = (scene: (typeof scenes)[number]) => scene.node.textContent.trim().toUpperCase() === heading;
  const indexed = source.sceneIndex === null ? undefined : scenes[source.sceneIndex];
  return indexed && matches(indexed) ? indexed : scenes.find(matches) ?? null;
}

/** Search text spans across inline marks, hard breaks and screenplay elements. */
function indexText(doc: PMNode, range: SceneRange = { from: 0, end: doc.content.size }) {
  const parts: string[] = [];
  const positions: number[] = [];
  let length = 0;
  let blockSeen = false;

  const append = (value: string, from: number, to: number) => {
    parts.push(value);
    for (let i = 0; i < value.length; i++) positions[length + i] = Math.min(from + i, to);
    length += value.length;
    positions[length] = to;
  };

  doc.nodesBetween(range.from, range.end, (node, pos) => {
    if (node.isTextblock || (node.isBlock && node.isLeaf)) {
      const start = node.isTextblock ? pos + 1 : pos;
      if (blockSeen) append('\n\n', positions[length], start);
      else positions[length] = start;
      blockSeen = true;
    }
    if (node.isText) append(node.text!, pos, pos + node.nodeSize);
    else if (node.isLeaf) append('\n', pos, pos + node.nodeSize);
  });
  return { text: parts.join(''), positions };
}

/** Find the insertion point again using its surrounding text, then its scene offset. */
function resolveAnchor(doc: PMNode, scene: SceneRange, anchor: SourceAnchor): number | null {
  if (scene.end <= scene.from) return null;
  const guess = Math.min(scene.from + anchor.offset, scene.end - 1);
  const { text, positions } = indexText(doc, scene);
  const atGuess = positions.indexOf(guess);
  if (atGuess >= 0 && text.slice(Math.max(0, atGuess - anchor.before.length), atGuess) === anchor.before &&
      text.slice(atGuess, atGuess + anchor.after.length) === anchor.after && doc.resolve(guess).parent.inlineContent) return guess;

  let best: { pos: number; score: number; distance: number } | undefined;
  for (let offset = 0; offset < positions.length; offset++) {
    const pos = positions[offset];
    const distance = Math.abs(pos - guess);
    let left = 0;
    while (left < anchor.before.length && anchor.before[anchor.before.length - 1 - left] === text[offset - 1 - left]) left++;
    let right = 0;
    while (right < anchor.after.length && anchor.after[right] === text[offset + right]) right++;
    const matched = left + right;
    const score = matched >= Math.min(4, anchor.before.length + anchor.after.length) ? matched + Math.min(left, right) : 0;
    if ((!best || score > best.score || (score === best.score && distance < best.distance)) && doc.resolve(pos).parent.inlineContent) {
      best = { pos, score, distance };
    }
  }
  return best?.pos ?? null;
}

export function hasScriptSource(excerpt: Excerpt, source: TaskSource): boolean {
  if (source.navigation) return source.navigation !== 'none';
  return Boolean(excerpt.text || source.sceneUid || source.sceneHeading);
}

export function locate(doc: PMNode, excerpt: Excerpt, source: TaskSource): Located | null {
  if (!hasScriptSource(excerpt, source)) return null;
  const scene = findScene(doc, source);
  const anchor = scene && source.anchor ? resolveAnchor(doc, scene, source.anchor) : null;
  if (source.navigation === 'cursor') return anchor === null ? null : { from: anchor, to: anchor, exact: false };

  // The slice retains whitespace around the selection and ignores changes to marks.
  let needle = excerpt.text;
  try {
    const raw = excerptSlice(doc.type.schema, excerpt).content;
    const text = raw.textBetween(0, raw.size, '\n\n', '\n');
    if (text.trim() === needle) needle = text;
  } catch {
    // Excerpts saved with another schema can still be found by their plain text.
  }

  if (needle) {
    const { text, positions } = indexText(doc);
    let best: (Located & { inScene: boolean; distance: number }) | undefined;
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
      const from = positions[at];
      const to = positions[at + needle.length];
      if (!doc.resolve(from).parent.inlineContent || !doc.resolve(to).parent.inlineContent ||
          doc.textBetween(from, to, '\n\n', '\n') !== needle) continue;
      const inScene = !!scene && from >= scene.from && from < scene.end;
      if (anchor !== null && !inScene) continue;
      const distance = anchor === null ? from : Math.abs(from - anchor);
      if (!best || (inScene && !best.inScene) || (inScene === best.inScene && distance < best.distance)) {
        best = { from, to, exact: true, inScene, distance };
      }
    }
    if (best) return { from: best.from, to: best.to, exact: true };
  }
  const fallback = anchor ?? (scene ? scene.from + 1 : null);
  return fallback === null ? null : { from: fallback, to: fallback, exact: false };
}

/** The nearest ancestor of `el` that scrolls vertically. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Scroll the active editor's page container, using coordinates after layout. */
export function scrollToPosition(editor: Editor, pos: number): void {
  if (editor.isDestroyed) return;
  const { view } = editor;
  const container = view.dom.closest<HTMLElement>('.editor-main') ?? scrollParent(view.dom);
  if (!container) return;
  const coords = view.coordsAtPos(Math.max(0, Math.min(pos, view.state.doc.content.size)), 1);
  const box = container.getBoundingClientRect();
  const target = container.scrollTop + coords.top - box.top - container.clientHeight / 3;
  container.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
}

function scrollToSelection(editor: Editor): void {
  const selection = editor.state.selection;
  const win = editor.view.dom.ownerDocument.defaultView ?? window;
  // Give the panel dismissal and page layout a frame before reading coordinates.
  win.requestAnimationFrame(() => win.requestAnimationFrame(() => {
    if (editor.isDestroyed || !editor.state.selection.eq(selection)) return;
    try {
      scrollToPosition(editor, selection.from);
    } catch (err) {
      console.warn('[sidekick] could not scroll to the task in the script', err);
    }
  }));
}

const highlightKey = new PluginKey<DecorationSet>('sidekickHighlight');
const dragMime = 'application/x-od-sidekick-drag';
const editorDrags = new WeakMap<Editor['view'], { token: string; state: EditorState }>();

export function draggedSelection(editor: Editor, data: DataTransfer): EditorState | null {
  const drag = editorDrags.get(editor.view);
  return drag && data.getData(dragMime) === drag.token ? drag.state : null;
}

export const sidekickScriptPlugin = new Plugin({
  key: highlightKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, decorations) {
      if (tr.getMeta(highlightKey) && !tr.selection.empty) {
        return DecorationSet.create(tr.doc, [Decoration.inline(tr.selection.from, tr.selection.to, { class: 'sk-script-selection' })]);
      }
      return tr.docChanged || tr.selectionSet ? DecorationSet.empty : decorations;
    },
  },
  props: { decorations: (state) => highlightKey.getState(state) },
  view(view) {
    const start = (event: DragEvent) => {
      const dragging = view.dragging as (typeof view.dragging & { node?: TextSelection });
      if (!event.dataTransfer || !dragging || dragging.node || view.state.selection.empty) return;
      const token = Math.random().toString(36).slice(2);
      event.dataTransfer.setData(dragMime, token);
      editorDrags.set(view, { token, state: view.state });
    };
    const end = () => editorDrags.delete(view);
    // ProseMirror writes the drag payload first. Tag it before it leaves the editor.
    view.dom.addEventListener('dragstart', start);
    view.dom.addEventListener('dragend', end);
    return {
      destroy() {
        end();
        view.dom.removeEventListener('dragstart', start);
        view.dom.removeEventListener('dragend', end);
      },
    };
  },
});

/** Select the copied range, or place a caret at the saved position. */
export function revealInScript(editor: Editor, excerpt: Excerpt, source: TaskSource, focus = true): Located | null {
  const { state, view } = editor;
  const found = locate(state.doc, excerpt, source);
  if (!found) return null;
  const selection = TextSelection.between(state.doc.resolve(found.from), state.doc.resolve(found.to));
  view.dispatch(state.tr.setSelection(selection).setMeta(highlightKey, !focus));
  if (focus) view.focus();
  scrollToSelection(editor);
  return found;
}

// ── Putting an excerpt back ──

/** The excerpt as a slice of this script's schema; throws if the schema cannot hold it. */
export function excerptSlice(schema: Schema, excerpt: Excerpt): Slice {
  return Slice.fromJSON(schema, { content: excerpt.content, openStart: excerpt.openStart, openEnd: excerpt.openEnd });
}

/**
 * Restore moved text into its original gap using the slice's open edges.
 * At other destinations insert whole screenplay elements below the selection.
 */
export function insertTransaction(state: EditorState, excerpt: Excerpt, source?: TaskSource): Transaction {
  const slice = excerptSlice(state.schema, excerpt);
  const { $to, empty } = state.selection;
  const at = $to.pos;
  if (empty && source?.navigation === 'cursor' && locate(state.doc, excerpt, source)?.from === at) {
    const { firstChild, lastChild } = slice.content;
    // Older cuts could remove the first element's opening entirely. Rebuild
    // it before rejoining the surviving end of the range.
    const needsOpening = slice.openStart === 1 && slice.openEnd === 1 && $to.depth > 0 && $to.parentOffset === 0 &&
      firstChild && !firstChild.sameMarkup($to.parent) && lastChild?.sameMarkup($to.parent);
    const tr = needsOpening
      ? state.tr.replace($to.before(), at, new Slice(slice.content, 0, slice.openEnd))
      : state.tr.replace(at, at, slice);
    if (!tr.docChanged) throw new Error('The text cannot be restored at this position.');
    const end = tr.mapping.map(at, 1);
    return tr.setSelection(TextSelection.between(tr.doc.resolve(at), tr.doc.resolve(end))).scrollIntoView();
  }

  const nodes = slice.content;
  const after = $to.depth >= 1 ? $to.after(1) : $to.pos;
  const index = state.doc.resolve(after).index();
  if (nodes.size > 0 && state.doc.canReplace(index, index, nodes)) {
    const tr = state.tr.insert(after, nodes);
    const end = after + nodes.size;
    const from = Math.min(after + 1, end);
    return tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(Math.max(from, end - 1)))).scrollIntoView();
  }
  return state.tr.replaceRange(at, at, slice).scrollIntoView();
}

/** Insert the excerpt (see insertTransaction) and return focus to the script. */
export function insertExcerpt(editor: Editor, excerpt: Excerpt, source: TaskSource): void {
  editor.view.dispatch(insertTransaction(editor.state, excerpt, source));
  editor.view.focus();
  scrollToSelection(editor);
}

// ── Drawing an excerpt ──

/**
 * The excerpt as DOM built by the script's own schema — the same markup the
 * editor draws (`data-type` per element, `<strong>`/`<em>`/`<u>` for marks).
 * Built from the schema, never from stored HTML, so nothing in a task can
 * inject markup. Null when the schema cannot read it (e.g. a type the script
 * no longer has); the caller shows the plain text.
 */
export function renderExcerpt(schema: Schema, excerpt: Excerpt): DocumentFragment | HTMLElement | null {
  try {
    const fragment = Fragment.fromJSON(schema, excerpt.content);
    return DOMSerializer.fromSchema(schema).serializeFragment(fragment);
  } catch (err) {
    console.warn('[sidekick] could not draw an excerpt with its formatting; showing its text', err);
    return null;
  }
}

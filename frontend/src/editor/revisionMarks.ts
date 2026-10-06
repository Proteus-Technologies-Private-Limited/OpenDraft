/**
 * Revision marks — what Revision Mode records, and the asterisks that show it.
 *
 * With Revision Mode on, every edit the writer makes is marked with the current
 * revision colour, so a production can see (and print) exactly what changed in
 * this draft. Two carriers, because neither alone covers every edit:
 *
 *  - a `revision` attribute on the `textStyle` mark, on text that was typed or
 *    pasted. Being on the text is what lets the PDF put an asterisk on each
 *    line that holds revised words, and FDX export put a RevisionID on each run;
 *  - the `revised` block attribute, for an edit that leaves no text to mark:
 *    a deletion, two lines joined or split, an element-type change.
 *
 * Why an attribute on `textStyle` and not a mark of its own: every version of
 * the app ever released knows `textStyle`, and ProseMirror drops attributes it
 * does not know. An older version — a collaborator who has not updated, the
 * App Store build still in review — opens a revised script and simply shows no
 * asterisks. A new mark type would make that same version refuse to open the
 * script at all ("There is no mark type revision in this schema").
 *
 * Both live in the document JSON, so they save, sync and export with it.
 *
 * Not every transaction is the writer revising. Left alone, and only mapped:
 * anything with addToHistory:false (pagination, scene renumbering, auto
 * CONT'D), undo/redo, remote collaborators' steps (y-sync), whole-document
 * loads, and anything tagged REVISION_SKIP_META.
 *
 * With Revision Mode off, newly inserted text is stripped of the attribute
 * instead: `textStyle` is inclusive, so text typed next to a revised run, or
 * pasted from one, would otherwise inherit it.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { Mapping } from '@tiptap/pm/transform';
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model';
import { isHistoryTransaction } from '@tiptap/pm/history';
import {
  REVISION_COLORS, latestRevision, revisionMarkFor, type RevisionSettings,
} from './revisionColors';

/** The mark that carries the revision, and the attribute it is carried in. */
export const REVISION_CARRIER = 'textStyle';
export const REVISION_ATTR = 'revision';
export const REVISED_ATTR = 'revised';

/** Set on a transaction to keep it out of revision marking entirely. */
export const REVISION_SKIP_META = 'revisionSkip';

/** y-prosemirror's sync plugin key, as `tr.getMeta` sees it. Named by string so
 *  this module does not pull in Yjs; `new PluginKey('y-sync')` keys as 'y-sync$'. */
const Y_SYNC_META = 'y-sync$';

export interface RevisionConfig {
  /** Revision Mode on. */
  enabled: boolean;
  /** The current revision colour name, e.g. "Blue". */
  color: string;
}

interface Range {
  from: number;
  to: number;
  /** The edit removed content here. */
  deleted: boolean;
}

interface PluginState {
  /** Ranges held back while an IME composition is in progress. */
  pending: Range[];
}

type Meta = { defer: Range[] } | { flushed: true };

export const revisionPluginKey = new PluginKey<PluginState>('revisionMarks');

// ── Reading and writing the attribute ───────────────────────────────────

function carrierType(state: { schema: EditorState['schema'] }): MarkType | undefined {
  const type = state.schema.marks[REVISION_CARRIER];
  return type && type.spec.attrs && REVISION_ATTR in type.spec.attrs ? type : undefined;
}

/** The revision colour a text node carries, or null. */
export function revisionOf(node: PMNode): string | null {
  for (const mark of node.marks) {
    if (mark.type.name === REVISION_CARRIER && mark.attrs[REVISION_ATTR]) return String(mark.attrs[REVISION_ATTR]);
  }
  return null;
}

/** True when every other attribute of a textStyle mark is empty. */
function onlyRevision(mark: Mark): boolean {
  return Object.entries(mark.attrs).every(([k, v]) => k === REVISION_ATTR || v === null || v === undefined || v === '');
}

/**
 * Set (or with `color` null, clear) the revision on every text node in
 * [from, to), keeping whatever colour, font or size the node's textStyle
 * already carries. A textStyle left holding nothing is removed outright, so a
 * cleared script is the same JSON it was before it was ever revised.
 */
function setRevision(tr: Transaction, type: MarkType, from: number, to: number, color: string | null): void {
  const edits: Array<{ from: number; to: number; existing: Mark | undefined }> = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const existing = node.marks.find((m) => m.type === type);
    const current = existing?.attrs[REVISION_ATTR] ?? null;
    if (current === color) return false;
    if (color === null && !existing) return false;
    edits.push({ from: Math.max(pos, from), to: Math.min(pos + node.nodeSize, to), existing });
    return false;
  });
  for (const e of edits) {
    if (color === null && e.existing && onlyRevision(e.existing)) {
      tr.removeMark(e.from, e.to, type);
    } else {
      tr.addMark(e.from, e.to, type.create({ ...(e.existing?.attrs ?? {}), [REVISION_ATTR]: color }));
    }
  }
}

// ── Which transactions are the writer revising ──────────────────────────

/** A ReplaceStep over the whole document: setContent on load, import, a
 *  template switch. Never a revision — but a paste is, even over everything. */
function isWholeDocReplace(tr: Transaction): boolean {
  const ui = tr.getMeta('uiEvent');
  if (ui === 'paste' || ui === 'drop') return false;
  const size = tr.before.content.size;
  return tr.steps.some((s) => s instanceof ReplaceStep && (s as ReplaceStep).from === 0 && (s as ReplaceStep).to === size);
}

export function isRevisableTransaction(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  if (tr.getMeta(REVISION_SKIP_META)) return false;
  if (tr.getMeta(revisionPluginKey)) return false;
  if (tr.getMeta('addToHistory') === false) return false;
  if (isHistoryTransaction(tr)) return false;
  const ySync = tr.getMeta(Y_SYNC_META) as { isChangeOrigin?: boolean } | undefined;
  if (ySync?.isChangeOrigin) return false;
  if (isWholeDocReplace(tr)) return false;
  return true;
}

// ── Collecting what changed ─────────────────────────────────────────────

function mapRange(r: Range, mapping: Mapping): Range {
  const from = mapping.map(r.from, -1);
  const to = mapping.map(r.to, 1);
  return { from: Math.min(from, to), to: Math.max(from, to), deleted: r.deleted };
}

/** Every range a transaction touched, in the transaction's final document. */
export function changedRanges(tr: Transaction): Range[] {
  const out: Range[] = [];
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1);
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      out.push(mapRange({ from: newStart, to: newEnd, deleted: oldEnd > oldStart }, rest));
    });
  });
  return out;
}

// ── Applying marks ──────────────────────────────────────────────────────

function hasText(doc: PMNode, from: number, to: number): boolean {
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (found) return false;
    if (node.isText) found = true;
    return !found;
  });
  return found;
}

/** The start of the textblock at (or just after) `pos`, or null. */
function textblockAt(doc: PMNode, pos: number): number | null {
  const size = doc.content.size;
  const atPos = pos >= 0 && pos < size ? doc.nodeAt(pos) : null;
  if (atPos?.isTextblock) return pos;
  for (const p of [pos, pos + 1]) {
    if (p < 0 || p > size) continue;
    const $p = doc.resolve(p);
    for (let d = $p.depth; d > 0; d--) {
      if ($p.node(d).isTextblock) return $p.before(d);
    }
  }
  return null;
}

function flagBlock(tr: Transaction, pos: number, color: string): void {
  const at = textblockAt(tr.doc, pos);
  if (at === null) return;
  const node = tr.doc.nodeAt(at);
  // Only block types that carry the attribute (not title page, sections, notes).
  if (!node || node.attrs[REVISED_ATTR] === undefined || node.attrs[REVISED_ATTR] === color) return;
  tr.setNodeAttribute(at, REVISED_ATTR, color);
}

/** Mark (or, with the mode off, unmark) the given ranges. Returns the steps
 *  as a transaction on `state`, which may be empty. */
export function applyRevisionRanges(state: EditorState, ranges: Range[], config: RevisionConfig): Transaction {
  const tr = state.tr;
  const type = carrierType(state);
  if (!type) return tr;
  const size = () => tr.doc.content.size;
  for (const raw of ranges) {
    const r = mapRange(raw, tr.mapping);
    const from = Math.max(0, Math.min(r.from, size()));
    const to = Math.max(0, Math.min(r.to, size()));
    if (to > from) {
      const text = hasText(tr.doc, from, to);
      if (config.enabled) {
        if (text) setRevision(tr, type, from, to, config.color);
        else flagBlock(tr, to, config.color);
      } else if (text) {
        setRevision(tr, type, from, to, null);
      }
    } else if (config.enabled && r.deleted) {
      flagBlock(tr, from, config.color);
    }
  }
  return tr;
}

/** Remove every revision mark and block flag — "Clear Revision Marks". */
export function clearRevisions(state: EditorState): Transaction {
  const tr = state.tr;
  const type = carrierType(state);
  if (type) setRevision(tr, type, 0, state.doc.content.size, null);
  state.doc.descendants((node, pos) => {
    if (node.attrs[REVISED_ATTR]) tr.setNodeAttribute(pos, REVISED_ATTR, null);
  });
  return tr.setMeta(REVISION_SKIP_META, true);
}

/** True when the document holds any revision mark or flag. */
export function hasRevisions(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.attrs[REVISED_ATTR] || (node.isText && revisionOf(node))) found = true;
    return !found;
  });
  return found;
}

// ── The asterisks ───────────────────────────────────────────────────────
//
// Final Draft puts an asterisk beside every line that holds revised text. Where
// a line ends is the browser's decision, so the lines are measured: each
// revised span's client rects (one per line it covers), plus the first line of
// each flagged block, drawn into a layer beside the text column. A CSS
// pseudo-element could only ever mark the line a run starts on, and it lands
// wherever the nearest positioned ancestor is — inside an AV cell, that was
// the next column.

export interface LineBox {
  top: number;
  height: number;
  /** The revision colour on this line — the latest round when it has several. */
  color?: string;
}

/** Collapse rects on the same line (two revised runs, a run split by bold). */
export function mergeLineBoxes(boxes: LineBox[], tolerance = 3): LineBox[] {
  const sorted = boxes.filter((b) => b.height > 0).sort((a, b) => a.top - b.top);
  const out: LineBox[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(b.top - last.top) <= tolerance) {
      last.height = Math.max(last.height, b.height);
      const color = latestRevision([last.color, b.color]);
      if (color) last.color = color;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

/** A CSS string literal for `content:`. */
const cssString = (s: string) => JSON.stringify(s);

class RevisionGutter {
  private layer: HTMLDivElement;
  private frame = 0;
  private observer: ResizeObserver | null = null;
  private view: EditorView;
  private getSettings: () => RevisionSettings | null;
  private appliedMarks = '';

  constructor(view: EditorView, getSettings: () => RevisionSettings | null) {
    this.view = view;
    this.getSettings = getSettings;
    this.layer = document.createElement('div');
    this.layer.className = 'rev-gutter';
    this.layer.setAttribute('aria-hidden', 'true');
    // Beside the editor's DOM. TipTap builds the view inside a scratch element
    // and then moves its children into <EditorContent>, so the layer travels
    // with view.dom — which is why the host is looked up at measure time
    // rather than remembered here.
    view.dom.parentElement?.appendChild(this.layer);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(view.dom);
    }
    this.schedule();
  }

  schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      try {
        this.measure();
      } catch (err) {
        console.warn('[revisions] could not place revision asterisks', err);
      }
    });
  }

  private measure(): void {
    const { view, layer } = this;
    if (view.isDestroyed) return;
    // Re-attach if something replaced the editor's container.
    if (layer.parentElement !== view.dom.parentElement) view.dom.parentElement?.appendChild(layer);
    const host = layer.parentElement;
    if (!host || !host.isConnected) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const settings = this.getSettings();
    this.applyPrintMarks(settings);
    const spans = view.dom.querySelectorAll<HTMLElement>('.rev-mark');
    const flagged = view.dom.querySelectorAll<HTMLElement>('[data-revised]');
    if (spans.length === 0 && flagged.length === 0) {
      if (layer.childElementCount) layer.replaceChildren();
      return;
    }
    const hostRect = host.getBoundingClientRect();
    // The page may be zoomed with a transform; rects come back scaled.
    const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
    const toLocal = (top: number, height: number, color: string | undefined): LineBox => ({
      top: (top - hostRect.top) / scale,
      height: height / scale,
      ...(color ? { color } : {}),
    });

    const boxes: LineBox[] = [];
    spans.forEach((span) => {
      const color = span.getAttribute('data-rev-color') ?? undefined;
      for (const r of Array.from(span.getClientRects())) {
        if (r.height > 0) boxes.push(toLocal(r.top, r.height, color));
      }
    });
    flagged.forEach((block) => {
      const color = block.getAttribute('data-revised') ?? undefined;
      try {
        const pos = view.posAtDOM(block, 0);
        const c = view.coordsAtPos(pos);
        boxes.push(toLocal(c.top, c.bottom - c.top, color));
      } catch {
        const r = block.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(block).lineHeight) || 16;
        boxes.push(toLocal(r.top, lh * scale, color));
      }
    });

    // Into the right margin, past where the right scene number sits — but
    // never nearer the paper's edge than the PDF puts it, whatever margin
    // Page Setup gave the script.
    const CSS_INCH = 96;
    const domRect = view.dom.getBoundingClientRect();
    const textRight = (domRect.right - hostRect.left) / scale;
    const page = view.dom.closest('.page');
    const paperRight = page ? (page.getBoundingClientRect().right - hostRect.left) / scale : Infinity;
    const x = Math.min(textRight + 0.6 * CSS_INCH, paperRight - 0.35 * CSS_INCH);
    const stars = mergeLineBoxes(boxes).map((b) => {
      const el = document.createElement('span');
      el.className = 'rev-star';
      el.textContent = revisionMarkFor(settings, b.color);
      el.style.top = `${b.top}px`;
      el.style.height = `${b.height}px`;
      el.style.lineHeight = `${b.height}px`;
      el.style.left = `${x}px`;
      return el;
    });
    layer.replaceChildren(...stars);
  }

  /**
   * The browser's own print lays the script out afresh and draws each
   * revised run's mark with CSS (screenplay.css, `@media print`). Hand it the
   * writer's marks as custom properties, one per colour.
   */
  private applyPrintMarks(settings: RevisionSettings | null): void {
    const key = settings ? JSON.stringify([settings.markChar, settings.marks]) : '';
    if (key === this.appliedMarks) return;
    this.appliedMarks = key;
    const style = this.view.dom.style;
    style.setProperty('--rev-mark', cssString(revisionMarkFor(settings, null)));
    for (const c of REVISION_COLORS) {
      style.setProperty(`--rev-mark-${c.slug}`, cssString(revisionMarkFor(settings, c.name)));
    }
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.layer.remove();
  }
}

// ── The plugin ──────────────────────────────────────────────────────────

/**
 * @param getConfig read on every transaction; null disables marking (history
 *   view, a read-only editor) while still drawing what is there.
 * @param getSettings the marks to draw (a custom character, one per revision);
 *   null draws the default asterisk.
 */
export function revisionMarksPlugin(
  getConfig: () => RevisionConfig | null,
  getSettings: () => RevisionSettings | null = () => null,
): Plugin<PluginState> {
  let view: EditorView | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  return new Plugin<PluginState>({
    key: revisionPluginKey,

    state: {
      init: () => ({ pending: [] }),
      apply(tr, value) {
        const meta = tr.getMeta(revisionPluginKey) as Meta | undefined;
        let pending = tr.docChanged ? value.pending.map((r) => mapRange(r, tr.mapping)) : value.pending;
        if (meta && 'defer' in meta) pending = pending.concat(meta.defer);
        if (meta && 'flushed' in meta) pending = [];
        return pending === value.pending ? value : { pending };
      },
    },

    appendTransaction(trs, _oldState, newState) {
      const config = getConfig();
      let ranges: Range[] = [];
      for (const tr of trs) {
        if (tr.docChanged) ranges = ranges.map((r) => mapRange(r, tr.mapping));
        if (isRevisableTransaction(tr)) ranges.push(...changedRanges(tr));
      }
      if (!config) return null;

      // Marking text mid-composition re-renders the very DOM the IME is
      // writing into, which breaks dictation and predictive text on iPad.
      // Hold the ranges and apply them once the composition ends.
      if (view?.composing) {
        return ranges.length > 0
          ? newState.tr.setMeta(revisionPluginKey, { defer: ranges } satisfies Meta).setMeta('addToHistory', false)
          : null;
      }

      const pending = revisionPluginKey.getState(newState)?.pending ?? [];
      const all = pending.concat(ranges);
      if (all.length === 0) return null;
      const tr = applyRevisionRanges(newState, all, config);
      if (pending.length > 0) tr.setMeta(revisionPluginKey, { flushed: true } satisfies Meta);
      return tr.docChanged || pending.length > 0 ? tr : null;
    },

    view(editorView) {
      view = editorView;
      const gutter = typeof document !== 'undefined' ? new RevisionGutter(editorView, getSettings) : null;
      return {
        // Any update can move a line: an edit, a page break the pagination
        // plugin adds, a template or zoom change. Measuring is batched to one
        // per frame and skipped outright for a script with no revisions.
        update() { gutter?.schedule(); },
        destroy() {
          view = null;
          if (flushTimer) clearTimeout(flushTimer);
          gutter?.destroy();
        },
      };
    },

    props: {
      handleDOMEvents: {
        compositionend(editorView) {
          // ProseMirror finishes reading the composition shortly after this
          // event; flush once it has.
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(() => {
            flushTimer = null;
            if (editorView.isDestroyed || editorView.composing) return;
            if ((revisionPluginKey.getState(editorView.state)?.pending.length ?? 0) === 0) return;
            editorView.dispatch(editorView.state.tr.setMeta('addToHistory', false));
          }, 50);
          return false;
        },
      },
    },
  });
}

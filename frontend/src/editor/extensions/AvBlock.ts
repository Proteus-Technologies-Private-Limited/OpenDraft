/**
 * Two-column AV (Audio | Video) script support.
 *
 * Schema:
 *   avBlock         group=block, content=`avRow+`, isolating
 *     avRow         content=`avCell avCell`, isolating, defining
 *       avCell      attrs={ side: 'video' | 'audio' }, content=`(avPara | avShot | avDirection)+`
 *         avPara, avShot, avDirection — text-containing paragraphs
 *
 * Why a single avBlock wrapper instead of free-standing avRows: lets pagination,
 * toolbar, and right-click menu identify the AV body as a unit, mirroring how
 * `dualDialogue` (in DualDialogue.ts) wraps two columns.
 *
 * Editor UX:
 *   Tab          — move between cells; at end of right cell → new row, cursor in left cell
 *   Shift-Tab    — reverse of Tab
 *   Enter        — split paragraph in current cell only
 *   Mod-Enter    — insert new row below
 *   Backspace    — at empty cell with empty sibling, delete the row (& the block if last)
 *   Mod-Shift-A  — toggle: wrap current cursor block into a new avBlock (and back out)
 *
 * Every one of those needs a hardware keyboard, which an iPhone or iPad does
 * not have: there is no Tab on the software keyboard and no Mod-Enter, so row
 * creation was unreachable on touch (issue #116). The commands below are
 * therefore the only implementation — the keymap is one caller of them, and the
 * toolbar, the right-click/long-press menu and the Format menu are the others.
 * `isInAvCell` is exported for those callers to gate their controls on.
 */

import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { AvRowView } from './AvRowView';
import { isBlankBlock, previousSiblingBlock, blankLineTypeFor } from '../blankLine';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { computeRowTimings } from '../avTiming';

/** Where `insertAvRow` puts the new row, relative to the one holding the cursor. */
export type AvRowPlacement = 'above' | 'below';

/**
 * Depths of the avRow and avBlock enclosing the cursor, or null when the
 * selection is not inside an AV body. Shared by the commands and by every
 * caller that has to decide whether to offer an AV row control at all.
 */
export function avRowContext(
  state: import('@tiptap/pm/state').EditorState,
): { rowDepth: number; blockDepth: number } | null {
  const { $from } = state.selection;
  let rowDepth = -1;
  let blockDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'avRow' && rowDepth < 0) rowDepth = d;
    if (name === 'avBlock' && blockDepth < 0) blockDepth = d;
  }
  return rowDepth < 0 || blockDepth < 0 ? null : { rowDepth, blockDepth };
}

/** True when `$pos` sits inside an AV cell. */
export function isAvCellPos($pos: import('@tiptap/pm/model').ResolvedPos): boolean {
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === 'avCell') return true;
  }
  return false;
}

/** True when the cursor sits inside an AV cell — the gate for AV row controls. */
export function isInAvCell(state: import('@tiptap/pm/state').EditorState): boolean {
  return isAvCellPos(state.selection.$from);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    avBlock: {
      /** Insert a new AV row at the current selection (wraps a new avBlock if none in scope). */
      insertAvRow: (where?: AvRowPlacement) => ReturnType;
      /** Delete the AV row containing the cursor; remove the block if it was the last row. */
      deleteAvRow: () => ReturnType;
      /** Wrap the cursor's current block into a fresh avBlock with one row, or unwrap if already inside one. */
      toggleAvBlock: () => ReturnType;
      /** Set one or more cue fields on the row holding the cursor. */
      setAvRowCue: (cue: { shot?: string | null; start?: string | null; duration?: string | null }) => ReturnType;
      /** Show or hide the cue or storyboard column for the whole AV body. */
      toggleAvColumn: (which: 'cue' | 'image', on?: boolean) => ReturnType;
      /** Set a column's relative width for the whole AV body. */
      setAvColumnWidth: (which: keyof AvColumnConfig['widths'], width: number) => ReturnType;
      /** Put a storyboard frame in the cursor's row (adds the cell if absent). */
      setAvRowImage: (image: { src?: string | null; alt?: string | null; assetId?: string | null; aspect?: string }) => ReturnType;
      /** Remove the storyboard frame from the cursor's row. */
      clearAvRowImage: () => ReturnType;
    };
  }
}

// ── Inner paragraph variants ────────────────────────────────────────────

export const AvPara = Node.create({
  name: 'avPara',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'p[data-type="av-para"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'av-para', class: 'av-para' }), 0];
  },
});

export const AvShot = Node.create({
  name: 'avShot',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'p[data-type="av-shot"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'av-shot', class: 'av-shot' }), 0];
  },
});

export const AvDirection = Node.create({
  name: 'avDirection',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'p[data-type="av-direction"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'av-direction', class: 'av-direction' }), 0];
  },
});

/** Storyboard frame aspect ratios offered in the image column. `free` keeps
 *  whatever the uploaded image already is. These mirror the ratios a shot is
 *  actually framed to; anything else is a crop the user can do elsewhere. */
export const AV_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '9:16', '2.39:1', 'free'] as const;
export type AvAspectRatio = (typeof AV_ASPECT_RATIOS)[number];

/** CSS `aspect-ratio` value for a frame, or null for `free`. */
export function aspectRatioCss(ratio: string | null | undefined): string | null {
  if (!ratio || ratio === 'free') return null;
  const [w, h] = String(ratio).split(':');
  const nw = Number(w);
  const nh = Number(h);
  if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw <= 0 || nh <= 0) return null;
  return `${nw} / ${nh}`;
}

/**
 * Storyboard / image cell — the third column in Celtx's MCAV layout.
 *
 * A leaf node rather than a container: the cell holds one frame, and the
 * caption lives in the video cell where it can be styled like any other AV
 * text. `src` is an asset URL resolved the same way inline images are, so
 * nothing is base64'd into the document.
 */
export const AvImage = Node.create({
  name: 'avImage',
  atom: true,
  draggable: false,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      /** Asset id, when the frame came from the project's asset store. */
      assetId: { default: null },
      aspect: { default: '16:9' },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="av-image"]' }]; },
  renderHTML({ HTMLAttributes }) {
    const a = HTMLAttributes as { src?: string; alt?: string; aspect?: string };
    const ratio = aspectRatioCss(a.aspect);
    const frameAttrs: Record<string, string> = {
      'data-type': 'av-image',
      'data-aspect': a.aspect || '16:9',
      class: 'av-image',
    };
    if (ratio) frameAttrs.style = `aspect-ratio: ${ratio};`;
    // An empty frame still renders the box — a blank storyboard cell is
    // meaningful in an AV document, it is where a frame is yet to be drawn.
    if (!a.src) return ['div', mergeAttributes(frameAttrs, { 'data-empty': 'true' })];
    return ['div', frameAttrs, ['img', { src: a.src, alt: a.alt || '', class: 'av-image-img' }]];
  },
});

/**
 * On-screen text — supers, lower thirds, captions, graphics cues.
 *
 * The fourth AV base style. Standard in AV work and genuinely distinct from the
 * other three: a super is neither a camera instruction (avShot), a performance
 * or staging note (avDirection), nor spoken/heard content (avPara). It is text
 * the audience reads on screen, and it has to survive into the spreadsheet and
 * the PDF as its own thing.
 */
export const AvGraphic = Node.create({
  name: 'avGraphic',
  content: 'inline*',
  defining: true,
  parseHTML() { return [{ tag: 'p[data-type="av-graphic"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'av-graphic', class: 'av-graphic' }), 0];
  },
});

// ── Cell ────────────────────────────────────────────────────────────────

export const AvCell = Node.create({
  name: 'avCell',
  content: '(avPara | avShot | avDirection | avGraphic)+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      side: { default: 'video' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="av-cell"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const side = (HTMLAttributes as { side?: string }).side || 'video';
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'av-cell',
        'data-side': side,
        class: `av-cell av-cell-${side}`,
      }),
      0,
    ];
  },
});

// ── Row ─────────────────────────────────────────────────────────────────

export const AvRow = Node.create({
  name: 'avRow',
  // `avImage?` is why an existing two-cell document still parses: the optional
  // third child means every row written before the storyboard column existed is
  // still valid against this schema, with no migration pass.
  content: 'avCell avCell avImage?',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      // Cue metadata. Structured values rather than a prose cell, so exporters
      // get numbers instead of having to re-parse rich text. All default to
      // null: an untimed row is the normal state of a document being written,
      // and the sequential shot number is derived from row order, not stored.
      /** Manual shot number override; null means "use the sequential number". */
      shot: { default: null },
      /** Manual start timestamp; null means "use the running total". */
      start: { default: null },
      /** This row's duration as typed, e.g. "0:05". */
      duration: { default: null },
    };
  },
  // The cue gutter is drawn by a node view rather than renderHTML because the
  // shot number and start timestamp depend on the rows *above* this one, which
  // renderHTML cannot see. renderHTML still emits the stored values as data-*
  // so export and copy carry them.
  addNodeView() {
    return ReactNodeViewRenderer(AvRowView);
  },
  parseHTML() { return [{ tag: 'div[data-type="av-row"]' }]; },
  renderHTML({ HTMLAttributes }) {
    const a = HTMLAttributes as { shot?: string; start?: string; duration?: string };
    const attrs: Record<string, string> = { 'data-type': 'av-row', class: 'av-row' };
    // Mirror the cue values onto data-* so the printed/exported HTML carries
    // them without needing the editor's node view.
    if (a.shot) attrs['data-shot'] = a.shot;
    if (a.start) attrs['data-start'] = a.start;
    if (a.duration) attrs['data-duration'] = a.duration;
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});

// ── Block container ─────────────────────────────────────────────────────

/** Build an empty avRow node (left=video, right=audio). */
function buildEmptyRow(schema: { nodes: Record<string, { create: (attrs: unknown, content?: PmNode | PmNode[]) => PmNode } > }): PmNode {
  const para = schema.nodes.avPara.create(null);
  const cellL = schema.nodes.avCell.create({ side: 'video' }, para);
  const cellR = schema.nodes.avCell.create({ side: 'audio' }, schema.nodes.avPara.create(null));
  return schema.nodes.avRow.create(null, [cellL, cellR]);
}

/** Which optional columns an AV body shows, and how wide each one is.
 *  Video and Audio are always present — an AV script without them is not one. */
export interface AvColumnConfig {
  cue: boolean;
  image: boolean;
  /** Relative widths (any positive numbers; rendered as `fr` units). */
  widths: { cue: number; video: number; audio: number; image: number };
}

/** Celtx's default MCAV shape: cue column on, storyboard column off, with the
 *  cue column narrow and video/audio splitting the rest evenly. */
export const AV_DEFAULT_COLUMNS: AvColumnConfig = {
  cue: true,
  image: false,
  widths: { cue: 0.5, video: 2, audio: 2, image: 1.5 },
};

/** Clamp a width to something that can still be clicked into. Returned in the
 *  same relative units the grid uses, so "0" cannot make a column vanish. */
export function clampColumnWidth(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.min(Math.max(v, 0.2), 10);
}

/** Read a block's column config, filling in anything missing or malformed.
 *  Documents written before this existed have no attrs at all, so every read
 *  goes through here rather than trusting the stored shape. */
export function readColumnConfig(attrs: unknown): AvColumnConfig {
  const a = (attrs || {}) as { columns?: Partial<AvColumnConfig> };
  const c = a.columns || {};
  const w = (c.widths || {}) as Partial<AvColumnConfig['widths']>;
  return {
    cue: typeof c.cue === 'boolean' ? c.cue : AV_DEFAULT_COLUMNS.cue,
    image: typeof c.image === 'boolean' ? c.image : AV_DEFAULT_COLUMNS.image,
    widths: {
      cue: clampColumnWidth(w.cue ?? AV_DEFAULT_COLUMNS.widths.cue),
      video: clampColumnWidth(w.video ?? AV_DEFAULT_COLUMNS.widths.video),
      audio: clampColumnWidth(w.audio ?? AV_DEFAULT_COLUMNS.widths.audio),
      image: clampColumnWidth(w.image ?? AV_DEFAULT_COLUMNS.widths.image),
    },
  };
}

/**
 * Narrowest the cue column may get, in px.
 *
 * It holds a duration field, and a plain `fr` track shrinks with the others as
 * columns are added — turning the storyboard column on took the cue track to
 * 45px, which clipped "1:30" to "1:3". A `minmax` floor keeps the longest
 * timecode the field accepts (`1:02:03`) readable however many columns share
 * the page.
 */
export const AV_CUE_MIN_PX = 64;

/** The CSS `grid-template-columns` for a config — one source of truth shared by
 *  the editor, print and the PDF exporter so all three line up. */
export function gridTemplateFor(cfg: AvColumnConfig): string {
  const parts: string[] = [];
  if (cfg.cue) parts.push(`minmax(${AV_CUE_MIN_PX}px, ${cfg.widths.cue}fr)`);
  parts.push(`${cfg.widths.video}fr`);
  parts.push(`${cfg.widths.audio}fr`);
  if (cfg.image) parts.push(`${cfg.widths.image}fr`);
  return parts.join(' ');
}

/**
 * Wrap a fresh avBlock (one empty row) into `tr` at the current selection, and
 * leave the caret in that row's VIDEO cell.
 *
 * Shared by `insertAvRow` and `toggleAvBlock` so both write into the SAME
 * transaction. `toggleAvBlock` used to fall back to `editor.commands.insertAvRow()`,
 * which dispatched a second transaction built from the pre-insert state while
 * the outer command still dispatched its own — ProseMirror rejected that with
 * "Applying a mismatched transaction" on every Mod-Shift-A.
 */
function wrapNewAvBlock(
  tr: import('@tiptap/pm/state').Transaction,
  state: import('@tiptap/pm/state').EditorState,
): boolean {
  const blockType = state.schema.nodes.avBlock;
  if (!blockType) return false;
  const insertAt = state.selection.from;
  const block = blockType.create(null, buildEmptyRow(state.schema as never));
  tr.replaceSelectionWith(block);
  // Caret into the new row's video cell: block open, row open, cell open,
  // para open. Without this the selection lands in the AUDIO cell, so the
  // writer's first keystroke goes into the wrong column.
  try {
    let blockPos = -1;
    const from = Math.max(0, insertAt - 1);
    const to = Math.min(tr.doc.content.size, insertAt + block.nodeSize + 1);
    tr.doc.nodesBetween(from, to, (n, pos) => {
      if (blockPos < 0 && n.type.name === 'avBlock') blockPos = pos;
      return blockPos < 0;
    });
    if (blockPos >= 0) tr.setSelection(TextSelection.create(tr.doc, blockPos + 4));
  } catch {
    // A caret we could not place is not worth failing the insert over.
  }
  return true;
}

export const AvBlock = Node.create({
  name: 'avBlock',
  group: 'block',
  content: 'avRow+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      /** Column visibility and widths. Null on older documents; every reader
       *  goes through readColumnConfig() so that stays safe. */
      columns: { default: null },
      /** Header labels for the columns, so a "Video" column can read "Visual"
       *  or a custom name without changing the schema. */
      headers: { default: null },
      /** Whether to repeat the column header row on each printed page. */
      repeatHeaders: { default: true },
    };
  },
  // NOTE: do NOT set Node priority here — Tiptap uses extension priority to order
  // schema registration, and a high-priority avBlock would become the schema's
  // `defaultType` for top-level `block+` content (it has no required attrs),
  // which crashes clearNodes with "Invalid content for node type avBlock" on any
  // toolbar element change in a normal screenplay. Keymap precedence for Enter
  // is handled by a separate non-schema Extension (AvKeymap, exported below).
  parseHTML() { return [{ tag: 'div[data-type="av-block"]' }]; },
  renderHTML({ HTMLAttributes }) {
    const cfg = readColumnConfig(HTMLAttributes);
    // The grid lives on the block, not each row, so every row in a body shares
    // one track definition — that is what keeps columns aligned down the page
    // and what print and the PDF exporter read back.
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-type': 'av-block',
      'data-cue': cfg.cue ? 'true' : 'false',
      'data-image': cfg.image ? 'true' : 'false',
      style: `--av-grid: ${gridTemplateFor(cfg)};`,
      class: 'screenplay-element av-block',
    }), 0];
  },

  addCommands() {
    return {
      insertAvRow: (where: AvRowPlacement = 'below') => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);

        if (ctx) {
          if (!dispatch) return true;
          const { $from } = state.selection;
          const insertPos = where === 'above' ? $from.before(ctx.rowDepth) : $from.after(ctx.rowDepth);
          tr.insert(insertPos, buildEmptyRow(state.schema as never));
          // Cursor into the new row's left (video) cell, first paragraph. The
          // new row starts at insertPos either way, so the offsets are the same
          // for 'above' and 'below': +1 row open, +1 cell open, +1 para open.
          tr.setSelection(TextSelection.create(tr.doc, insertPos + 3));
          dispatch(tr);
          return true;
        }

        // Not inside an avBlock — wrap a new one at the cursor.
        if (!dispatch) return true;
        if (!wrapNewAvBlock(tr, state)) return false;
        dispatch(tr);
        return true;
      },

      deleteAvRow: () => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);
        if (!ctx) return false;
        if (!dispatch) return true;
        const { $from } = state.selection;
        const { rowDepth, blockDepth } = ctx;
        const block = $from.node(blockDepth);
        if (block.childCount <= 1) {
          // Last row — remove the whole block
          const start = $from.before(blockDepth);
          const end = $from.after(blockDepth);
          tr.delete(start, end);
        } else {
          const start = $from.before(rowDepth);
          const end = $from.after(rowDepth);
          tr.delete(start, end);
        }
        dispatch(tr);
        return true;
      },

      toggleAvBlock: () => ({ tr, dispatch, state }) => {
        const { $from } = state.selection;
        // If inside an avBlock, unwrap to a single empty paragraph
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === 'avBlock') {
            if (!dispatch) return true;
            const start = $from.before(d);
            const end = $from.after(d);
            const para = (state.schema.nodes as { paragraph?: { create: () => PmNode }; action?: { create: () => PmNode } }).action?.create() ||
                         (state.schema.nodes as { paragraph?: { create: () => PmNode } }).paragraph?.create();
            if (!para) return false;
            tr.replaceWith(start, end, para);
            dispatch(tr);
            return true;
          }
        }
        // Not inside — wrap a new avBlock into THIS transaction. Delegating to
        // editor.commands.insertAvRow() here dispatched a second transaction
        // and ProseMirror rejected the pair as mismatched.
        if (!dispatch) return true;
        if (!wrapNewAvBlock(tr, state)) return false;
        dispatch(tr);
        return true;
      },

      setAvRowCue: (cue) => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);
        if (!ctx) return false;
        if (!dispatch) return true;
        const { $from } = state.selection;
        const rowPos = $from.before(ctx.rowDepth);
        const row = state.doc.nodeAt(rowPos);
        if (!row) return false;
        // Normalise empty strings to null so a cleared field reverts to the
        // derived value (sequential number / running clock) rather than
        // pinning it to "".
        const next: Record<string, unknown> = { ...row.attrs };
        for (const key of ['shot', 'start', 'duration'] as const) {
          if (key in cue) {
            const v = cue[key];
            next[key] = typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
          }
        }
        tr.setNodeMarkup(rowPos, undefined, next);
        dispatch(tr);
        return true;
      },

      toggleAvColumn: (which, on) => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);
        if (!ctx) return false;
        if (!dispatch) return true;
        const { $from } = state.selection;
        const blockPos = $from.before(ctx.blockDepth);
        const block = state.doc.nodeAt(blockPos);
        if (!block) return false;
        const cfg = readColumnConfig(block.attrs);
        const nextOn = typeof on === 'boolean' ? on : !cfg[which];
        tr.setNodeMarkup(blockPos, undefined, {
          ...block.attrs,
          columns: { ...cfg, [which]: nextOn },
        });
        dispatch(tr);
        return true;
      },

      setAvColumnWidth: (which, width) => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);
        if (!ctx) return false;
        if (!dispatch) return true;
        const { $from } = state.selection;
        const blockPos = $from.before(ctx.blockDepth);
        const block = state.doc.nodeAt(blockPos);
        if (!block) return false;
        const cfg = readColumnConfig(block.attrs);
        tr.setNodeMarkup(blockPos, undefined, {
          ...block.attrs,
          columns: { ...cfg, widths: { ...cfg.widths, [which]: clampColumnWidth(width) } },
        });
        dispatch(tr);
        return true;
      },

      setAvRowImage: (image) => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);
        if (!ctx) return false;
        const imageType = state.schema.nodes.avImage;
        if (!imageType) return false;
        if (!dispatch) return true;
        const { $from } = state.selection;
        const rowPos = $from.before(ctx.rowDepth);
        const row = state.doc.nodeAt(rowPos);
        if (!row) return false;

        const attrs = {
          src: image.src ?? null,
          alt: image.alt ?? null,
          assetId: image.assetId ?? null,
          aspect: image.aspect || '16:9',
        };
        const existing = row.child(row.childCount - 1);
        if (existing.type.name === 'avImage') {
          // Replace in place — rowPos+1 opens the row, then skip the two cells.
          let offset = rowPos + 1;
          for (let i = 0; i < row.childCount - 1; i++) offset += row.child(i).nodeSize;
          tr.setNodeMarkup(offset, undefined, attrs);
        } else {
          tr.insert(rowPos + row.nodeSize - 1, imageType.create(attrs));
        }
        // Turn the column on — adding a frame to a hidden column would look
        // like nothing happened.
        const blockPos = $from.before(ctx.blockDepth);
        const block = tr.doc.nodeAt(blockPos);
        if (block) {
          const cfg = readColumnConfig(block.attrs);
          if (!cfg.image) {
            tr.setNodeMarkup(blockPos, undefined, { ...block.attrs, columns: { ...cfg, image: true } });
          }
        }
        dispatch(tr);
        return true;
      },

      clearAvRowImage: () => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);
        if (!ctx) return false;
        const { $from } = state.selection;
        const rowPos = $from.before(ctx.rowDepth);
        const row = state.doc.nodeAt(rowPos);
        if (!row) return false;
        const last = row.child(row.childCount - 1);
        if (last.type.name !== 'avImage') return false;
        if (!dispatch) return true;
        let offset = rowPos + 1;
        for (let i = 0; i < row.childCount - 1; i++) offset += row.child(i).nodeSize;
        tr.delete(offset, offset + last.nodeSize);
        dispatch(tr);
        return true;
      },
    };
  },

  // Keymap is intentionally handled by the separate AvKeymap extension below
  // (priority 1100) so it preempts EnterHandler/TabHandler (priority 1000).
});

/**
 * Cue values are published as node decorations, not read inside the row's node
 * view, because they depend on the rows ABOVE this one.
 *
 * A node view only re-renders when its own node changes. Inserting a row in the
 * middle of a body does not touch the nodes below it, so those rows kept their
 * old shot number and start time — two rows both reading "2. 0:05" until
 * something else forced a redraw. Decorations are recomputed on every doc
 * change and Tiptap re-renders a node view when its decorations change, which
 * is exactly the trigger the derived values need.
 */
export const avCuePluginKey = new PluginKey('avCue');

/** Decoration attributes carrying one row's resolved cue values. */
export interface AvCueDecoAttrs {
  'data-av-shot': string;
  'data-av-start': string;
}

function buildCueDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'avBlock') return true;
    const rows: { duration: string | null; shot: string | null; start: string | null }[] = [];
    const spans: Array<{ from: number; to: number }> = [];
    node.forEach((row, offset) => {
      if (row.type.name !== 'avRow') return;
      const from = pos + 1 + offset;
      spans.push({ from, to: from + row.nodeSize });
      rows.push({
        duration: (row.attrs.duration as string | null) ?? null,
        shot: (row.attrs.shot as string | null) ?? null,
        start: (row.attrs.start as string | null) ?? null,
      });
    });
    const timings = computeRowTimings(rows);
    timings.forEach((timing, i) => {
      const span = spans[i];
      if (!span) return;
      decorations.push(
        Decoration.node(span.from, span.to, {
          'data-av-shot': timing.shot,
          'data-av-start': timing.start,
        }),
      );
    });
    // AV bodies do not nest.
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Read the cue values Tiptap handed a row's node view. */
export function cueFromDecorations(decorations: readonly unknown[] | undefined): { shot: string; start: string } | null {
  if (!decorations || !decorations.length) return null;
  for (const d of decorations) {
    const attrs = (d as { type?: { attrs?: Record<string, string> } })?.type?.attrs;
    if (attrs && typeof attrs['data-av-shot'] === 'string') {
      return { shot: attrs['data-av-shot'], start: attrs['data-av-start'] ?? '' };
    }
  }
  return null;
}

/** Keeps every AV row's derived cue values current as the document changes. */
export const AvCueDecorations = Extension.create({
  name: 'avCueDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: avCuePluginKey,
        props: {
          decorations(state) {
            try {
              return buildCueDecorations(state.doc);
            } catch {
              // A cue column that cannot be computed must not take the editor
              // down; the rows still render, just without derived values.
              return DecorationSet.empty;
            }
          },
        },
      }),
    ];
  },
});

// ── Keymap (separate Extension, no schema impact) ───────────────────────

/** Locate the cursor's avCell context, if any. Returns null when not inside an AV cell. */
function findAvCellDepth(
  state: import('@tiptap/pm/state').EditorState,
): { rowDepth: number; cellDepth: number; cellSide: 'video' | 'audio' } | null {
  const { $from } = state.selection;
  let rowDepth = -1;
  let cellDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'avCell' && cellDepth < 0) cellDepth = d;
    if (n.type.name === 'avRow' && rowDepth < 0) rowDepth = d;
  }
  if (rowDepth < 0 || cellDepth < 0) return null;
  const cell = $from.node(cellDepth);
  const cellSide: 'video' | 'audio' = (cell.attrs as { side?: 'video' | 'audio' }).side || 'video';
  return { rowDepth, cellDepth, cellSide };
}

/** Element ids valid inside an avCell — must match the avCell content rule. */
export const AV_CELL_ELEMENT_IDS = ['avPara', 'avShot', 'avDirection', 'avGraphic'] as const;

/** Optional callback set by ScreenplayEditor; AvKeymap calls it on empty-Enter
 *  inside an AV cell to surface the cell-scoped element picker. */
let __avCellPicker: ((defaultType: string, types: readonly string[]) => void) | null = null;
export function registerAvCellPicker(fn: ((defaultType: string, types: readonly string[]) => void) | null): void {
  __avCellPicker = fn;
}

/** Keymap-only extension: priority 1100 to win over EnterHandlerExtension (1000)
 *  and TabHandlerExtension (1000) inside AV cells. Returns false when the cursor
 *  isn't in an AV cell so non-AV editing is completely unaffected. */
export const AvKeymap = Extension.create({
  name: 'avKeymap',
  priority: 1100,
  addKeyboardShortcuts() {
    return {
      // Enter inside an AV cell:
      //   - non-empty paragraph → split in place
      //   - empty paragraph     → pop a picker restricted to avPara/avShot/avDirection
      // The screenplay-level EnterHandlerExtension assumes top-level blocks and
      // crashes inside an avBlock — we must consume Enter here unconditionally.
      Enter: ({ editor }) => {
        const ctx = findAvCellDepth(editor.state);
        if (!ctx) return false;
        const { $from } = editor.state.selection;
        const para = $from.parent;
        if (para.textContent.length === 0) {
          // Same rule as the screenplay body: once a blank line follows a blank
          // line — or the writer has switched the menu off — Enter means "one
          // more blank line", not "ask me again" (issue #100). setNode is not
          // optional: `splitBlock` at the end of a block takes the cell's
          // default child, which is not necessarily the type in hand.
          if (!useSettingsStore.getState().elementMenuOnEnter
              || isBlankBlock(previousSiblingBlock($from))) {
            return editor.chain()
              .splitBlock()
              .setNode(blankLineTypeFor(para.type.name))
              .run();
          }
          if (__avCellPicker) __avCellPicker(para.type.name, AV_CELL_ELEMENT_IDS);
          return true;
        }
        return editor.chain().splitBlock().run();
      },

      // Tab — move to the audio cell; from the audio cell, create a new row.
      Tab: ({ editor }) => {
        const ctx = findAvCellDepth(editor.state);
        if (!ctx) return false;
        const { state, view } = editor;
        const { $from } = state.selection;
        if (ctx.cellSide === 'video') {
          const rowPos = $from.before(ctx.rowDepth);
          const row = $from.node(ctx.rowDepth);
          // child(0) = video cell, child(1) = audio cell
          let audioCellPos = rowPos + 1; // inside row
          audioCellPos += row.child(0).nodeSize; // skip video cell
          const target = audioCellPos + 2; // inside audio cell, inside first paragraph
          const tr = state.tr.setSelection(TextSelection.create(state.doc, target));
          view.dispatch(tr);
          return true;
        }
        // From audio cell: create a new row after this one
        return editor.commands.insertAvRow();
      },

      'Shift-Tab': ({ editor }) => {
        const ctx = findAvCellDepth(editor.state);
        if (!ctx || ctx.cellSide !== 'audio') return false;
        const { state, view } = editor;
        const { $from } = state.selection;
        const rowPos = $from.before(ctx.rowDepth);
        const videoCellInside = rowPos + 3; // row open + cell open + first paragraph open
        const tr = state.tr.setSelection(TextSelection.create(state.doc, videoCellInside));
        view.dispatch(tr);
        return true;
      },

      // Mod-Enter: insert a new row, anywhere within an avBlock
      'Mod-Enter': ({ editor }) => {
        const ctx = findAvCellDepth(editor.state);
        if (!ctx) return false;
        return editor.commands.insertAvRow();
      },

      // Backspace at start of an empty cell: delete the row when both cells are empty
      Backspace: ({ editor }) => {
        const ctx = findAvCellDepth(editor.state);
        if (!ctx) return false;
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        if ($from.parentOffset !== 0) return false;
        const cell = $from.node(ctx.cellDepth);
        if (cell.textContent.length > 0) return false;
        const row = $from.node(ctx.rowDepth);
        let siblingText = '';
        row.forEach((c) => { if (c !== cell) siblingText = c.textContent; });
        if (siblingText.length > 0) return false;
        return editor.commands.deleteAvRow();
      },

      'Mod-Shift-a': ({ editor }) => editor.commands.toggleAvBlock(),
    };
  },
});

// Convenience re-export bundle for ScreenplayEditor extension list.
// Order matters: schema nodes first, then the keymap extension.
export const AvBlockExtensions = [AvBlock, AvRow, AvCell, AvPara, AvShot, AvDirection, AvGraphic, AvImage, AvKeymap, AvCueDecorations];

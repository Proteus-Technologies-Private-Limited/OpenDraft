/**
 * Two-column AV (Audio | Video) script support.
 *
 * Schema:
 *   avBlock         group=block, content=`avRow+`, isolating
 *     avRow         content=`avCell avCell`, isolating, defining
 *       avCell      attrs={ side: 'video' | 'audio' }, content=`AV_CELL_CONTENT`
 *         avPara, avShot, avDirection, avGraphic — the four AV paragraph types,
 *         plus the screenplay elements in AV_SCREENPLAY_CELL_ELEMENT_IDS. The
 *         schema accepts them all; the active template decides which of them
 *         the writer is offered, and in which column.
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
 *   Backspace    — at an empty cell whose sibling cell is empty and which holds
 *                  no storyboard frame, delete the row (& the block if last)
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
import { AvImageView } from './AvImageView';
import { isBlankBlock, previousSiblingBlock, blankLineTypeFor } from '../blankLine';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFormattingTemplateStore } from '../../stores/formattingTemplateStore';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { computeRowTimings, nextTimingOffset, type AvTimingOffset } from '../avTiming';

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

/** True when the cursor sits inside an AV cell. Gates the element picker and
 *  the toolbar, which only mean something where there is text to restyle. */
export function isInAvCell(state: import('@tiptap/pm/state').EditorState): boolean {
  return isAvCellPos(state.selection.$from);
}

/**
 * Which column the cursor is in, or null when it is not in a cell at all.
 *
 * The element list a cell offers depends on its side — a template puts Action
 * and Shot in the video column and Character and Dialogue in the audio one —
 * so every caller that builds that list needs this, not just `isInAvCell`.
 */
export function avCellSideAt(
  state: import('@tiptap/pm/state').EditorState,
): 'video' | 'audio' | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'avCell') {
      return (node.attrs as { side?: 'video' | 'audio' }).side === 'audio' ? 'audio' : 'video';
    }
  }
  return null;
}

/**
 * True when the selection sits anywhere in an AV row — the gate for the AV row,
 * column and storyboard controls.
 *
 * Wider than `isInAvCell` on purpose, and that is the whole point of it: a
 * storyboard frame is an atom, so clicking one leaves a NodeSelection on the
 * frame itself, with no avCell in the ancestry. Gating the menu on
 * `isInAvCell` greyed every AV control out the moment the writer clicked the
 * frame they wanted to put a picture in. Every command behind those items
 * resolves its row through `avRowContext`, which the frame's own position
 * answers perfectly well, so this is the condition they actually need.
 */
export function isInAvRow(state: import('@tiptap/pm/state').EditorState): boolean {
  return avRowContext(state) !== null;
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
      /**
       * Set several column widths at once, in ONE transaction.
       *
       * Dragging a divider moves two columns together, and chaining two
       * `setAvColumnWidth` calls cannot do it: Tiptap gives every command in a
       * chain the same starting `state`, so the second reads the block's
       * pre-chain attrs and its `setNodeMarkup` discards what the first wrote.
       *
       * `pos` names the block to change. The drag handle needs it because the
       * selection is wherever the writer left it, not necessarily in the body
       * whose divider is under the pointer. Omitted, it falls back to the
       * block at the cursor, which is what the menu wants.
       */
      setAvColumnWidths: (
        widths: Partial<AvColumnConfig['widths']>,
        pos?: number,
      ) => ReturnType;
      /**
       * Put a storyboard frame in the cursor's row (adds the cell if absent).
       *
       * A PARTIAL update: a field left out keeps whatever the frame already
       * has, and only an explicit `null` clears one. Choosing an aspect ratio
       * for a frame that already holds a picture must not throw the picture
       * away, and picking a picture must not throw away the ratio the writer
       * framed it to — which is exactly what replacing the whole attribute set
       * used to do to whichever of the two the caller forgot to pass through.
       */
      setAvRowImage: (image: {
        src?: string | null;
        alt?: string | null;
        assetId?: string | null;
        projectId?: string | null;
        scratchId?: string | null;
        filename?: string | null;
        aspect?: string;
      }) => ReturnType;
      /** Remove the storyboard frame from the cursor's row. */
      clearAvRowImage: () => ReturnType;
      /**
       * Put the caret on an ordinary script line just outside the AV table.
       *
       * An AV body is a sequence of cells, and every route out of one is a
       * keystroke a soft keyboard does not have — the AV Script template's
       * starter document is a single `avBlock` and nothing else, so a writer
       * who opened it on a phone had the table and no way to write a word
       * anywhere but inside it. Tapping the page below the table does not
       * help: that area is `.page`, not `.ProseMirror`, so the tap never
       * reaches the editor at all. This is the same lesson as issue #116,
       * one level up: the block needs a door, and the door has to be
       * something a finger can open.
       *
       * An adjacent blank line is REUSED rather than added to, so asking
       * twice does not stack empty paragraphs above the table.
       */
      exitAvBlock: (where?: 'before' | 'after') => ReturnType;
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

/** The frame attributes `setAvRowImage` understands, in the order they are
 *  declared on the node. Kept beside the node spec so a new attribute cannot be
 *  added to one without the other noticing. */
export const AV_IMAGE_FIELDS = [
  'src', 'alt', 'assetId', 'projectId', 'scratchId', 'filename', 'aspect',
] as const;

/** The image-identifying fields — what has to be cleared for a frame to go back
 *  to being an empty slot. `aspect` is deliberately not one of them. */
export const AV_IMAGE_SOURCE_FIELDS = ['src', 'assetId', 'projectId', 'scratchId', 'filename', 'alt'] as const;

/** A partial frame update that blanks the picture but keeps the frame and its
 *  aspect ratio — what "Add Blank Frame" means on a row that already has one. */
export const AV_BLANK_FRAME: Record<string, null> = Object.fromEntries(
  AV_IMAGE_SOURCE_FIELDS.map((k) => [k, null]),
);

/** True when a storyboard frame actually references an image, rather than
 *  being the empty slot a row carries once the column is on. */
export function avImageIsSet(node: PmNode): boolean {
  const a = node.attrs as { src?: string | null; assetId?: string | null; scratchId?: string | null };
  return Boolean(a.src || a.assetId || a.scratchId);
}

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
      /**
       * Project the asset id belongs to. Stored rather than read from whatever
       * project happens to be open, because an exporter resolves a document,
       * not a session. Without it `resolveImageUrl` has no endpoint to build
       * and the frame silently resolves to nothing.
       */
      projectId: { default: null },
      /**
       * Bytes in the scratch store, for a document with no project yet. Kept
       * distinct from `assetId` for the reason ScreenplayImage gives: backup
       * packing treats every `assetId` it finds as a project asset, so a
       * scratch id smuggled in as one marks the backup truncated.
       */
      scratchId: { default: null },
      /** Original file name, which the asset endpoint takes as a hint. */
      filename: { default: null },
      aspect: { default: '16:9' },
    };
  },
  // Resolving a frame needs the asset store, which `renderHTML` cannot reach —
  // see AvImageView. renderHTML below stays as the static export/copy shape.
  addNodeView() {
    return ReactNodeViewRenderer(AvImageView);
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

/**
 * The four AV paragraph types. Always valid in either cell, in every document,
 * whatever template is active — they are what an AV body is made of.
 *
 * Order matters twice over: it is the order the element menu lists them in,
 * and `avPara` being FIRST is what makes it the cell's default child. A content
 * expression's default type is the first one that can stand alone, so putting
 * anything else here would make Enter at the end of a cell produce that type.
 */
export const AV_BASE_CELL_ELEMENT_IDS = ['avPara', 'avShot', 'avDirection', 'avGraphic'] as const;

/**
 * Screenplay elements an AV cell also accepts.
 *
 * The schema is deliberately permissive and the TEMPLATE decides what is
 * actually offered — see `FormattingElementRule.avCell`. Two reasons it has to
 * be this way round:
 *
 *   - A template can be switched on a document that already exists. If the
 *     schema only admitted what the template of the day allowed, changing
 *     template would make the document unparseable rather than merely
 *     restyled.
 *   - The industry formats do mix them. Final Draft AV carried separate styles
 *     for video description, character and dialogue inside the columns, and
 *     WriterDuet's A/V template puts Action and Shot in the visual column and
 *     Character, Dialogue and Parenthetical in the audio one. An on-camera
 *     interview in a corporate or documentary script is ordinary dialogue, and
 *     there was no way to write it.
 *
 * `customElement` is here so a template's own declared elements work in a cell
 * too; it is a single node type carrying a `customTypeId`, so one entry covers
 * all of them.
 *
 * Deliberately NOT included: `newAct`, `endOfAct`, `showEpisode`, `castList`,
 * `titlePage` and the outline types. Those are document-level furniture — an
 * act break inside one cell of one row of a table is not a thing anyone means.
 */
export const AV_SCREENPLAY_CELL_ELEMENT_IDS = [
  'action', 'sceneHeading', 'character', 'dialogue', 'parenthetical',
  'transition', 'shot', 'general', 'lyrics', 'customElement',
] as const;

/** Every element id an `avCell` will hold — the schema's own list. */
export const AV_CELL_ELEMENT_IDS = [
  ...AV_BASE_CELL_ELEMENT_IDS,
  ...AV_SCREENPLAY_CELL_ELEMENT_IDS,
] as const;

/** The `avCell` content expression, built from the list above so the two can
 *  never drift. Parenthesised and `+` because a cell is one or more of them. */
export const AV_CELL_CONTENT = `(${AV_CELL_ELEMENT_IDS.join(' | ')})+`;

export const AvCell = Node.create({
  name: 'avCell',
  content: AV_CELL_CONTENT,
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

/** Narrowest and widest a column may be, in the grid's relative units. */
export const AV_MIN_COLUMN_WIDTH = 0.2;
export const AV_MAX_COLUMN_WIDTH = 10;

/**
 * Clamp a width READ FROM A DOCUMENT to something that can still be clicked
 * into. Returned in the same relative units the grid uses, so "0" cannot make a
 * column vanish.
 *
 * Note what a nonsense value does: it becomes 1, not the minimum. That is right
 * for a stored attribute, where `0`, `null` or `"wide"` means the width was
 * never really set and a middling column is the best guess. It is wrong for a
 * drag, where a column pushed past zero would suddenly jump WIDER than the
 * writer had just dragged it — so `avColumnDrag` saturates at the bounds
 * instead. Both use the same two numbers.
 */
export function clampColumnWidth(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.min(Math.max(v, AV_MIN_COLUMN_WIDTH), AV_MAX_COLUMN_WIDTH);
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

/**
 * How many rows of `block` carry something that switching `which` off would
 * stop showing — and stop exporting, since `readAvBlock` writes a column out
 * only when its flag is on.
 *
 * Nothing is deleted by turning a column off: durations stay on their rows and
 * frames stay in theirs, and turning it back on brings them back untouched.
 * But a writer who has timed forty shots and then loses the gutter, the PDF
 * column and the spreadsheet column in one click has lost that work as far as
 * they can tell, so the menu asks first. Zero means there is nothing to ask
 * about.
 */
export function avColumnDataCount(block: PmNode, which: 'cue' | 'image'): number {
  let count = 0;
  try {
    block.forEach((row) => {
      if (row.type.name !== 'avRow') return;
      if (which === 'cue') {
        // A manual shot number or start is an override the writer typed; a
        // derived one is not data and costs nothing to hide.
        const a = row.attrs as { duration?: string | null; shot?: string | null; start?: string | null };
        if ((a.duration && a.duration.trim()) || (a.shot && a.shot.trim()) || (a.start && a.start.trim())) count += 1;
        return;
      }
      // An empty frame is a slot, not work — only a frame with a picture in it
      // is worth stopping for.
      row.forEach((child) => {
        if (child.type.name === 'avImage' && avImageIsSet(child)) count += 1;
      });
    });
  } catch (err) {
    console.warn('[av] could not count column data', err);
  }
  return count;
}

/** The avBlock the cursor is in, or null. Used by the menu, which has to look
 *  at the body's contents before offering to change it. */
export function avBlockAtSelection(state: import('@tiptap/pm/state').EditorState): PmNode | null {
  const ctx = avRowContext(state);
  if (!ctx) return null;
  try {
    return state.selection.$from.node(ctx.blockDepth);
  } catch {
    return null;
  }
}

/** A column of the grid, in the order the tracks are written. */
export type AvColumnKey = keyof AvColumnConfig['widths'];

/**
 * The columns this config actually draws, left to right.
 *
 * The same order as the tracks `gridTemplateFor` emits, which is what lets a
 * resize handle map a track index back to the width it should be changing.
 */
export function visibleColumns(cfg: AvColumnConfig): AvColumnKey[] {
  const cols: AvColumnKey[] = [];
  if (cfg.cue) cols.push('cue');
  cols.push('video', 'audio');
  if (cfg.image) cols.push('image');
  return cols;
}

/** The CSS `grid-template-columns` for a config — one source of truth shared by
 *  the editor, print and the PDF exporter so all three line up. */
export function gridTemplateFor(cfg: AvColumnConfig): string {
  return visibleColumns(cfg)
    .map((key) => (key === 'cue'
      // The cue track holds a duration field, and a plain `fr` shrinks with the
      // others as columns are added. See AV_CUE_MIN_PX.
      ? `minmax(${AV_CUE_MIN_PX}px, ${cfg.widths.cue}fr)`
      : `${cfg.widths[key]}fr`))
    .join(' ');
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

  const $from = state.selection.$from;
  const row = buildEmptyRow(state.schema as never);

  // Put the caret in the new row's VIDEO cell: row open, cell open, para open.
  // Without it the selection lands in the audio cell and the writer's first
  // keystroke goes into the wrong column.
  const caretInRow = (rowStart: number) => {
    try {
      tr.setSelection(TextSelection.create(tr.doc, rowStart + 3));
    } catch {
      // A caret we could not place is not worth failing the insert over.
    }
  };

  // A gap cursor, or anything else resolving between top-level blocks rather
  // than inside one. There is no line to place the body relative to, so it goes
  // exactly where the caret is — which is the one case where inserting AT the
  // selection cannot split anything.
  if ($from.depth === 0) {
    if (!$from.parent.canReplaceWith($from.index(), $from.index(), blockType)) return false;
    tr.insert($from.pos, blockType.create(null, row));
    caretInRow($from.pos + 1);
    return true;
  }

  const depth = avBlockInsertDepth($from, blockType);
  if (depth === null) return false;

  const parent = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  const node = $from.node(depth);
  const before = $from.before(depth);
  const after = $from.after(depth);

  const prev = index > 0 ? parent.child(index - 1) : null;
  const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
  const blank = isBlankBlock(node);

  // Touching an existing body means joining it, not starting a second one.
  // Two avBlocks with nothing between them draw as one table but are not one:
  // they carry separate column widths, repeat the header row, and restart the
  // shot numbering — a table that looks continuous and behaves as two.
  if (blank && prev?.type.name === 'avBlock' && next?.type.name === 'avBlock') {
    // A blank line BETWEEN two bodies. Consuming it would leave the two
    // touching, which is the very shape this is here to prevent, so the two
    // become one and the new row is the seam. The first body's column settings
    // win: it is the one already on screen above the caret, and a merge that
    // silently re-laid out the rows above would be a worse surprise than one
    // that re-laid out the rows below.
    const prevStart = before - prev.nodeSize;
    const nextEnd = after + next.nodeSize;
    const merged = blockType.create(prev.attrs, [
      ...prev.content.content,
      row,
      ...next.content.content,
    ]);
    tr.replaceWith(prevStart, nextEnd, merged);
    // Row open, cell open, para open — past the block's own open token and
    // every row that was already in the first body.
    caretInRow(prevStart + 1 + prev.content.size);
    return true;
  }
  if (blank && prev?.type.name === 'avBlock') {
    tr.delete(before, after);
    const rowStart = before - 1; // inside the previous block, before its close
    tr.insert(rowStart, row);
    caretInRow(rowStart);
    return true;
  }
  if (next?.type.name === 'avBlock') {
    // The caret is immediately above an existing body, so the new row belongs
    // at the top of it. A blank line in between is consumed; a line with text
    // stays where the writer put it.
    const bodyStart = blank ? before : after;
    if (blank) tr.delete(before, after);
    const rowStart = bodyStart + 1;
    tr.insert(rowStart, row);
    caretInRow(rowStart);
    return true;
  }

  const block = blockType.create(null, row);
  if (blank) {
    // An empty line is a placeholder, so the body takes its place.
    tr.replaceWith(before, after, block);
    caretInRow(before + 1);
    return true;
  }

  // A line with text is CONTENT, and the body goes after it — never through it.
  // `replaceSelectionWith` used to insert at the cursor, which split whatever
  // the caret was sitting in: starting an AV body from the middle of
  // "INT. KITCHEN - DAY" left a stray "INT. " scene heading above the table,
  // and that heading went on to show up in the navigator and the scene
  // numbering. A scene heading ABOVE an AV body is exactly right — it is how
  // the two-column format is headed — but it has to survive intact.
  tr.insert(after, block);
  caretInRow(after + 1);
  return true;
}

/**
 * The depth at which a new `avBlock` can be inserted next to the caret's block.
 *
 * Walks outwards from the caret and stops at the first ancestor whose own
 * parent would accept an `avBlock` beside it — the document, in every case that
 * exists today. Returns null when nothing in the ancestry will take one, so the
 * command reports failure instead of dropping a body somewhere invalid.
 */
function avBlockInsertDepth(
  $from: import('@tiptap/pm/model').ResolvedPos,
  blockType: import('@tiptap/pm/model').NodeType,
): number | null {
  for (let d = $from.depth; d >= 1; d--) {
    const parent = $from.node(d - 1);
    const index = $from.index(d - 1);
    if (parent.canReplaceWith(index, index, blockType)) return d;
  }
  return null;
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

      setAvColumnWidths: (widths, pos) => ({ tr, dispatch, state }) => {
        let blockPos = pos;
        if (blockPos === undefined) {
          const ctx = avRowContext(state);
          if (!ctx) return false;
          blockPos = state.selection.$from.before(ctx.blockDepth);
        }
        // A position handed in from a node view can be stale by the time the
        // pointer is released — the document may have changed underneath — so
        // it is checked rather than trusted.
        if (blockPos < 0 || blockPos > state.doc.content.size) return false;
        const block = state.doc.nodeAt(blockPos);
        if (!block || block.type.name !== 'avBlock') return false;
        const cfg = readColumnConfig(block.attrs);
        const next = { ...cfg.widths };
        let changed = false;
        for (const key of Object.keys(widths) as AvColumnKey[]) {
          const value = widths[key];
          if (value === undefined) continue;
          const clamped = clampColumnWidth(value);
          if (clamped !== next[key]) changed = true;
          next[key] = clamped;
        }
        // A drag that ends where it started, or one the clamp swallowed
        // entirely, must not push an undo step the writer would have to press
        // Cmd-Z through for nothing.
        if (!changed) return false;
        if (!dispatch) return true;
        tr.setNodeMarkup(blockPos, undefined, {
          ...block.attrs,
          columns: { ...cfg, widths: next },
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

        const existing = row.child(row.childCount - 1);
        const isFrame = existing.type.name === 'avImage';
        // Merge over what is there, so an untouched field survives. `undefined`
        // means "leave it"; `null` means "clear it".
        const attrs: Record<string, unknown> = isFrame ? { ...existing.attrs } : {
          src: null, alt: null, assetId: null, projectId: null, scratchId: null,
          filename: null, aspect: '16:9',
        };
        for (const key of AV_IMAGE_FIELDS) {
          if (image[key] !== undefined) attrs[key] = image[key];
        }
        if (!attrs.aspect) attrs.aspect = '16:9';
        if (isFrame) {
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

      exitAvBlock: (where: 'before' | 'after' = 'after') => ({ tr, dispatch, state }) => {
        const ctx = avRowContext(state);
        if (!ctx) return false;
        const { $from } = state.selection;
        const blockPos = $from.before(ctx.blockDepth);
        const block = state.doc.nodeAt(blockPos);
        if (!block) return false;
        // The line type is the ordinary body's, never the cell's: `avPara` is
        // not a node the document can hold outside an `avCell`.
        const type = state.schema.nodes[blankLineTypeFor('action')] || state.schema.nodes.action;
        if (!type) return false;

        // `resolve(blockPos).nodeAfter` is the block ITSELF — the node after it
        // is read from the far side.
        const after = blockPos + block.nodeSize;
        const neighbour = where === 'before'
          ? state.doc.resolve(blockPos).nodeBefore
          : state.doc.resolve(after).nodeAfter;
        if (!dispatch) return true;

        // Land on the blank line that is already there rather than adding to it.
        if (neighbour && neighbour.isTextblock && isBlankBlock(neighbour)) {
          const at = where === 'before' ? blockPos - neighbour.nodeSize : after;
          tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
          dispatch(tr.scrollIntoView());
          return true;
        }

        const at = where === 'before' ? blockPos : after;
        tr.insert(at, type.create());
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
        dispatch(tr.scrollIntoView());
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
  // Numbering and the clock run THROUGH the document, not per body: a scene
  // heading or an intro paragraph between two AV bodies is a section break in
  // one piece, not the start of a second piece. See `computeRowTimings`.
  let carry: AvTimingOffset = {};
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
    const timings = computeRowTimings(rows, 'auto', carry);
    carry = nextTimingOffset(rows, timings, carry);
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

/** `buildCueDecorations`, but a body that cannot be computed must not take the
 *  editor down — the rows still render, just without derived values. */
function safeCueDecorations(doc: PmNode): DecorationSet {
  try {
    return buildCueDecorations(doc);
  } catch (err) {
    console.warn('[av] could not compute cue values', err);
    return DecorationSet.empty;
  }
}

/** Keeps every AV row's derived cue values current as the document changes. */
export const AvCueDecorations = Extension.create({
  name: 'avCueDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: avCuePluginKey,
        // Held as plugin state rather than rebuilt inside `decorations(state)`:
        // that prop is consulted on every state change, so a bare cursor move
        // was re-walking the document and rebuilding every row's decoration.
        // The values derive from the doc alone, so a transaction that does not
        // change it cannot change them, and the set already belongs to that
        // same doc.
        state: {
          init(_config, state) {
            return safeCueDecorations(state.doc);
          },
          apply(tr, value: DecorationSet) {
            if (!tr.docChanged) return value;
            return safeCueDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return avCuePluginKey.getState(state) ?? DecorationSet.empty;
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

/**
 * Down (or Up) out of an AV table with nothing beyond it.
 *
 * Returns false — leaving the key to ProseMirror — in every other case, so
 * moving between rows and out to an existing neighbour keeps working exactly
 * as it did. Only the dead end is handled, and only in the direction of the
 * dead end: an avBlock that is the document's last node has nothing below it,
 * so Down there can mean nothing except "let me out".
 */
export function avArrowExit(
  editor: { state: import('@tiptap/pm/state').EditorState; commands: { exitAvBlock: (w: 'before' | 'after') => boolean } },
  where: 'before' | 'after',
): boolean {
  const ctx = avRowContext(editor.state);
  if (!ctx) return false;
  const { state } = editor;
  const { $from, empty } = state.selection;
  // A live selection is being extended, not navigated out of.
  if (!empty) return false;
  const blockPos = $from.before(ctx.blockDepth);
  const block = state.doc.nodeAt(blockPos);
  if (!block) return false;
  const neighbour = where === 'before'
    ? state.doc.resolve(blockPos).nodeBefore
    : state.doc.resolve(blockPos + block.nodeSize).nodeAfter;
  if (neighbour) return false;
  // Only from the row on the edge being left. Down out of the FIRST row of a
  // three-row table is a request for the second row, and taking the key there
  // would break moving through a table that happens to end the document —
  // which is most of them.
  const rowPos = $from.before(ctx.rowDepth);
  const row = state.doc.nodeAt(rowPos);
  if (!row) return false;
  const edgeRow = where === 'before'
    ? rowPos === blockPos + 1
    : rowPos + row.nodeSize === blockPos + block.nodeSize - 1;
  if (!edgeRow) return false;
  return editor.commands.exitAvBlock(where);
}

/** The element id a node carries, unwrapping the `customElement` envelope so a
 *  template's own element is named by its own id rather than the node type. */
export function avElementIdOf(node: PmNode): string {
  return node.type.name === 'customElement'
    ? ((node.attrs?.customTypeId as string) || 'customElement')
    : node.type.name;
}

/**
 * The type the next line takes when Enter splits `currentId` inside an AV cell.
 *
 * The template's `nextOnEnter` is the same field that drives Enter in the
 * ordinary script body, so it names a type that is valid OUT here — Character
 * flows to Dialogue, Dialogue back to Action. Inside a cell that answer is only
 * usable when the cell would take it and the template offers it in THIS column:
 * an Action after a line of Dialogue belongs in the video column, not under the
 * dialogue it followed.
 *
 * Anything that does not survive both tests falls back to `avPara`, the cell's
 * own neutral paragraph. Returning null means "leave it to ProseMirror", which
 * is what an element with no flow of its own wants.
 */
function avNextTypeOnEnter(currentId: string, side: 'video' | 'audio'): string | null {
  let next: string | undefined;
  try {
    const template = useFormattingTemplateStore.getState().getActiveTemplate();
    next = template.rules[currentId]?.nextOnEnter;
    if (!next || next === currentId) return null;
    if (!AV_CELL_ELEMENT_IDS.includes(next as never)) return 'avPara';
    if ((AV_BASE_CELL_ELEMENT_IDS as readonly string[]).includes(next)) return next;
    const placement = template.rules[next]?.avCell;
    if (placement === 'both' || placement === side) return next;
    return 'avPara';
  } catch (err) {
    // A template that cannot be read is not a reason to swallow the keystroke.
    console.warn('[av] could not resolve the next element type on Enter', err);
    return null;
  }
}

/** Optional callback set by ScreenplayEditor; AvKeymap calls it on empty-Enter
 *  inside an AV cell to surface the cell-scoped element picker. The keymap
 *  passes only the cell's side — resolving that into a list of elements is the
 *  template's job, and the template lives on the React side. */
let __avCellPicker: ((defaultType: string, side: 'video' | 'audio') => void) | null = null;
export function registerAvCellPicker(fn: ((defaultType: string, side: 'video' | 'audio') => void) | null): void {
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
      //   - empty paragraph     → pop a picker scoped to this cell's side
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
              .setNode(blankLineTypeFor(avElementIdOf(para), true))
              .run();
          }
          if (__avCellPicker) __avCellPicker(avElementIdOf(para), ctx.cellSide);
          return true;
        }
        // A line WITH text: split, then let the template say what follows.
        // `splitBlock` at the end of a block takes the cell's default child
        // (avPara), which is right for the AV paragraph types and wrong for a
        // Character, whose whole point is that Dialogue comes next.
        const next = avNextTypeOnEnter(avElementIdOf(para), ctx.cellSide);
        const chain = editor.chain().splitBlock();
        if (next && next !== 'customElement' && editor.schema.nodes[next]) {
          return chain.setNode(next).run();
        }
        return chain.run();
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

      // Arrow out of a table that has nothing on the far side of it.
      //
      // Only that case: with a sibling to move to, the default behaviour
      // already goes there, and taking the key would break ordinary
      // navigation between the rows. An AV body that is the document's first
      // or last node has nowhere to arrow to, which is where a writer gets
      // stuck — and where pressing Down is unambiguously a request to leave.
      ArrowDown: ({ editor }) => avArrowExit(editor, 'after'),
      ArrowUp: ({ editor }) => avArrowExit(editor, 'before'),

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
        // Only the avCell siblings count. `avImage` is an atom whose
        // textContent is always '' and it is always the row's LAST child, so
        // assigning here instead of accumulating let a storyboard frame reset
        // the check to "empty" — backspacing in an empty video cell then took
        // the row away along with whatever the audio cell still said.
        let siblingText = '';
        row.forEach((c) => { if (c !== cell && c.type.name === 'avCell') siblingText += c.textContent; });
        if (siblingText.length > 0) return false;
        // A frame that holds something is content too, and Backspace is the
        // one route that could lose it without the writer being told. An empty
        // slot is not content, so it does not block the delete.
        const last = row.child(row.childCount - 1);
        if (last.type.name === 'avImage' && avImageIsSet(last)) return false;
        return editor.commands.deleteAvRow();
      },

      'Mod-Shift-a': ({ editor }) => editor.commands.toggleAvBlock(),
    };
  },
});

// Convenience re-export bundle for ScreenplayEditor extension list.
// Order matters: schema nodes first, then the keymap extension.
export const AvBlockExtensions = [AvBlock, AvRow, AvCell, AvPara, AvShot, AvDirection, AvGraphic, AvImage, AvKeymap, AvCueDecorations];

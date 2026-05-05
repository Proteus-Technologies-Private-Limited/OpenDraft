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
 */

import { Node, Extension, mergeAttributes } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    avBlock: {
      /** Insert a new AV row at the current selection (wraps a new avBlock if none in scope). */
      insertAvRow: () => ReturnType;
      /** Delete the AV row containing the cursor; remove the block if it was the last row. */
      deleteAvRow: () => ReturnType;
      /** Wrap the cursor's current block into a fresh avBlock with one row, or unwrap if already inside one. */
      toggleAvBlock: () => ReturnType;
    };
  }
}

// ── Inner paragraph variants ────────────────────────────────────────────

export const AvPara = Node.create({
  name: 'avPara',
  content: 'text*',
  defining: true,
  parseHTML() { return [{ tag: 'p[data-type="av-para"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'av-para', class: 'av-para' }), 0];
  },
});

export const AvShot = Node.create({
  name: 'avShot',
  content: 'text*',
  defining: true,
  parseHTML() { return [{ tag: 'p[data-type="av-shot"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'av-shot', class: 'av-shot' }), 0];
  },
});

export const AvDirection = Node.create({
  name: 'avDirection',
  content: 'text*',
  defining: true,
  parseHTML() { return [{ tag: 'p[data-type="av-direction"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { 'data-type': 'av-direction', class: 'av-direction' }), 0];
  },
});

// ── Cell ────────────────────────────────────────────────────────────────

export const AvCell = Node.create({
  name: 'avCell',
  content: '(avPara | avShot | avDirection)+',
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
  content: 'avCell avCell',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-type="av-row"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'av-row', class: 'av-row' }), 0];
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

export const AvBlock = Node.create({
  name: 'avBlock',
  group: 'block',
  content: 'avRow+',
  defining: true,
  isolating: true,
  // NOTE: do NOT set Node priority here — Tiptap uses extension priority to order
  // schema registration, and a high-priority avBlock would become the schema's
  // `defaultType` for top-level `block+` content (it has no required attrs),
  // which crashes clearNodes with "Invalid content for node type avBlock" on any
  // toolbar element change in a normal screenplay. Keymap precedence for Enter
  // is handled by a separate non-schema Extension (AvKeymap, exported below).
  parseHTML() { return [{ tag: 'div[data-type="av-block"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'av-block', class: 'screenplay-element av-block' }), 0];
  },

  addCommands() {
    return {
      insertAvRow: () => ({ tr, dispatch, state }) => {
        const { $from } = state.selection;

        // Find the enclosing avBlock, if any
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'avBlock') {
            // Insert a row after the current row
            // Find current avRow depth
            let rowDepth = -1;
            for (let r = $from.depth; r >= 0; r--) {
              if ($from.node(r).type.name === 'avRow') { rowDepth = r; break; }
            }
            if (rowDepth < 0) return false;
            const insertPos = $from.after(rowDepth);
            if (!dispatch) return true;
            const newRow = buildEmptyRow(state.schema as never);
            tr.insert(insertPos, newRow);
            // Move cursor into the new row's left cell, first paragraph
            const cellInside = insertPos + 2; // +1 for row, +1 for cell
            const paraInside = cellInside + 1;
            tr.setSelection(TextSelection.create(tr.doc, paraInside));
            dispatch(tr);
            return true;
          }
        }

        // Not inside an avBlock — wrap a new one at the cursor.
        if (!dispatch) return true;
        const block = state.schema.nodes.avBlock.create(null, buildEmptyRow(state.schema as never));
        tr.replaceSelectionWith(block);
        dispatch(tr);
        return true;
      },

      deleteAvRow: () => ({ tr, dispatch, state }) => {
        const { $from } = state.selection;
        let rowDepth = -1;
        let blockDepth = -1;
        for (let r = $from.depth; r >= 0; r--) {
          const n = $from.node(r);
          if (n.type.name === 'avRow' && rowDepth < 0) rowDepth = r;
          if (n.type.name === 'avBlock' && blockDepth < 0) blockDepth = r;
        }
        if (rowDepth < 0 || blockDepth < 0) return false;
        if (!dispatch) return true;
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

      toggleAvBlock: () => ({ editor, tr, dispatch, state }) => {
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
        // Not inside — insert a new avBlock at the cursor's block boundary.
        return editor.commands.insertAvRow();
      },
    };
  },

  // Keymap is intentionally handled by the separate AvKeymap extension below
  // (priority 1100) so it preempts EnterHandler/TabHandler (priority 1000).
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
export const AV_CELL_ELEMENT_IDS = ['avPara', 'avShot', 'avDirection'] as const;

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
export const AvBlockExtensions = [AvBlock, AvRow, AvCell, AvPara, AvShot, AvDirection, AvKeymap];

/**
 * Hard breaks (Shift+Enter / Mod+Enter) inside a screenplay element.
 *
 * ## Why this file exists rather than importing HardBreak directly
 *
 * A `hardBreak` is an inline LEAF with no text. ProseMirror's `Node.textContent`
 * therefore skips it entirely unless the node spec declares `leafText`
 * (prosemirror-model: `Node.textBetween` consults `type.spec.leafText`). Without
 * it, `ACTION<br>MORE` reads back as `"ACTIONMORE"` — words silently glued —
 * and, far worse, the node still occupies **one ProseMirror position while
 * contributing zero characters**. Any code doing `pos + 1 + textContent.length`
 * then computes a range that is short by one per break, which turns an
 * innocuous replace into a destructive one.
 *
 * Declaring `leafText: () => '\n'` makes a break worth exactly one character —
 * matching its `nodeSize` of 1 — so `textContent.length === content.size` holds
 * again and every read site returns a truthful string.
 *
 * TipTap's `renderText()` is NOT this: it maps to `schema.toText`, which only
 * `editor.getText()` consults, not `.textContent`. And `Node.create({ leafText })`
 * is silently dropped, because TipTap builds each node spec from a fixed key
 * list plus whatever `extendNodeSchema` contributes. Hence the separate
 * extension below — it is the only supported way in.
 *
 * ## What this does NOT fix
 *
 * Position arithmetic. The `textContent.length === content.size` identity holds
 * only while `hardBreak` is the sole inline non-text node in the schema (today
 * `screenplayImage` is a *block* atom, so it is). Code that maps a character
 * index to a document position must still derive its range from `nodeSize` —
 * see `blockContentRange` in `utils/nodeText.ts`. The invariant is pinned by a
 * test in `hardBreakSchema.test.ts`; if it ever fails, that test is telling you
 * a new inline atom was added and the position-math sites need revisiting.
 */
import { Extension } from '@tiptap/core';
import HardBreak from '@tiptap/extension-hard-break';

/**
 * The hard-break node itself. Re-exported so callers get the break and its
 * `leafText` patch from one import and cannot register one without the other.
 */
export const ScreenplayHardBreak = HardBreak;

/**
 * Injects `leafText` into the `hardBreak` node spec. Must be registered
 * alongside `ScreenplayHardBreak` — a break without it reads as zero
 * characters everywhere and reintroduces the off-by-one range bugs.
 */
export const HardBreakLeafText = Extension.create({
  name: 'hardBreakLeafText',

  extendNodeSchema(extension) {
    return extension.name === 'hardBreak' ? { leafText: () => '\n' } : {};
  },
});

/**
 * Lock Pages / Unlock Pages — the anchors utils/lockedPages.ts describes.
 *
 * Locking reads where the pagination plugin has put every page break right
 * now and writes each page's printed number onto the block that opens it, so
 * the moment after locking the script is laid out exactly as it was before.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { ReplaceStep } from '@tiptap/pm/transform';
import { newDuplicateNumbers } from '../../utils/sceneNumbers';
import { paginationPluginKey, type PaginationState } from '../pagination';
import { REVISION_SKIP_META } from '../revisionMarks';
import {
  LOCKABLE_BLOCK_TYPES, LOCKED_PAGE_ATTR, LOCKED_PAGE_MID_ATTR, lockPlan, lockedPageOf,
} from '../../utils/lockedPages';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lockedPages: {
      /** Anchor every page where it starts now. `label` gives a page's
       *  printed number (the header's starting page number applied). */
      lockPages: (label: (page: number) => string) => ReturnType;
      /** Remove every anchor; pages renumber from the top. */
      unlockPages: () => ReturnType;
    };
  }
}

/** True when any block of `doc` carries a page anchor. */
export function pagesLocked(doc: PMNode): boolean {
  let found = false;
  doc.forEach((node) => {
    if (!found && lockedPageOf(node.attrs)) found = true;
  });
  return found;
}

/**
 * What a pasted slice must lose so it cannot pose as something it is not:
 *
 *  - every page anchor — a copied page-opening block would otherwise bring its
 *    page number with it and force a break wherever it was pasted;
 *  - a scene number the script already has — a copied heading is a new scene,
 *    and while numbers are locked it gets an A-number of its own
 *    (utils/sceneNumbers). A number the script no longer has stays: that is a
 *    scene cut and pasted somewhere else, and moving a scene keeps its number.
 *
 * `existingNumbers` is the scene numbers in the document being pasted into.
 */
export function stripPageAnchors(slice: Slice, existingNumbers: ReadonlySet<string> = new Set()): Slice {
  return new Slice(stripAnchors(slice.content, existingNumbers), slice.openStart, slice.openEnd);
}

/** Every scene number a document carries. */
export function sceneNumbersIn(doc: PMNode): Set<string> {
  const out = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === 'sceneHeading' && node.attrs.sceneNumber != null && node.attrs.sceneNumber !== '') {
      out.add(String(node.attrs.sceneNumber));
    }
    return node.type.name !== 'sceneHeading';
  });
  return out;
}

function stripAnchors(fragment: Fragment, existingNumbers: ReadonlySet<string>): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((node) => {
    const anchored = !!lockedPageOf(node.attrs);
    const num = node.type.name === 'sceneHeading' ? node.attrs.sceneNumber : null;
    const takenNumber = num != null && num !== '' && existingNumbers.has(String(num));
    if (anchored || takenNumber) {
      const attrs: Record<string, unknown> = { ...node.attrs };
      if (anchored) { attrs[LOCKED_PAGE_ATTR] = null; attrs[LOCKED_PAGE_MID_ATTR] = false; }
      if (takenNumber) attrs.sceneNumber = null;
      out.push(node.type.create(attrs, node.content, node.marks));
    } else {
      out.push(node);
    }
  });
  return Fragment.from(out);
}

export const LockedPages = Extension.create({
  name: 'lockedPages',

  addGlobalAttributes() {
    return [{
      types: LOCKABLE_BLOCK_TYPES,
      attributes: {
        [LOCKED_PAGE_ATTR]: {
          default: null,
          // Enter at the end of a page's first line must not anchor the new
          // line as the same page.
          keepOnSplit: false,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-locked-page') || null,
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs[LOCKED_PAGE_ATTR] ? { 'data-locked-page': String(attrs[LOCKED_PAGE_ATTR]) } : {},
        },
        [LOCKED_PAGE_MID_ATTR]: {
          default: false,
          keepOnSplit: false,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-locked-page-mid') === 'true',
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs[LOCKED_PAGE_MID_ATTR] ? { 'data-locked-page-mid': 'true' } : {},
        },
      },
    }];
  },

  addCommands() {
    return {
      lockPages: (label) => ({ state, tr, dispatch }) => {
        const ps = paginationPluginKey.getState(state) as PaginationState | undefined;
        if (!ps) return false;
        const plan = lockPlan(state.doc.childCount, ps.breaks, label);
        if (plan.length === 0) return false;
        if (dispatch) {
          // Clear any stale anchor first, so a relock starts clean.
          state.doc.forEach((node, offset) => {
            if (lockedPageOf(node.attrs)) {
              tr.setNodeAttribute(offset, LOCKED_PAGE_ATTR, null);
              tr.setNodeAttribute(offset, LOCKED_PAGE_MID_ATTR, false);
            }
          });
          const offsets: number[] = [];
          state.doc.forEach((_node, offset) => { offsets.push(offset); });
          for (const p of plan) {
            const node = state.doc.child(p.nodeIndex);
            if (!node.type.spec.attrs || !(LOCKED_PAGE_ATTR in node.type.spec.attrs)) {
              console.warn(`[lockedPages] a ${node.type.name} cannot carry a page anchor; page ${p.label} is not locked`);
              continue;
            }
            tr.setNodeAttribute(offsets[p.nodeIndex], LOCKED_PAGE_ATTR, p.label);
            tr.setNodeAttribute(offsets[p.nodeIndex], LOCKED_PAGE_MID_ATTR, p.mid);
          }
          tr.setMeta(REVISION_SKIP_META, true).setMeta('forceRepaginate', true);
          dispatch(tr);
        }
        return true;
      },
      unlockPages: () => ({ state, tr, dispatch }) => {
        if (!pagesLocked(state.doc)) return false;
        if (dispatch) {
          state.doc.forEach((node, offset) => {
            if (!lockedPageOf(node.attrs)) return;
            tr.setNodeAttribute(offset, LOCKED_PAGE_ATTR, null);
            tr.setNodeAttribute(offset, LOCKED_PAGE_MID_ATTR, false);
          });
          tr.setMeta(REVISION_SKIP_META, true).setMeta('forceRepaginate', true);
          dispatch(tr);
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('productionPaste'),
      // Enter in the middle of a line copies every attribute to both halves
      // (keepOnSplit only governs a split at the end). For a page's first
      // line the page would open twice; for a scene heading two scenes would
      // share a number. The first half is the original either way, so the
      // second loses the anchor and the number.
      appendTransaction: (trs, oldState, state) => {
        if (!trs.some((tr) => tr.docChanged)) return null;
        const seen = new Set<string>();
        let tr: Transaction | null = null;
        // A scene number an edit has just duplicated (a heading split with
        // Enter) comes off the later copy. Not for a load, nor for a
        // collaborator's steps — their own client does this for them.
        const local = !trs.some((t) => (t.getMeta('y-sync$') as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin);
        const wholeDoc = trs.some((t) => t.steps.some((s) => s instanceof ReplaceStep
          && (s as ReplaceStep).from === 0 && (s as ReplaceStep).to === t.before.content.size));
        if (local && !wholeDoc) {
          for (const pos of newDuplicateNumbers(oldState.doc, state.doc)) {
            tr = tr ?? state.tr;
            tr.setNodeAttribute(pos, 'sceneNumber', null);
          }
        }
        state.doc.forEach((node, offset) => {
          const a = lockedPageOf(node.attrs);
          if (!a) return;
          if (!seen.has(a.label)) { seen.add(a.label); return; }
          tr = tr ?? state.tr;
          tr.setNodeAttribute(offset, LOCKED_PAGE_ATTR, null);
          tr.setNodeAttribute(offset, LOCKED_PAGE_MID_ATTR, false);
        });
        return tr ? (tr as Transaction).setMeta(REVISION_SKIP_META, true) : null;
      },
      props: {
        // A copied page-opening block would otherwise bring its page number
        // with it and force a break wherever it was pasted.
        // A drag that moves text keeps its scene numbers — the source is still
        // in the document when this runs, so its own number would look taken.
        transformPasted: (slice, view) => stripPageAnchors(
          slice,
          view.dragging?.move ? new Set() : sceneNumbersIn(view.state.doc),
        ),
      },
    })];
  },
});

/**
 * Locked pages: once locked, a page's number never moves. Overflow becomes
 * 12A, 12B; a page whose text has gone is absorbed into "12-13".
 */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { JSONContent } from '@tiptap/react';
import { letterSuffix, lockedPageLabels, lockPlan, startPages, startsLockedPage } from './lockedPages';
import { computeBreaks, paginationPluginKey, createPaginationPlugin } from '../editor/pagination';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { testExtensions, block, doc } from '../test/screenplaySchema';
import { LockedPages, stripPageAnchors } from '../editor/extensions/LockedPages';
import { startsOwnPage } from './pageBreaks';

const schema = getSchema([...testExtensions, LockedPages]);
const pm = (json: JSONContent) => schema.nodeFromJSON(json);

describe('letterSuffix', () => {
  it('runs A–Z, then AA', () => {
    expect([1, 2, 26, 27, 28].map(letterSuffix)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });
});

describe('lockedPageLabels', () => {
  const a = (page: number, label: string, mid = false) => ({ page, label, mid });

  it('numbers pages straight through when nothing has moved', () => {
    expect(lockedPageLabels(3, [a(1, '1'), a(2, '2'), a(3, '3')])).toEqual(['1', '2', '3']);
  });

  it('gives overflow pages A, B after the page they spilled from', () => {
    expect(lockedPageLabels(5, [a(1, '1'), a(2, '2'), a(5, '3')])).toEqual(['1', '2', '2A', '2B', '3']);
  });

  it('runs the last page on with letters too', () => {
    expect(lockedPageLabels(4, [a(1, '1'), a(2, '2')])).toEqual(['1', '2', '2A', '2B']);
  });

  it('absorbs a page whose anchor is gone into the page before it', () => {
    // Page 3 was deleted outright: page 2 now stands for 2 and 3.
    expect(lockedPageLabels(3, [a(1, '1'), a(2, '2'), a(3, '4')])).toEqual(['1', '2-3', '4']);
  });

  it('hands a lost number back to the overflow before using letters', () => {
    // Page 3's first line was joined onto page 2, which now runs two pages.
    expect(lockedPageLabels(4, [a(1, '1'), a(2, '2'), a(4, '4')])).toEqual(['1', '2', '3', '4']);
    expect(lockedPageLabels(5, [a(1, '1'), a(2, '2'), a(5, '4')])).toEqual(['1', '2', '3', '3A', '4']);
  });

  it('labels pages before the first locked one A1, B1', () => {
    expect(lockedPageLabels(3, [a(3, '1')])).toEqual(['A1', 'B1', '1']);
  });

  it('ignores an anchor that would number a page backwards', () => {
    // 3 cannot follow 5, so it counts for nothing; 2-4 have no page of their own.
    expect(lockedPageLabels(3, [a(1, '1'), a(2, '5'), a(3, '3')])).toEqual(['1-4', '5', '5A']);
  });

  it('moves a mid-speech anchor on when its speech has fitted back', () => {
    expect(lockedPageLabels(3, [a(1, '1'), a(1, '2', true), a(3, '3')])).toEqual(['1', '2', '3']);
  });
});

describe('startPages and lockPlan', () => {
  const breaks = [
    { nodeIndex: 2, pageNumber: 1, isDialogueSplit: false, isTitlePage: true },
    { nodeIndex: 4, pageNumber: 2, isDialogueSplit: false, isTitlePage: false },
    { nodeIndex: 6, pageNumber: 3, isDialogueSplit: true, isTitlePage: false },
  ];

  it('puts the title region on page 0 and each node on the page it starts', () => {
    expect(startPages(8, breaks)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('anchors the first body node and every break, offset by the start number', () => {
    expect(lockPlan(8, breaks, (p) => String(p + 1))).toEqual([
      { nodeIndex: 2, label: '2', mid: false },
      { nodeIndex: 4, label: '3', mid: false },
      { nodeIndex: 6, label: '4', mid: true },
    ]);
  });
});

describe('pageBreaks honours anchors only where asked', () => {
  const node = { type: 'action', attrs: { lockedPage: '3', lockedPageMid: false } };
  it('editor and PDF (lockedPages) break; Word does not', () => {
    expect(startsLockedPage(node.attrs)).toBe(true);
    expect(startsOwnPage(node, new Set(), { lockedPages: true })).toBe(true);
    expect(startsOwnPage(node, new Set())).toBe(false);
  });
  it('a mid-speech anchor never forces a break', () => {
    expect(startsLockedPage({ lockedPage: '3', lockedPageMid: true })).toBe(false);
  });
});

/** Enough action to fill most of a page: 50 one-line blocks. */
const page = (tag: string, n = 50) => Array.from({ length: n }, (_, i) => block('action', `${tag} line ${i + 1}.`));

/** Lock a document exactly as Tools → Production → Lock Pages does. */
function lock(json: JSONContent): EditorState {
  let state = EditorState.create({
    schema,
    doc: pm(json),
    plugins: [createPaginationPlugin(() => {}, () => DEFAULT_PAGE_LAYOUT)],
  });
  const tr = state.tr;
  const ps = paginationPluginKey.getState(state);
  const plan = lockPlan(state.doc.childCount, ps.breaks, String);
  const offsets: number[] = [];
  state.doc.forEach((_n, off) => { offsets.push(off); });
  for (const p of plan) {
    tr.setNodeAttribute(offsets[p.nodeIndex], 'lockedPage', p.label);
    tr.setNodeAttribute(offsets[p.nodeIndex], 'lockedPageMid', p.mid);
  }
  state = state.apply(tr);
  return state;
}

describe('a locked script being edited', () => {
  const base = doc(...page('One', 120));
  const labelsOf = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

  it('paginates identically the moment it is locked', () => {
    const before = computeBreaks(pm(base), DEFAULT_PAGE_LAYOUT);
    const locked = lock(base);
    const after = computeBreaks(locked.doc, DEFAULT_PAGE_LAYOUT);
    expect(before.pageCount).toBeGreaterThan(3);
    expect(after.breaks.map((b) => b.nodeIndex)).toEqual(before.breaks.map((b) => b.nodeIndex));
    expect(after.pageLabels).toEqual(labelsOf(before.pageCount));
  });

  it('spills added text onto an A page and leaves the next page where it was', () => {
    const locked = lock(base);
    const pages = computeBreaks(locked.doc, DEFAULT_PAGE_LAYOUT).pageCount;
    // Twenty more blocks just after page 1's first line.
    const extra = page('Added', 20).map((b) => schema.nodeFromJSON(b));
    const grown = locked.apply(locked.tr.insert(locked.doc.child(0).nodeSize, extra)).doc;
    const result = computeBreaks(grown, DEFAULT_PAGE_LAYOUT);
    expect(result.pageLabels).toEqual(['1', '1A', ...labelsOf(pages).slice(1)]);
    // Page 2 still begins with the block it began with when locked.
    const page2 = result.breaks.find((b) => b.pageNumber === 3)!;
    expect(grown.child(page2.nodeIndex).attrs.lockedPage).toBe('2');
  });

  it('labels text added above page 1 A1', () => {
    const locked = lock(base);
    const extra = page('Above', 10).map((b) => schema.nodeFromJSON(b));
    const grown = locked.apply(locked.tr.insert(0, extra)).doc;
    expect(computeBreaks(grown, DEFAULT_PAGE_LAYOUT).pageLabels?.slice(0, 2)).toEqual(['A1', '1']);
  });

  it('absorbs a deleted page into the one before it', () => {
    const locked = lock(base);
    const before = computeBreaks(locked.doc, DEFAULT_PAGE_LAYOUT);
    // Delete everything on page 2.
    const cut = locked.apply(locked.tr.delete(before.breaks[0].offset, before.breaks[1].offset)).doc;
    expect(computeBreaks(cut, DEFAULT_PAGE_LAYOUT).pageLabels)
      .toEqual(['1-2', ...labelsOf(before.pageCount).slice(2)]);
  });

  it('has no labels at all when nothing is locked', () => {
    expect(computeBreaks(pm(base), DEFAULT_PAGE_LAYOUT).pageLabels).toBeUndefined();
  });

  it('strips page anchors from pasted content', () => {
    const locked = lock(base);
    const slice = locked.doc.slice(0, locked.doc.child(0).nodeSize);
    expect(slice.content.child(0).attrs.lockedPage).toBe('1');
    const pasted = stripPageAnchors(slice);
    expect(pasted.content.child(0).attrs.lockedPage).toBeNull();
    expect(pasted.content.child(0).textContent).toBe(slice.content.child(0).textContent);
  });

  it('strips a pasted heading of a scene number the script already has, but keeps a moved one', () => {
    const heading = (n: string) => schema.nodeFromJSON({ type: 'sceneHeading', attrs: { sceneNumber: n }, content: [{ type: 'text', text: 'INT. X' }] });
    const slice = new Slice(Fragment.from([heading('3'), heading('9')]), 0, 0);
    const pasted = stripPageAnchors(slice, new Set(['1', '2', '3']));
    expect(pasted.content.child(0).attrs.sceneNumber).toBeNull();
    expect(pasted.content.child(1).attrs.sceneNumber).toBe('9');
  });
});

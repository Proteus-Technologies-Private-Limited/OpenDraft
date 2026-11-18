import { describe, it, expect } from 'vitest';
import { computeBreaks, sceneStartPages, buildTemplateHints, type BreakInfo } from './pagination';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { block, doc, pmDoc } from '../test/screenplaySchema';

const brk = (nodeIndex: number, pageNumber: number, extra: Partial<BreakInfo> = {}): BreakInfo => ({
  nodeIndex, pageNumber, offset: 0, nodeSize: 0, linesOnPage: 0,
  isDialogueSplit: false, characterName: '', isTitlePage: false, ...extra,
});

describe('sceneStartPages', () => {
  const script = pmDoc(doc(
    block('sceneHeading', 'INT. KITCHEN - DAY'), // 0
    block('action', 'Coffee.'),                  // 1
    block('sceneHeading', 'EXT. YARD - DAY'),    // 2
    block('action', 'A long paragraph.'),        // 3
    block('sceneHeading', 'INT. CAR - NIGHT'),   // 4
  ));

  it('puts every scene on page 1 when nothing breaks', () => {
    expect(sceneStartPages(script, [])).toEqual([1, 1, 1]);
  });

  it('moves a heading that a break lands on to the new page', () => {
    expect(sceneStartPages(script, [brk(2, 2)])).toEqual([1, 2, 2]);
  });

  it('leaves a block that a break splits on the page it starts on', () => {
    // The action at index 3 runs from page 2 onto page 3; the next heading is on 3.
    expect(sceneStartPages(script, [brk(2, 2), brk(3, 3, { contentOffset: 40 })])).toEqual([1, 2, 3]);
  });

  it('treats a split dual-dialogue row as inside its block', () => {
    expect(sceneStartPages(script, [brk(4, 2, { dualRow: 3 })])).toEqual([1, 1, 1]);
  });

  it('numbers headings after the title page from 1, as the page does', () => {
    expect(sceneStartPages(script, [brk(2, 1, { isTitlePage: true }), brk(4, 2)])).toEqual([1, 1, 2]);
  });

  it('agrees with the real breaks of a forced-break template', () => {
    const tv = buildTemplateHints({ forceBreakBefore: ['sceneHeading'] });
    const { breaks } = computeBreaks(script, DEFAULT_PAGE_LAYOUT, tv);
    expect(sceneStartPages(script, breaks)).toEqual([1, 2, 3]);
  });
});

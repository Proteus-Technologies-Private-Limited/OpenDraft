import { describe, it, expect } from 'vitest';
import { computeBreaks, buildTemplateHints, getPageMetrics } from './pagination';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import { block, doc, pmDoc } from '../test/screenplaySchema';

/** Element ids that open their own page, as a TV template would declare them. */
const actBreaks = buildTemplateHints({ forceBreakBefore: ['newAct'] });

const breaksFor = (json: ReturnType<typeof doc>) =>
  computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT, actBreaks).breaks;

describe('forced page breaks before acts', () => {
  it('breaks before each act that follows content', () => {
    const b = breaksFor(doc(
      block('action', 'Opening action.'),
      block('newAct', 'ACT ONE'),
      block('action', 'Some action.'),
      block('newAct', 'ACT TWO'),
    ));
    expect(b.map((x) => x.nodeIndex)).toEqual([1, 3]);
  });

  it('does not open a blank page when the act is the first element', () => {
    const b = breaksFor(doc(
      block('newAct', 'ACT ONE'),
      block('action', 'Some action.'),
    ));
    expect(b).toHaveLength(0);
  });

  it('still breaks before the following act when the new act is empty', () => {
    // Inserting an act just before an existing one leaves it momentarily empty.
    // The act after it must stay on its own page rather than jumping back up.
    const b = breaksFor(doc(
      block('action', 'Opening action.'),
      block('newAct'),
      block('newAct', 'ACT TWO'),
    ));
    expect(b.map((x) => x.nodeIndex)).toEqual([1, 2]);
  });

  it('breaks between two consecutive empty acts', () => {
    const b = breaksFor(doc(
      block('action', 'Opening action.'),
      block('newAct'),
      block('newAct'),
    ));
    expect(b.map((x) => x.nodeIndex)).toEqual([1, 2]);
  });

  it('breaks before an act that directly follows a scene heading', () => {
    // A scene heading is grouped with the element after it so it is not left
    // orphaned at a page bottom. That grouping must not swallow an act, or the
    // act's forced break is skipped and every act lands on one page.
    const b = breaksFor(doc(
      block('newAct', 'ACT 1'),
      block('sceneHeading', 'SCENE 1'),
      block('newAct', 'ACT 2'),
      block('sceneHeading', 'SCENE 2'),
      block('newAct', 'ACT 3'),
      block('sceneHeading', 'SCENE 3'),
      block('action', 'This is action of act 3 and scene 3'),
    ));
    expect(b.map((x) => x.nodeIndex)).toEqual([2, 4]);
  });

  it('still groups a scene heading with an ordinary following element', () => {
    // The orphan protection itself must survive: with an action after it, the
    // heading keeps its partner and only the act breaks.
    const b = breaksFor(doc(
      block('newAct', 'ACT 1'),
      block('sceneHeading', 'SCENE 1'),
      block('action', 'Something happens.'),
      block('newAct', 'ACT 2'),
    ));
    expect(b.map((x) => x.nodeIndex)).toEqual([3]);
  });

  it('does not absorb a forced-break element into a dialogue block', () => {
    // Lyrics travel with a dialogue block, so the same swallowing risk applies
    // there as with scene headings.
    const b = computeBreaks(
      pmDoc(doc(
        block('character', 'JANE'),
        block('dialogue', 'Line one.'),
        block('lyrics', 'A song begins.'),
      )),
      DEFAULT_PAGE_LAYOUT,
      buildTemplateHints({ forceBreakBefore: ['lyrics'] }),
    ).breaks;
    expect(b.map((x) => x.nodeIndex)).toEqual([2]);
  });

  it('honours the manual per-element flag with no template rule', () => {
    const b = computeBreaks(
      pmDoc(doc(
        block('action', 'Opening action.'),
        { ...block('sceneHeading', 'INT. LAB - NIGHT'), attrs: { startsNewPage: true } },
      )),
      DEFAULT_PAGE_LAYOUT,
    ).breaks;
    expect(b.map((x) => x.nodeIndex)).toEqual([1]);
  });
});

describe('space before comes from the template', () => {
  /**
   * A page filled to the point where the scene heading's own spacing decides
   * whether it fits.
   *
   * The default A4 page holds 58 lines. 27 action blocks cost 53 (the first
   * gets no space before, the other 26 cost 2 each) and the General adds 1 more
   * with no space of its own — 54 used, 4 left. The heading is grouped with the
   * action after it so it is not orphaned at the page foot, so the group needs
   * `space + 1` for the heading plus 2 for the action.
   *
   * At two blank lines that is 5 and the group moves to the next page; at one it
   * is 4 and it stays. This document is exactly the difference between the old
   * default and the standard, which is what makes it worth pinning.
   */
  const atTheSpacingBoundary = () => doc(
    ...Array.from({ length: 27 }, (_, i) => block('action', `Line ${i}.`)),
    block('general', 'x'),
    block('sceneHeading', 'INT. LAB - DAY'),
    block('action', 'After.'),
  );

  it('holds 58 lines on the default page', () => {
    expect(getPageMetrics(DEFAULT_PAGE_LAYOUT).linesPerPage).toBe(58);
  });

  it('gives a scene heading two blank lines by default', () => {
    const b = computeBreaks(pmDoc(atTheSpacingBoundary()), DEFAULT_PAGE_LAYOUT).breaks;
    expect(b.map((x) => x.nodeIndex)).toEqual([28]);
  });

  it('lets a template shrink the spacing back to one line', () => {
    const oneLine = buildTemplateHints({ rules: { sceneHeading: { marginTop: 12 } } });
    const b = computeBreaks(pmDoc(atTheSpacingBoundary()), DEFAULT_PAGE_LAYOUT, oneLine).breaks;
    expect(b).toHaveLength(0);
  });

  it('lets a template widen the spacing', () => {
    const body = () => doc(...Array.from({ length: 26 }, (_, i) => block('action', `Line ${i}.`)));
    const wide = buildTemplateHints({ rules: { action: { marginTop: 24 } } });
    const tight = computeBreaks(pmDoc(body()), DEFAULT_PAGE_LAYOUT).breaks;
    const loose = computeBreaks(pmDoc(body()), DEFAULT_PAGE_LAYOUT, wide).breaks;
    // Same document, more space per element — so it needs more pages.
    expect(loose.length).toBeGreaterThan(tight.length);
  });
});

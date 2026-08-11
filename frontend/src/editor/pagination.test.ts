import { describe, it, expect } from 'vitest';
import { computeBreaks, buildTemplateHints } from './pagination';
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

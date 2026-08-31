/**
 * The Title Page dialog's own layout builder.
 *
 * It is a second copy of `utils/titlePageBlocks.ts` — the dialog's version also
 * handles images and keeps the writer's marks — and the two drifted: the shared
 * one returned nothing for empty fields, this one did not. Clearing every field
 * and pressing Apply therefore replaced the title page with the ~15 blank
 * spacer nodes and the empty title node that its layout arithmetic produces.
 * Those carry no text and no attributes, so `findTitlePageRegion` reports the
 * region as not real, the paginator gives it zero length, and the whole run
 * lands at the top of page 1 as a block of empty lines: the title page gone,
 * its whitespace left behind (reported on iPhone, real everywhere).
 *
 * These pin the emptiness rule on the dialog's copy until the two converge.
 */
import { describe, it, expect } from 'vitest';
import { testSchema } from '../test/screenplaySchema';
import { findTitlePageRegion, titlePageAttrsCarryData } from './titlePageRegion';
import { buildTitlePageBlocks, type TitlePageBuildSource } from './titlePageDialogBlocks';

const EMPTY = {
  tpTitle: '', tpCredit: '', tpWrittenBy: '', tpBasedOn: '', tpDraft: '',
  tpDraftDate: '', tpContact: '', tpCopyright: '', tpWgaRegistration: '',
  tpNotes: '', tpTitleFontSize: 12,
};

/** An editor holding nothing but a blank body line. */
const source = (): TitlePageBuildSource => ({
  state: {
    schema: testSchema,
    doc: testSchema.nodes.doc.create(null, testSchema.nodes.action.create()),
  },
});

const build = (data: Partial<typeof EMPTY>) =>
  buildTitlePageBlocks(source(), { ...EMPTY, ...data }, [], [], 58);

/** The region the built run resolves to, the way the app resolves it. */
const regionOf = (blocks: ReturnType<typeof build>) =>
  findTitlePageRegion(
    blocks.map((node) => ({
      type: node.type.name,
      hasText: node.textContent.trim().length > 0,
      hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown>),
    })),
  );

describe("the dialog's buildTitlePageBlocks", () => {
  it('lays out a title page from the fields the writer entered', () => {
    const blocks = build({ tpTitle: 'THE LONG GOODBYE', tpWrittenBy: 'R. Chandler' });
    expect(regionOf(blocks)).toEqual({ length: blocks.length, isReal: true });
  });

  it('builds nothing once every field is cleared', () => {
    expect(build({})).toEqual([]);
  });

  it('leaves no blank spacers behind when the last field is cleared', () => {
    // The bug: emptying the fields still emitted the spacer run, which the
    // resolver rejects as a title page and the paginator then prints as a gap
    // above the first scene.
    const blocks = build({});
    expect(blocks.filter((n) => n.attrs.field === 'blank')).toHaveLength(0);
    expect(regionOf(blocks)).toEqual({ length: 0, isReal: false });
  });

  it('still lays out a page for a credit alone, with no title', () => {
    expect(build({ tpWrittenBy: 'R. Chandler' }).length).toBeGreaterThan(0);
  });

  it('treats whitespace-only fields as empty', () => {
    expect(build({ tpTitle: '   ', tpNotes: '\n ' })).toEqual([]);
  });
});

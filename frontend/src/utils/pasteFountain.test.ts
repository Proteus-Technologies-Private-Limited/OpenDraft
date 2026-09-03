/**
 * Paste as Fountain used to insert *everything* as blocks, including a scrap
 * of ordinary prose that Fountain only calls Action because Action is its
 * default. With the caret inside `EXT. CARGO| SHIP - PIER 3 - INTERCUT` that
 * split the heading in three (issue #109). These cover the line between text
 * the writer typed and structure the writer marked up.
 */
import { describe, it, expect } from 'vitest';
import { planFountainInsert } from './pasteFountain';

describe('planFountainInsert — plain text goes in at the caret', () => {
  it('offers a single unmarked line as inline text', () => {
    const plan = planFountainInsert('Across the yard');
    expect(plan?.inline).toEqual([{ type: 'text', text: 'Across the yard' }]);
  });

  it('still parses that line as Action for anywhere inline cannot land', () => {
    expect(planFountainInsert('Across the yard')?.blocks).toEqual([
      { type: 'action', content: [{ type: 'text', text: 'Across the yard' }] },
    ]);
  });

  it('keeps emphasis on inline text', () => {
    const plan = planFountainInsert('a *whispered* word');
    expect(plan?.inline).toHaveLength(3);
    expect(plan?.inline?.[1]).toMatchObject({
      text: 'whispered',
      marks: [{ type: 'italic' }],
    });
  });

  it('ignores blank lines around the text', () => {
    expect(planFountainInsert('\n\nAcross the yard\n\n')?.inline).toEqual([
      { type: 'text', text: 'Across the yard' },
    ]);
  });

  it('has nothing to insert for empty or blank text', () => {
    expect(planFountainInsert('')).toBeNull();
    expect(planFountainInsert('   \n  ')).toBeNull();
  });
});

describe('planFountainInsert — structure keeps its own blocks', () => {
  const staysBlocks = (label: string, text: string) =>
    it(label, () => {
      const plan = planFountainInsert(text);
      expect(plan?.inline).toBeUndefined();
      expect(plan?.blocks.length).toBeGreaterThan(0);
    });

  staysBlocks('a scene heading', 'INT. KITCHEN - DAY');
  staysBlocks('a forced scene heading', '.PIER 3');
  staysBlocks('a transition', 'CUT TO:');
  staysBlocks('a forced transition', '> SMASH CUT:');
  staysBlocks('a section', '# Act One');
  staysBlocks('lyrics', '~ and the band played on');
  staysBlocks('a character cue with dialogue', 'SAM\nWe should go.');
  staysBlocks('two lines of action', 'Across the yard.\n\nA gull lands.');
  staysBlocks('a title page', 'Title: Cargo\nAuthor: Alex Example');

  it('honours a forced Action line as a block of its own', () => {
    // `!` is the writer saying "make this Action", so it gets an Action block
    // even though what is left after the marker is one plain line.
    const plan = planFountainInsert('!Across the yard');
    expect(plan?.inline).toBeUndefined();
    expect(plan?.blocks).toEqual([
      { type: 'action', content: [{ type: 'text', text: 'Across the yard' }] },
    ]);
  });

  it('keeps centred text as a block, since the centring is structure', () => {
    const plan = planFountainInsert('>THE END<');
    expect(plan?.inline).toBeUndefined();
    expect(plan?.blocks[0]).toMatchObject({ attrs: { textAlign: 'center' } });
  });

  it('keeps a page break with the line it applies to', () => {
    const plan = planFountainInsert('===\nAcross the yard');
    expect(plan?.inline).toBeUndefined();
    expect(plan?.blocks[0]).toMatchObject({ attrs: { startsNewPage: true } });
  });
});

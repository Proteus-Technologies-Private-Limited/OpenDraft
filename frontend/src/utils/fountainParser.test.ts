import { describe, it, expect } from 'vitest';
import { parseFountain } from './fountainParser';
import { exportFountain } from './fountainExporter';

interface Node {
  type: string;
  content?: Node[];
  text?: string;
  marks?: { type: string }[];
  attrs?: Record<string, unknown>;
}

const parse = (text: string) => parseFountain(text).content as Node[];

/** [text, marks] for each run of a block, hard breaks as ['\n', []]. */
function runs(node: Node): [string, string[]][] {
  return (node.content ?? []).map((run) =>
    run.type === 'hardBreak'
      ? ['\n', [] as string[]]
      : [run.text ?? '', (run.marks ?? []).map((m) => m.type)],
  );
}

const textOf = (node: Node) => runs(node).map(([t]) => t).join('');

describe('parseFountain — inline emphasis', () => {
  it('reads *italic*, **bold**, ***both*** and _underline_', () => {
    const [node] = parse('She was *quiet*, then **loud**, then ***both***, and _sure_.');

    expect(runs(node)).toEqual([
      ['She was ', []],
      ['quiet', ['italic']],
      [', then ', []],
      ['loud', ['bold']],
      [', then ', []],
      ['both', ['bold', 'italic']],
      [', and ', []],
      ['sure', ['underline']],
      ['.', []],
    ]);
  });

  it('keeps nested emphasis inside a bold run', () => {
    const [node] = parse('**Bold with *italic* inside**');

    expect(runs(node)).toEqual([
      ['Bold with ', ['bold']],
      ['italic', ['bold', 'italic']],
      [' inside', ['bold']],
    ]);
  });

  it('honours a backslash-escaped delimiter', () => {
    const [node] = parse('A literal \\*asterisk\\* stays put.');

    expect(runs(node)).toEqual([['A literal *asterisk* stays put.', []]]);
  });

  it('leaves an unpaired delimiter as a character', () => {
    const [node] = parse('The cost was 5 * 3 dollars, maybe *more');

    expect(textOf(node)).toBe('The cost was 5 * 3 dollars, maybe *more');
    expect(node.content?.every((r) => !r.marks)).toBe(true);
  });

  it('does not treat a delimiter followed by a space as emphasis', () => {
    const [node] = parse('Stars * everywhere * tonight');
    expect(runs(node)).toEqual([['Stars * everywhere * tonight', []]]);
  });

  it('round-trips emphasis through the Fountain exporter', () => {
    const source = 'She was *quiet* and **certain**.';
    const doc = parseFountain(source);

    expect(exportFountain(doc).trim()).toBe(source);
  });
});

describe('parseFountain — forced elements', () => {
  it('forces action with a leading !, overriding the character heuristic', () => {
    const [node] = parse('\n!THE SIGN READS: NO ENTRY\n');

    expect(node.type).toBe('action');
    expect(textOf(node)).toBe('THE SIGN READS: NO ENTRY');
  });

  it('reads a leading ~ as lyrics', () => {
    const nodes = parse('~Somewhere over the rainbow');

    expect(nodes[0].type).toBe('lyrics');
    expect(textOf(nodes[0])).toBe('Somewhere over the rainbow');
  });

  it('reads lyrics inside a dialogue block', () => {
    const nodes = parse('\nSINGER\n~Way up high\n');

    expect(nodes.map((n) => n.type)).toEqual(['character', 'lyrics']);
  });

  it('centres >text< and strips the markers', () => {
    const [node] = parse('>THE END<');

    expect(node.type).toBe('action');
    expect(node.attrs).toEqual({ textAlign: 'center' });
    expect(textOf(node)).toBe('THE END');
  });

  it('still reads a bare > as a forced transition', () => {
    const [node] = parse('> BURN TO WHITE');

    expect(node.type).toBe('transition');
    expect(textOf(node)).toBe('BURN TO WHITE');
  });

  it('marks the element after === as starting a new page', () => {
    const nodes = parse('Some action.\n\n===\n\nINT. LAB - NIGHT');

    expect(nodes[0].attrs).toBeUndefined();
    expect(nodes[1].type).toBe('sceneHeading');
    expect(nodes[1].attrs).toEqual({ startsNewPage: true });
  });

  it('does not confuse === with a synopsis line', () => {
    const nodes = parse('INT. LAB - NIGHT\n\n= A quiet scene.');

    expect(nodes).toHaveLength(1);
    expect(nodes[0].attrs).toEqual({ synopsis: 'A quiet scene.' });
  });
});

describe('parseFountain — regression', () => {
  it('still parses a plain scene', () => {
    const nodes = parse(
      ['INT. KITCHEN - DAY', '', 'Anna makes coffee.', '', 'ANNA', '(tired)', 'Morning.', '', 'CUT TO:'].join('\n'),
    );

    expect(nodes.map((n) => n.type)).toEqual([
      'sceneHeading',
      'action',
      'character',
      'parenthetical',
      'dialogue',
      'transition',
    ]);
  });

  it('still pairs Fountain dual dialogue on the second speaker', () => {
    const nodes = parse(['ANNA', 'Go.', '', 'BEN ^', 'Now.'].join('\n'));

    expect(nodes.map((n) => n.type)).toEqual(['dualDialogue']);
    const [left, right] = nodes[0].content as Node[];
    expect((left.content as Node[]).map(textOf)).toEqual(['ANNA', 'Go.']);
    expect((right.content as Node[]).map(textOf)).toEqual(['BEN', 'Now.']);
  });

  it('returns a single empty action for empty input', () => {
    expect(parse('')).toEqual([{ type: 'action', content: [] }]);
  });
});

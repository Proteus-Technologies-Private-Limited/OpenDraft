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

/**
 * "Paste as Fountain" feeds this parser whatever the clipboard hands over, and
 * a clipboard is not a file: an iPad paste can arrive with lone carriage
 * returns or Unicode separators instead of newlines, and rich text flattened
 * to plain text arrives single-spaced. Every one of those used to come out as
 * Action — nothing split, or nothing had the blank line a cue is recognised by.
 */
describe('parseFountain — clipboard text', () => {
  const SCENE = [
    'INT. KITCHEN - DAY',
    '',
    'Anna makes coffee.',
    '',
    'ANNA',
    '(tired)',
    'Morning.',
    '',
    'CUT TO:',
  ].join('\n');

  const EXPECTED = [
    'sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'transition',
  ];

  it.each([
    ['carriage returns', SCENE.replace(/\n/g, '\r')],
    ['CRLF', SCENE.replace(/\n/g, '\r\n')],
    ['Unicode line separators', SCENE.replace(/\n/g, '\u2028')],
    ['Unicode paragraph separators', SCENE.replace(/\n/g, '\u2029')],
    ['a byte order mark', `\uFEFF${SCENE}`],
  ])('reads a scene delimited by %s', (_label, text) => {
    expect(parse(text).map((n) => n.type)).toEqual(EXPECTED);
  });

  it('reads cues and dialogue out of single-spaced text', () => {
    const nodes = parse(SCENE.replace(/\n\n/g, '\n'));

    expect(nodes.map((n) => n.type)).toEqual(EXPECTED);
    expect(nodes.map(textOf)).toEqual([
      'INT. KITCHEN - DAY', 'Anna makes coffee.', 'ANNA', '(tired)', 'Morning.', 'CUT TO:',
    ]);
  });

  it('ends a single-spaced dialogue block at the next element', () => {
    const nodes = parse(['ANNA', 'Morning.', 'INT. HALL - DAY', 'Ben waits.'].join('\n'));

    expect(nodes.map((n) => n.type)).toEqual(['character', 'dialogue', 'sceneHeading', 'action']);
  });

  it('keeps consecutive dialogue lines in a single-spaced block', () => {
    const nodes = parse(['ANNA', 'Morning.', 'Sleep well?', 'BEN', 'Not really.'].join('\n'));

    expect(nodes.map((n) => n.type)).toEqual(['character', 'dialogue', 'dialogue', 'character', 'dialogue']);
  });

  it('leaves an all-caps sentence as Action in single-spaced text', () => {
    const nodes = parse(['Ben waits.', 'THE DOOR SLAMS SHUT.', 'Anna is gone.'].join('\n'));

    expect(nodes.map((n) => n.type)).toEqual(['action', 'action', 'action']);
  });

  it.each([
    ['a trailing newline', `${'INT. KITCHEN - DAY\nAnna makes coffee.\nANNA\n(tired)\nMorning.\nCUT TO:'}\n`],
    ['a leading newline', `\n${'INT. KITCHEN - DAY\nAnna makes coffee.\nANNA\n(tired)\nMorning.\nCUT TO:'}`],
  ])('still reads single-spaced text with %s', (_label, text) => {
    // `split` leaves an empty element for the newline clipboard text almost
    // always ends with. Counted as a blank line, it turned the single-spaced
    // rule off for the most ordinary paste there is.
    expect(parse(text).map((n) => n.type)).toEqual(EXPECTED);
  });

  it('leaves FADE IN: as Action at the top of single-spaced text', () => {
    const nodes = parse(['FADE IN:', 'INT. KITCHEN - DAY', 'Anna makes coffee.', 'ANNA', 'Morning.'].join('\n'));

    expect(nodes.map((n) => n.type)).toEqual(['action', 'sceneHeading', 'action', 'character', 'dialogue']);
  });

  it('does not make a cue of an all-caps line with a scene heading under it', () => {
    const nodes = parse(['ANNA', 'INT. HALL - DAY', 'Ben waits.'].join('\n'));

    expect(nodes.map((n) => n.type)).toEqual(['action', 'sceneHeading', 'action']);
  });

  it('does not read a cue by shape once the text has blank lines', () => {
    const nodes = parse(['Ben waits.', '', 'Anna arrives.', 'ANNA IS HERE', 'She waves.'].join('\n'));

    expect(nodes.map((n) => n.type)).toEqual(['action', 'action', 'action', 'action']);
  });
});

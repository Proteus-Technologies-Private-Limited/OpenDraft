/**
 * Fountain's non-printing structure: Sections, Synopses, Notes and the
 * boneyard.
 *
 * All four are in the spec and none of them was implemented, so each arrived as
 * a line of Action — `# ACT ONE` printed in the middle of the script, `[[ ]]`
 * brackets in the middle of a scene, commented-out text uncommented. Issue #82
 * reported the first of them after the paste parser itself was fixed.
 */
import { describe, it, expect } from 'vitest';
import { parseFountain } from './fountainParser';
import { exportFountain } from './fountainExporter';
import { computeScriptStructure } from './scriptStructure';
import { doc, block } from '../test/screenplaySchema';
import type { JSONContent } from '@tiptap/react';

interface Node {
  type: string;
  content?: { type: string; text?: string }[];
  attrs?: Record<string, unknown>;
}

const parse = (text: string) => parseFountain(text).content as Node[];
const types = (nodes: Node[]) => nodes.map((n) => n.type);
const textOf = (node: Node) => (node.content ?? []).map((c) => c.text ?? '\n').join('');

describe('parseFountain — sections', () => {
  it('reads a single hash as a level 1 section, not Action', () => {
    const [node] = parse('# ACT ONE\n');
    expect(node.type).toBe('section');
    expect(textOf(node)).toBe('ACT ONE');
    expect(node.attrs?.level).toBe(1);
  });

  it('keeps the depth of a nested section', () => {
    const nodes = parse('# ACT ONE\n\n## Sequence A\n\n### Beat one\n');
    expect(types(nodes)).toEqual(['section', 'section', 'section']);
    expect(nodes.map((n) => n.attrs?.level)).toEqual([1, 2, 3]);
  });

  it('clamps a depth past the deepest level the schema holds', () => {
    const [node] = parse('######## Very deep\n');
    expect(node.type).toBe('section');
    expect(node.attrs?.level).toBe(6);
  });

  it('reads a section with no title', () => {
    const [node] = parse('#\n');
    expect(node.type).toBe('section');
    expect(textOf(node)).toBe('');
  });

  it('does not swallow the scene under a section', () => {
    const nodes = parse('# ACT ONE\n\nINT. HOUSE - DAY\n\nSam waits.\n');
    expect(types(nodes)).toEqual(['section', 'sceneHeading', 'action']);
  });

  it('ends a dialogue block at a section', () => {
    const nodes = parse('SAM\nI am done.\n# ACT TWO\n');
    expect(types(nodes)).toEqual(['character', 'dialogue', 'section']);
  });

  it('leaves an all-caps section out of the character heuristic', () => {
    // `# SAM` is a section however much its text looks like a cue.
    const nodes = parse('Sam waits.\n\n# SAM\n\nHe waits some more.\n');
    expect(types(nodes)).toEqual(['action', 'section', 'action']);
  });
});

describe('parseFountain — synopses', () => {
  it('files a synopsis on the scene heading above it', () => {
    const nodes = parse('INT. HOUSE - DAY\n\n= Sam finally asks.\n\nSam waits.\n');
    expect(types(nodes)).toEqual(['sceneHeading', 'action']);
    expect(nodes[0].attrs?.synopsis).toBe('Sam finally asks.');
  });

  it('files a synopsis on a section', () => {
    const nodes = parse('# ACT ONE\n\n= Everything goes wrong.\n');
    expect(types(nodes)).toEqual(['section']);
    expect(nodes[0].attrs?.synopsis).toBe('Everything goes wrong.');
  });

  it('reaches back past other elements, since the spec allows one anywhere', () => {
    const nodes = parse('INT. HOUSE - DAY\n\nSam waits.\n\n= He is still waiting.\n');
    expect(types(nodes)).toEqual(['sceneHeading', 'action']);
    expect(nodes[0].attrs?.synopsis).toBe('He is still waiting.');
  });

  it('keeps several synopsis lines under one heading', () => {
    const nodes = parse('INT. HOUSE - DAY\n\n= One.\n= Two.\n');
    expect(nodes[0].attrs?.synopsis).toBe('One.\nTwo.');
  });

  it('keeps a synopsis with nothing above it off the page as a note', () => {
    const nodes = parse('= Nothing to file this on.\n\nSam waits.\n');
    expect(types(nodes)).toEqual(['note', 'action']);
  });

  it('still reads === as a page break, not a synopsis', () => {
    const nodes = parse('Before.\n\n===\n\nAfter.\n');
    expect(types(nodes)).toEqual(['action', 'action']);
    expect(nodes[1].attrs?.startsNewPage).toBe(true);
  });

  it('leaves == as Action', () => {
    const nodes = parse('Sam waits.\n\n== not a synopsis\n');
    expect(types(nodes)).toEqual(['action', 'action']);
  });
});

describe('parseFountain — notes', () => {
  it('lifts a standalone note out as its own non-printing block', () => {
    const nodes = parse('Sam waits.\n\n[[ check the timeline ]]\n\nHe leaves.\n');
    expect(types(nodes)).toEqual(['action', 'note', 'action']);
    expect(textOf(nodes[1])).toBe('check the timeline');
  });

  it('takes an inline note out of the line it sat in', () => {
    const nodes = parse('Sam waits [[ how long? ]] by the door.\n');
    expect(types(nodes)).toEqual(['action', 'note']);
    expect(textOf(nodes[0])).toBe('Sam waits  by the door.');
    expect(textOf(nodes[1])).toBe('how long?');
  });

  it('folds a note that runs over several lines', () => {
    const nodes = parse('Sam waits.\n\n[[ this note\nruns on ]]\n\nHe leaves.\n');
    expect(types(nodes)).toEqual(['action', 'note', 'action']);
    expect(textOf(nodes[1])).toBe('this note runs on');
  });

  it('does not let a note between a cue and its dialogue break the block', () => {
    // The note's line is removed rather than blanked: a blank line here would
    // end the dialogue block and drop the speech out as Action.
    const nodes = parse('Sam waits.\n\nSAM\n[[ shouted? ]]\nGet out.\n');
    expect(types(nodes)).toEqual(['action', 'character', 'dialogue', 'note']);
    expect(textOf(nodes[2])).toBe('Get out.');
  });
});

describe('parseFountain — boneyard', () => {
  it('removes a commented-out block', () => {
    const nodes = parse('Sam waits.\n\n/*\nHe does not leave.\n*/\n\nHe leaves.\n');
    expect(types(nodes)).toEqual(['action', 'action']);
    expect(textOf(nodes[1])).toBe('He leaves.');
  });

  it('does not weld the lines either side of a multi-line boneyard', () => {
    const nodes = parse('INT. HOUSE - DAY\n/* cut this\nand this */\nSam waits.\n');
    expect(types(nodes)).toEqual(['sceneHeading', 'action']);
    expect(textOf(nodes[1])).toBe('Sam waits.');
  });

  it('removes a boneyard inside a line', () => {
    const [node] = parse('Sam waits /* for now */ by the door.\n');
    expect(textOf(node)).toBe('Sam waits  by the door.');
  });

  it('leaves an unterminated marker as literal text', () => {
    const [node] = parse('Sam does 3 /* 4 in his head.\n');
    expect(textOf(node)).toContain('/*');
  });
});

describe('parseFountain — dialogue continuation', () => {
  it('keeps a block alive across the two-space intentional blank line', () => {
    // This is exactly what exportFountain writes for a paragraph break inside
    // dialogue, so without it a `.fountain` saved by OpenDraft and reopened lost
    // every line of a speech after its first break.
    const nodes = parse('SAM\nOne.\n  \nTwo.\n');
    expect(types(nodes)).toEqual(['character', 'dialogue', 'dialogue', 'dialogue']);
    expect(textOf(nodes[3])).toBe('Two.');
  });

  it('still ends the block at a genuinely blank line', () => {
    const nodes = parse('SAM\nOne.\n\nSam leaves.\n');
    expect(types(nodes)).toEqual(['character', 'dialogue', 'action']);
  });
});

describe('exportFountain — non-printing structure', () => {
  it('writes a section with its hashes', () => {
    const out = exportFountain(doc({ ...block('section', 'ACT ONE'), attrs: { level: 1 } }));
    expect(out).toContain('# ACT ONE');
  });

  it('writes the depth a nested section carries', () => {
    const out = exportFountain(doc({ ...block('section', 'Sequence A'), attrs: { level: 3 } }));
    expect(out).toContain('### Sequence A');
  });

  it('writes a note in double brackets', () => {
    const out = exportFountain(doc(block('note', 'check this')));
    expect(out).toContain('[[check this]]');
  });

  it('writes each synopsis line with its own = sign', () => {
    const out = exportFountain(
      doc({ ...block('sceneHeading', 'INT. HOUSE - DAY'), attrs: { synopsis: 'One.\nTwo.' } }),
    );
    expect(out).toContain('= One.\n= Two.');
  });

  it('forces an Action line that opens with a hash', () => {
    const out = exportFountain(doc(block('action', '#1 on the call sheet.')));
    expect(out).toContain('!#1 on the call sheet.');
  });

  it('forces an Action line carrying a note marker', () => {
    expect(exportFountain(doc(block('action', 'He said [[sic]].')))).toContain('!He said [[sic]].');
  });

  it('needs no force for a boneyard marker — the asterisk is already escaped', () => {
    const out = exportFountain(doc(block('action', 'A 2/*3 split.')));
    expect(out).toContain('A 2/\\*3 split.');
    expect(out).not.toContain('/*');
  });
});

describe('Fountain round trip: structure', () => {
  const roundTrip = (d: JSONContent) => parseFountain(exportFountain(d)).content as Node[];

  it('keeps a section a section, at its level', () => {
    const out = roundTrip(doc(
      { ...block('section', 'ACT ONE'), attrs: { level: 1 } },
      { ...block('section', 'Sequence A'), attrs: { level: 2 } },
      block('sceneHeading', 'INT. HOUSE - DAY'),
      block('action', 'Sam waits.'),
    ));
    expect(types(out)).toEqual(['section', 'section', 'sceneHeading', 'action']);
    expect(out.map((n) => n.attrs?.level)).toEqual([1, 2, undefined, undefined]);
  });

  it('keeps a note a note', () => {
    const out = roundTrip(doc(block('action', 'Sam waits.'), block('note', 'check this')));
    expect(types(out)).toEqual(['action', 'note']);
    expect(textOf(out[1])).toBe('check this');
  });

  it('keeps a scene synopsis on its heading', () => {
    const out = roundTrip(doc(
      { ...block('sceneHeading', 'INT. HOUSE - DAY'), attrs: { synopsis: 'Sam asks.' } },
      block('action', 'Sam waits.'),
    ));
    expect(out[0].attrs?.synopsis).toBe('Sam asks.');
  });

  it('keeps centred Action centred', () => {
    const out = roundTrip(doc({ ...block('action', 'THE END'), attrs: { textAlign: 'center' } }));
    expect(types(out)).toEqual(['action']);
    expect(out[0].attrs?.textAlign).toBe('center');
    expect(textOf(out[0])).toBe('THE END');
  });

  it('keeps an Action line that opens with a hash out of the outline', () => {
    const out = roundTrip(doc(block('action', '#1 on the call sheet.')));
    expect(types(out)).toEqual(['action']);
    expect(textOf(out[0])).toBe('#1 on the call sheet.');
  });

  it('keeps a speech that spans several dialogue blocks together', () => {
    // The Fountain parser makes one dialogue node per line, so a speech read in
    // and written back out is several nodes. A blank line between them would
    // end the block and drop everything after the first line to Action.
    const out = roundTrip(doc(
      block('character', 'SAM'),
      block('dialogue', 'One.'),
      block('dialogue', 'Two.'),
    ));
    expect(types(out)).toEqual(['character', 'dialogue', 'dialogue']);
    expect(textOf(out[2])).toBe('Two.');
  });

  it('does not lose the rest of a speech after a paragraph break', () => {
    const out = roundTrip(doc(
      block('character', 'SAM'),
      block('dialogue', 'One.'),
      block('dialogue', ''),
      block('dialogue', 'Two.'),
    ));
    expect(types(out)).toEqual(['character', 'dialogue', 'dialogue', 'dialogue']);
    expect(textOf(out[3])).toBe('Two.');
  });
});

describe('computeScriptStructure — section outline', () => {
  it('nests sections by their level', () => {
    const structure = computeScriptStructure(doc(
      { ...block('section', 'ACT ONE'), attrs: { level: 1 } },
      { ...block('section', 'Sequence A'), attrs: { level: 2 } },
      { ...block('section', 'ACT TWO'), attrs: { level: 1 } },
    ));
    expect(structure.totalSections).toBe(3);
    expect(structure.sections.map((s) => s.title)).toEqual(['ACT ONE', 'ACT TWO']);
    expect(structure.sections[0].children.map((s) => s.title)).toEqual(['Sequence A']);
  });

  it('holds an outline that skips a level', () => {
    const structure = computeScriptStructure(doc(
      { ...block('section', 'Top'), attrs: { level: 1 } },
      { ...block('section', 'Deep'), attrs: { level: 3 } },
    ));
    expect(structure.sections).toHaveLength(1);
    expect(structure.sections[0].children.map((s) => s.level)).toEqual([3]);
  });

  it('files each scene under the section it sits below', () => {
    const structure = computeScriptStructure(doc(
      { ...block('section', 'ACT ONE'), attrs: { level: 1 } },
      block('sceneHeading', 'INT. HOUSE - DAY'),
      { ...block('section', 'ACT TWO'), attrs: { level: 1 } },
      block('sceneHeading', 'EXT. STREET - NIGHT'),
    ));
    expect(structure.sections[0].scenes.map((s) => s.heading)).toEqual(['INT. HOUSE - DAY']);
    expect(structure.sections[1].scenes.map((s) => s.heading)).toEqual(['EXT. STREET - NIGHT']);
  });

  it('leaves acts alone — a section is not an act break', () => {
    const structure = computeScriptStructure(doc(
      { ...block('section', 'ACT ONE'), attrs: { level: 1 } },
      block('sceneHeading', 'INT. HOUSE - DAY'),
    ));
    expect(structure.acts.filter((a) => a.actNumber > 0)).toHaveLength(0);
  });

  it('reports no outline for a script without sections', () => {
    const structure = computeScriptStructure(doc(block('sceneHeading', 'INT. HOUSE - DAY')));
    expect(structure.sections).toEqual([]);
    expect(structure.totalSections).toBe(0);
  });
});

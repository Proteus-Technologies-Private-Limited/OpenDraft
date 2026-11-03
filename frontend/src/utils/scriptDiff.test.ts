import { describe, it, expect } from 'vitest';
import { computeScriptDiff } from './scriptDiff';
import { doc, block, BR } from '../test/screenplaySchema';

const types = (a: ReturnType<typeof doc>, b: ReturnType<typeof doc>) =>
  computeScriptDiff(a, b).blocks.map((blk) => blk.type);

describe('scriptDiff with hard breaks', () => {
  it('REGRESSION: reports a change when only the break position moved', () => {
    // Before the fix, text extraction dropped hardBreak entirely, so both
    // revisions flattened to the identical string "onetwothree" and the diff
    // claimed nothing had changed.
    const a = doc(block('action', 'one', BR, 'two three'));
    const b = doc(block('action', 'one two', BR, 'three'));
    const result = computeScriptDiff(a, b);
    expect(result.blocks.every((blk) => blk.type === 'unchanged')).toBe(false);
  });

  it('reports no change when the documents are identical', () => {
    const a = doc(block('action', 'one', BR, 'two'));
    const b = doc(block('action', 'one', BR, 'two'));
    expect(types(a, b).every((t) => t === 'unchanged')).toBe(true);
  });

  it('does not glue words across a break when diffing', () => {
    const a = doc(block('action', 'NIGHT', BR, 'FALL'));
    const b = doc(block('action', 'NIGHTFALL'));
    expect(types(a, b).some((t) => t !== 'unchanged')).toBe(true);
  });
});

describe('scriptDiff: edits in place', () => {
  it('reports an edited block as modified, with a word-level diff', () => {
    const a = doc(
      block('sceneHeading', 'INT. HOUSE - DAY'),
      block('action', 'The cat sat on the mat.'),
      block('action', 'Tail end.'),
    );
    const b = doc(
      block('sceneHeading', 'INT. HOUSE - DAY'),
      block('action', 'The dog sat on the mat.'),
      block('action', 'Tail end.'),
    );
    const result = computeScriptDiff(a, b);
    const modified = result.blocks.find((blk) => blk.type === 'modified');
    expect(modified).toBeDefined();
    expect(modified?.oldText).toBe('The cat sat on the mat.');
    expect(modified?.newText).toBe('The dog sat on the mat.');
    expect(modified?.wordDiffs?.some((p) => p.kind === 'removed' && p.text.includes('cat'))).toBe(true);
    expect(modified?.wordDiffs?.some((p) => p.kind === 'added' && p.text.includes('dog'))).toBe(true);
    expect(result.summary.totalModified).toBe(1);
    expect(result.summary.totalAdded).toBe(0);
    expect(result.summary.totalDeleted).toBe(0);
  });

  it('does not pair same-length lines that share no content', () => {
    const a = doc(block('action', 'Totally different.'), block('action', 'Also old.'));
    const b = doc(block('action', 'Brand new line.'), block('action', 'Another new one.'));
    const result = computeScriptDiff(a, b);
    // Same shape and position is not evidence of a rewrite: nothing is shared
    // once structural words are ignored.
    expect(result.summary.totalModified).toBe(0);
    expect(result.summary.totalAdded).toBe(2);
    expect(result.summary.totalDeleted).toBe(2);
  });

  it('records an element change on the modification', () => {
    const a = doc(block('action', 'hello there'));
    const b = doc(block('dialogue', 'hello there'));
    const result = computeScriptDiff(a, b);
    expect(result.blocks[0].type).toBe('modified');
    expect(result.blocks[0].oldElementType).toBe('action');
    expect(result.blocks[0].elementType).toBe('dialogue');
  });

  it('pairs a rewritten line even when the run is longer than one block', () => {
    const a = doc(
      block('action', 'The rain falls on the roof of the old house.'),
      block('action', 'She waits.'),
    );
    const b = doc(
      block('action', 'The rain hammers on the roof of the old house.'),
      block('action', 'She waits.'),
      block('action', 'A new beat.'),
    );
    const result = computeScriptDiff(a, b);
    const modified = result.blocks.filter((blk) => blk.type === 'modified');
    expect(modified).toHaveLength(1);
    expect(modified[0].newText).toContain('hammers');
    expect(result.summary.totalAdded).toBe(1);
    expect(result.summary.totalDeleted).toBe(0);
  });
});

describe('scriptDiff: additions and deletions', () => {
  it('reports a genuinely new line as added', () => {
    const a = doc(block('action', 'One.'), block('action', 'Two.'));
    const b = doc(block('action', 'One.'), block('action', 'Two.'), block('action', 'Three.'));
    const result = computeScriptDiff(a, b);
    expect(result.blocks.map((blk) => blk.type)).toEqual(['unchanged', 'unchanged', 'added']);
    expect(result.summary.totalAdded).toBe(1);
  });

  it('reports a removed line as deleted, in its old reading position', () => {
    const a = doc(
      block('action', 'One.'),
      block('action', 'Gone.'),
      block('action', 'Three.'),
    );
    const b = doc(block('action', 'One.'), block('action', 'Three.'));
    const result = computeScriptDiff(a, b);
    expect(result.blocks.map((blk) => blk.type)).toEqual(['unchanged', 'deleted', 'unchanged']);
    expect(result.blocks[1].oldText).toBe('Gone.');
    expect(result.summary.totalDeleted).toBe(1);
  });

  it('handles an empty draft on either side', () => {
    const empty = doc();
    const a = doc(block('action', 'One.'));
    expect(computeScriptDiff(empty, a).summary.totalAdded).toBe(1);
    expect(computeScriptDiff(a, empty).summary.totalDeleted).toBe(1);
  });
});

describe('scriptDiff: moves', () => {
  it('reports a line that comes back elsewhere as moved, not added and deleted', () => {
    const a = doc(
      block('action', 'One.'),
      block('action', 'Two.'),
      block('action', 'Three.'),
    );
    const b = doc(
      block('action', 'Three.'),
      block('action', 'One.'),
      block('action', 'Two.'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalMoved).toBe(1);
    expect(result.summary.totalAdded).toBe(0);
    expect(result.summary.totalDeleted).toBe(0);
    const moved = result.blocks.find((blk) => blk.type === 'moved');
    expect(moved?.oldText).toBe('Three.');
    expect(moved?.newText).toBe('Three.');
  });

  it('matches duplicate lines one to one, in order', () => {
    const a = doc(
      block('action', 'One.'),
      block('action', 'Two.'),
      block('action', 'Three.'),
      block('action', 'Dup.'),
      block('action', 'Dup.'),
    );
    const b = doc(
      block('action', 'Three.'),
      block('action', 'One.'),
      block('action', 'Two.'),
      block('action', 'Dup.'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalMoved).toBe(1);
    expect(result.summary.totalDeleted).toBe(1);
    expect(result.summary.totalAdded).toBe(0);
    expect(result.summary.totalModified).toBe(0);
  });

  it('remembers the scene a moved block came from', () => {
    const a = doc(
      block('sceneHeading', 'INT. A - DAY'),
      block('action', 'Alpha line.'),
      block('sceneHeading', 'INT. B - DAY'),
      block('action', 'Beta line.'),
      block('action', 'Gamma line.'),
    );
    const b = doc(
      block('sceneHeading', 'INT. A - DAY'),
      block('sceneHeading', 'INT. B - DAY'),
      block('action', 'Beta line.'),
      block('action', 'Alpha line.'),
      block('action', 'Gamma line.'),
    );
    const moved = computeScriptDiff(a, b).blocks.find((blk) => blk.type === 'moved');
    expect(moved?.oldText).toBe('Alpha line.');
    expect(moved?.oldSceneHeading).toBe('INT. A - DAY');
    expect(moved?.sceneHeading).toBe('INT. B - DAY');
  });
});

describe('scriptDiff: summary', () => {
  it('counts dialogue added and removed per character', () => {
    const a = doc(
      block('sceneHeading', 'INT. A - DAY'),
      block('character', 'MARGO'),
      block('dialogue', 'One.'),
      block('sceneHeading', 'INT. B - NIGHT'),
      block('character', 'TEO'),
      block('dialogue', 'Two.'),
    );
    const b = doc(
      block('sceneHeading', 'INT. A - DAY'),
      block('character', 'MARGO'),
      block('dialogue', 'One.'),
      block('sceneHeading', 'INT. B - NIGHT'),
    );
    const result = computeScriptDiff(a, b);
    const teo = result.summary.dialogueDelta.find((d) => d.character === 'TEO');
    expect(teo).toEqual({ character: 'TEO', added: 0, removed: 1 });
    expect(result.summary.scenesChanged).toContain('INT. B - NIGHT');
  });

  it('does not count a rewritten dialogue line as new or lost speech', () => {
    const a = doc(block('character', 'MARGO'), block('dialogue', 'One.'));
    const b = doc(block('character', 'MARGO'), block('dialogue', 'One!'));
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(1);
    expect(result.summary.dialogueDelta).toEqual([]);
  });
});

describe('scriptDiff: large scripts', () => {
  const bigScript = (opts: { early?: boolean; late?: boolean; insert?: boolean }) => {
    const content: any[] = [];
    for (let i = 0; i < 410; i++) {
      content.push({ type: 'sceneHeading', content: [{ type: 'text', text: `INT. ROOM ${i} - DAY` }] });
      for (let j = 0; j < 9; j++) {
        content.push({ type: 'action', content: [{ type: 'text', text: `Room ${i} beat ${j}.` }] });
      }
    }
    if (opts.early) content[1] = { type: 'action', content: [{ type: 'text', text: 'Room 0 beat 0 revised.' }] };
    if (opts.insert) content.splice(5, 0, { type: 'action', content: [{ type: 'text', text: 'Inserted beat.' }] });
    if (opts.late) content[content.length - 1] = { type: 'action', content: [{ type: 'text', text: 'Room 409 beat 8 revised.' }] };
    return { type: 'doc', content };
  };

  it('aligns a 4,100-block script with two edits instead of reporting the middle as changed', () => {
    const a = bigScript({});
    const b = bigScript({ early: true, late: true });
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(2);
    expect(result.summary.totalAdded).toBe(0);
    expect(result.summary.totalDeleted).toBe(0);
    expect(result.summary.totalMoved).toBe(0);
    expect(result.summary.scenesChanged).toHaveLength(2);
    for (const block of result.blocks) {
      if (block.type === 'modified') expect(block.oldText).not.toBe(block.newText);
    }
  }, 30_000);

  it('does not report one inserted line plus one edit as thousands of moves', () => {
    const a = bigScript({});
    const b = bigScript({ early: true, insert: true });
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalAdded).toBe(1);
    expect(result.summary.totalModified).toBe(1);
    expect(result.summary.totalMoved).toBe(0);
    expect(result.summary.totalDeleted).toBe(0);
  }, 30_000);
});

describe('scriptDiff: unrelated lines', () => {
  it('does not pair cues or headings that share only structure', () => {
    const a = doc(
      block('character', 'MARY (V.O.)'),
      block('dialogue', 'Hi.'),
      block('sceneHeading', 'INT. HOUSE - DAY'),
      block('action', 'The cat sits.'),
    );
    const b = doc(
      block('character', 'JOHN (V.O.)'),
      block('dialogue', 'Hi.'),
      block('sceneHeading', 'EXT. STREET - NIGHT'),
      block('action', 'The cat sits.'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(0);
    expect(result.blocks.some((blk) => blk.type === 'modified' && blk.oldText === 'MARY (V.O.)')).toBe(false);
  });

  it('still pairs a scene heading whose time of day changed', () => {
    const a = doc(block('sceneHeading', 'INT. HOUSE - DAY'));
    const b = doc(block('sceneHeading', 'INT. HOUSE - NIGHT'));
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(1);
    expect(result.blocks[0].oldText).toBe('INT. HOUSE - DAY');
  });

  it('does not call a cue that comes back in another scene a move', () => {
    const a = doc(
      block('sceneHeading', 'INT. A - DAY'),
      block('character', 'JOHN'),
      block('dialogue', 'Line one.'),
      block('sceneHeading', 'INT. B - DAY'),
    );
    const b = doc(
      block('sceneHeading', 'INT. A - DAY'),
      block('sceneHeading', 'INT. B - DAY'),
      block('character', 'JOHN'),
      block('dialogue', 'Line two.'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalMoved).toBe(0);
    expect(result.blocks.some((blk) => blk.type === 'moved' && blk.oldText === 'JOHN')).toBe(false);
  });
});

describe('scriptDiff: deletion order', () => {
  it('keeps a deletion after the line it followed in a mixed run', () => {
    const a = doc(block('action', 'Old one.'), block('action', 'Delete me.'));
    const b = doc(block('action', 'New one.'));
    const result = computeScriptDiff(a, b);
    expect(result.blocks.map((blk) => blk.type)).toEqual(['modified', 'deleted']);
    expect(result.blocks[0].newText).toBe('New one.');
    expect(result.blocks[1].oldText).toBe('Delete me.');
  });
});
describe('scriptDiff: cue extensions and transitions', () => {
  it('does not pair cues that share only (CONT\'D)', () => {
    const a = doc(block('character', "MARY (CONT'D)"), block('dialogue', 'Line.'));
    const b = doc(block('character', "JOHN (CONT'D)"), block('dialogue', 'Line.'));
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(0);
    expect(result.blocks.some((blk) => blk.type === 'modified' && blk.oldText === "MARY (CONT'D)")).toBe(false);
  });

  it('does not pair transitions that share only structure', () => {
    const a = doc(block('transition', 'CUT TO:'), block('action', 'One.'));
    const b = doc(block('transition', 'DISSOLVE TO:'), block('action', 'One.'));
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(0);
  });
});
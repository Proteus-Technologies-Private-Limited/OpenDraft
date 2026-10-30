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

  it('pairs a same-length run of the same elements even when the words differ', () => {
    const a = doc(block('action', 'Totally different.'), block('action', 'Also old.'));
    const b = doc(block('action', 'Brand new line.'), block('action', 'Another new one.'));
    const result = computeScriptDiff(a, b);
    expect(types(a, b)).toEqual(['modified', 'modified']);
    expect(result.summary.totalModified).toBe(2);
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

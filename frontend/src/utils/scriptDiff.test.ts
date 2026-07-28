import { describe, it, expect } from 'vitest';
import { computeScriptDiff } from './scriptDiff';
import { doc, block, BR } from '../test/screenplaySchema';

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
    expect(computeScriptDiff(a, b).blocks.every((blk) => blk.type === 'unchanged')).toBe(true);
  });

  it('does not glue words across a break when diffing', () => {
    const a = doc(block('action', 'NIGHT', BR, 'FALL'));
    const b = doc(block('action', 'NIGHTFALL'));
    const result = computeScriptDiff(a, b);
    expect(result.blocks.every((blk) => blk.type === 'unchanged')).toBe(false);
  });

  it('still detects ordinary edits', () => {
    const a = doc(block('action', 'The cat sat on the mat.'));
    const b = doc(block('action', 'The dog sat on the mat.'));
    const result = computeScriptDiff(a, b);
    expect(result.blocks.every((blk) => blk.type === 'unchanged')).toBe(false);
  });

  it('KNOWN GAP: an edited block reports as added+deleted, never modified', () => {
    // Pre-existing and unrelated to hard breaks. The backward LCS walk unshifts
    // an 'add' before the matching 'remove', but the merge loop at the top of
    // computeScriptDiff only combines a 'remove' FOLLOWED BY an 'add' — so the
    // 'modified' branch (and its word-level diff) is effectively unreachable.
    // Recorded here rather than fixed: changing the step order would alter
    // every diff the app renders, which does not belong in a hard-break change.
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
    const types = computeScriptDiff(a, b).blocks.map((blk) => blk.type);
    expect(types).toContain('added');
    expect(types).toContain('deleted');
    expect(types).not.toContain('modified');
  });
});

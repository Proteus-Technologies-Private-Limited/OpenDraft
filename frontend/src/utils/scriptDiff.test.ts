import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';
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
    const content: JSONContent[] = [];
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

describe('scriptDiff: post-merge follow-ups', () => {
  it.each([false, true])('keeps a deletion in its original scene when the preceding block moves (backward: %s)', (backward) => {
    const street = block('sceneHeading', 'EXT. CITY STREET - NIGHT');
    const cafe = block('sceneHeading', 'INT. COFFEE SHOP - DAY');
    const moved = block('action', 'She turns down an alley and listens hard.');
    const deleted = block('action', 'Then: FOOTSTEPS behind her.');
    const streetEnd = block('action', 'Sarah does not run.');
    const cafeEnd = block('action', 'Cups clatter.');
    const a = backward
      ? doc(cafe, cafeEnd, street, moved, deleted, streetEnd)
      : doc(street, moved, deleted, streetEnd, cafe, cafeEnd);
    const b = backward
      ? doc(cafe, cafeEnd, moved, street, streetEnd)
      : doc(street, streetEnd, cafe, cafeEnd, moved);
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalMoved).toBe(1);
    expect(result.summary.totalDeleted).toBe(1);
    const rows = result.blocks;
    const deletion = rows.findIndex((row) => row.type === 'deleted');
    const heading = rows.findIndex((row) => row.newText === 'EXT. CITY STREET - NIGHT');
    const end = rows.findIndex((row) => row.newText === 'Sarah does not run.');
    expect(deletion).toBeGreaterThan(heading);
    expect(deletion).toBeLessThan(end);
    expect(rows[deletion].sceneHeading).toBe('EXT. CITY STREET - NIGHT');
  });

  it('counts a renamed scene once under its new name, including deleted content', () => {
    const a = doc(
      block('sceneHeading', "INT. MARCUS' APARTMENT - NIGHT"),
      block('action', 'He opens the window.'),
      block('action', 'The discarded letter burns.'),
      block('sceneHeading', 'EXT. STREET - DAY'),
    );
    const b = doc(
      block('sceneHeading', "INT. MARCUS' APARTMENT - DAWN"),
      block('action', 'He opens the window.'),
      block('sceneHeading', 'EXT. STREET - DAY'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(1);
    expect(result.summary.totalDeleted).toBe(1);
    expect(result.summary.scenesChanged).toEqual(["INT. MARCUS' APARTMENT - DAWN"]);
    // Detailed rows keep the original draft's scene information.
    expect(result.blocks.find((row) => row.type === 'deleted')?.sceneHeading)
      .toBe("INT. MARCUS' APARTMENT - NIGHT");
  });

  it('keeps both scenes in the summary when a line moves between them', () => {
    const a = doc(
      block('sceneHeading', 'INT. HOUSE - NIGHT'),
      block('action', 'She puts the letter in her pocket.'),
      block('sceneHeading', 'EXT. STREET - DAY'),
      block('action', 'Traffic stops.'),
    );
    const b = doc(
      block('sceneHeading', 'INT. HOUSE - DAWN'),
      block('sceneHeading', 'EXT. STREET - DAY'),
      block('action', 'Traffic stops.'),
      block('action', 'She puts the letter in her pocket.'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalMoved).toBe(1);
    expect(result.summary.scenesChanged).toEqual(['INT. HOUSE - DAWN', 'EXT. STREET - DAY']);
  });

  it.each([false, true])('pairs the borderline dialogue rewrite under the same cue (extra beat: %s)', (extraBeat) => {
    const a = doc(
      block('character', 'JOHN'),
      block('dialogue', 'You should have left it alone, Sarah.'),
    );
    const b = doc(
      block('character', 'JOHN'),
      block('dialogue', 'You should have walked away, Sarah. While you still could.'),
      ...(extraBeat ? [block('action', 'Sarah closes the door.')] : []),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(1);
    expect(result.summary.totalDeleted).toBe(0);
    expect(result.summary.totalAdded).toBe(extraBeat ? 1 : 0);
    expect(result.summary.dialogueDelta).toEqual([]);
  });

  it.each(['different cue', 'no cue', 'action', 'new scene'])('keeps the original threshold for %s', (context) => {
    const type = context === 'action' ? 'action' : 'dialogue';
    const cue = context === 'no cue' || context === 'action' ? [] : [block('character', 'JOHN')];
    const a = doc(...cue, block(type, 'You should have left it alone, Sarah.'));
    const b = doc(
      ...(context === 'different cue' ? [block('character', 'MARY')] : cue),
      ...(context === 'new scene' ? [block('sceneHeading', 'EXT. ROAD - DAY')] : []),
      block(type, 'You should have walked away, Sarah. While you still could.'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(0);
  });

  it('keeps a separate scene with the same old heading in the summary', () => {
    const a = doc(
      block('sceneHeading', 'INT. HOUSE - NIGHT'),
      block('action', 'An intact beat.'),
      block('sceneHeading', 'EXT. ROAD - DAY'),
      block('sceneHeading', 'INT. HOUSE - NIGHT'),
      block('action', 'Another deleted beat.'),
    );
    const b = doc(
      block('sceneHeading', 'INT. HOUSE - DAWN'),
      block('action', 'An intact beat.'),
      block('sceneHeading', 'EXT. ROAD - DAY'),
      block('sceneHeading', 'INT. HOUSE - NIGHT'),
    );
    expect(computeScriptDiff(a, b).summary.scenesChanged)
      .toEqual(['INT. HOUSE - DAWN', 'INT. HOUSE - NIGHT']);
  });

  it('still separates unrelated dialogue spoken by the same character', () => {
    const a = doc(block('character', 'JOHN'), block('dialogue', 'Sarah, you left too early.'));
    const b = doc(block('character', 'JOHN'), block('dialogue', 'Sarah, the harbor is closed.'));
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(0);
    expect(result.summary.dialogueDelta).toEqual([{ character: 'JOHN', added: 1, removed: 1 }]);
  });

  it('compares Unicode words without losing accents or repeated-word counts', () => {
    const a = doc(block('action', 'Écho écho rivière forêt'));
    const b = doc(block('action', 'écho ÉCHO montagne jardin'), block('action', 'Extra beat.'));
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(1);
    expect(result.summary.totalAdded).toBe(1);
    expect(result.summary.totalDeleted).toBe(0);
  });

  it('does not inflate similarity by counting a repeated word more than its counterpart', () => {
    const a = doc(block('action', 'echo echo echo echo echo echo'));
    const b = doc(block('action', 'echo mountain river forest meadow valley'));
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(0);
    expect(result.summary.totalDeleted).toBe(1);
    expect(result.summary.totalAdded).toBe(1);
  });

  it('preserves multiset similarity at the threshold in the unequal-run pairing path', () => {
    const a = doc(block('action', 'echo echo river river'));
    const b = doc(
      block('action', 'echo echo mountain mountain'),
      block('action', 'Unrelated extra beat.'),
    );
    const result = computeScriptDiff(a, b);
    expect(result.summary.totalModified).toBe(1);
    expect(result.summary.totalAdded).toBe(1);
    expect(result.summary.totalDeleted).toBe(0);
  });
});

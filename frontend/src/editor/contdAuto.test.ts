import { describe, it, expect } from 'vitest';
import { computeContdChanges, type ContdBlock } from './contdAuto';
import { pmDoc, doc, block, BR } from '../test/screenplaySchema';
import type { JSONContent } from '@tiptap/react';

const MARKER = "(CONT'D)";

/** Build the block list the way ScreenplayEditor does, from a real PM doc. */
function blocksFrom(json: JSONContent, attrsByIndex: Record<number, Record<string, unknown>> = {}): ContdBlock[] {
  const d = pmDoc(json);
  const out: ContdBlock[] = [];
  d.forEach((node, offset, index) => {
    out.push({
      type: node.type.name,
      text: node.textContent,
      pos: offset,
      nodeSize: node.nodeSize,
      attrs: { ...node.attrs, ...(attrsByIndex[index] || {}) },
    });
  });
  return out;
}

describe('computeContdChanges — existing behaviour', () => {
  it('adds the marker when the same character resumes after action', () => {
    const blocks = blocksFrom(doc(
      block('character', 'JOHN'),
      block('dialogue', 'Hello.'),
      block('action', 'He pauses.'),
      block('character', 'JOHN'),
      block('dialogue', 'Still me.'),
    ));
    const changes = computeContdChanges(blocks, { contdMarker: MARKER });
    const textChange = changes.find((c) => c.newText !== null);
    expect(textChange?.newText).toBe("JOHN (CONT'D)");
  });

  it('does not add the marker when dialogue runs straight on', () => {
    const blocks = blocksFrom(doc(
      block('character', 'JOHN'),
      block('dialogue', 'Hello.'),
      block('character', 'JOHN'),
    ));
    expect(computeContdChanges(blocks, { contdMarker: MARKER }).some((c) => c.newText !== null)).toBe(false);
  });

  it('resets continuation at a scene heading', () => {
    const blocks = blocksFrom(doc(
      block('character', 'JOHN'),
      block('dialogue', 'Hi.'),
      block('sceneHeading', 'INT. BAR - NIGHT'),
      block('character', 'JOHN'),
    ));
    expect(computeContdChanges(blocks, { contdMarker: MARKER }).some((c) => c.newText !== null)).toBe(false);
  });

  it('never touches a marker the writer typed', () => {
    const blocks = blocksFrom(doc(
      block('character', 'JOHN'),
      block('dialogue', 'Hi.'),
      block('action', 'Beat.'),
      block('character', "JOHN (CONT'D)"),
    ));
    // contdAuto is false (default), so the manual marker is left alone.
    expect(computeContdChanges(blocks, { contdMarker: MARKER }).some((c) => c.newText !== null)).toBe(false);
  });

  it('strips a stale marker it added itself', () => {
    const blocks = blocksFrom(
      doc(
        block('character', 'JOHN'),
        block('dialogue', 'Hi.'),
        block('sceneHeading', 'INT. BAR - NIGHT'),
        block('character', "JOHN (CONT'D)"),
      ),
      { 3: { contdAuto: true } },
    );
    const change = computeContdChanges(blocks, { contdMarker: MARKER }).find((c) => c.newText !== null);
    expect(change?.newText).toBe('JOHN');
  });
});

describe('computeContdChanges — hard breaks', () => {
  it('produces no text change for a cue containing a break', () => {
    const blocks = blocksFrom(doc(
      block('character', 'JOHN', BR, 'SMITH'),
      block('dialogue', 'Hello.'),
      block('action', 'Beat.'),
      block('character', 'JOHN', BR, 'SMITH'),
    ));
    const changes = computeContdChanges(blocks, { contdMarker: MARKER });
    expect(changes.some((c) => c.newText !== null)).toBe(false);
  });

  it('still treats a broken cue as the same speaker as an unbroken one', () => {
    // JOHN<br>SMITH then, after action, "JOHN SMITH" — same speaker, so the
    // second (rewritable) cue must get the marker.
    const blocks = blocksFrom(doc(
      block('character', 'JOHN', BR, 'SMITH'),
      block('dialogue', 'Hello.'),
      block('action', 'Beat.'),
      block('character', 'JOHN SMITH'),
    ));
    const change = computeContdChanges(blocks, { contdMarker: MARKER }).find((c) => c.newText !== null);
    expect(change?.newText).toBe("JOHN SMITH (CONT'D)");
  });

  it('REGRESSION: the replace range covers the whole cue even with breaks before it', () => {
    // The old code used `pos + 1 + text.length`. With a break in an earlier
    // block that is still correct, but with a break in a LATER block the
    // ranges must stay tied to nodeSize. Assert the range equals the node's
    // real inline span for every emitted change.
    const json = doc(
      block('action', 'Opening', BR, 'line.'),
      block('character', 'JOHN'),
      block('dialogue', 'Hi.'),
      block('action', 'Beat.'),
      block('character', 'JOHN'),
    );
    const d = pmDoc(json);
    const blocks = blocksFrom(json);
    const changes = computeContdChanges(blocks, { contdMarker: MARKER });
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      const node = d.nodeAt(c.pos)!;
      expect(c.from).toBe(c.pos + 1);
      expect(c.to).toBe(c.pos + node.nodeSize - 1);
      expect(c.to - c.from).toBe(node.content.size);
    }
  });

  it('emits a range that fully covers the cue text (no tail left behind)', () => {
    const json = doc(
      block('character', 'JOHN'),
      block('dialogue', 'Hi.'),
      block('action', 'Beat.'),
      block('character', 'JOHN'),
    );
    const d = pmDoc(json);
    const change = computeContdChanges(blocksFrom(json), { contdMarker: MARKER })
      .find((c) => c.newText !== null)!;
    const node = d.nodeAt(change.pos)!;
    // The replaced span must equal the full existing text, or insertText
    // leaves characters behind and the cue duplicates.
    expect(change.to - change.from).toBe(node.textContent.length);
  });
});

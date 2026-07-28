/**
 * Guards the invariant the whole hard-break implementation rests on.
 *
 * If the "every inline non-text node has a 1-character leafText" test ever
 * fails, it means a new inline atom was added to the schema. That silently
 * breaks the `textContent.length === content.size` identity, which in turn
 * makes every character-index-to-document-position calculation in the editor
 * off by one — the exact class of bug that made a hard break inside a
 * character cue duplicate the cue's tail. Fix the new node (give it a
 * one-character `leafText`) or audit the position-math sites; do not delete
 * this test.
 */
import { describe, it, expect } from 'vitest';
import { testSchema, pmDoc, doc, block, BR } from '../test/screenplaySchema';

describe('hardBreak schema', () => {
  it('carries leafText on the node spec', () => {
    const spec = testSchema.nodes.hardBreak.spec as { leafText?: (node: unknown) => string };
    expect(typeof spec.leafText).toBe('function');
    expect(spec.leafText!(null)).toBe('\n');
  });

  it('renders a break as a newline in textContent', () => {
    const d = pmDoc(doc(block('action', 'Line one', BR, 'Line two')));
    expect(d.firstChild!.textContent).toBe('Line one\nLine two');
  });

  it('treats consecutive breaks as consecutive newlines', () => {
    const d = pmDoc(doc(block('action', 'A', BR, BR, 'B')));
    expect(d.firstChild!.textContent).toBe('A\n\nB');
  });

  it('counts a break as exactly one position', () => {
    const d = pmDoc(doc(block('action', 'AB', BR, 'CD')));
    // 'AB' + break + 'CD' = 2 + 1 + 2
    expect(d.firstChild!.content.size).toBe(5);
    expect(d.firstChild!.nodeSize).toBe(7); // + open/close tokens
  });

  it.each([0, 1, 2])('keeps textContent.length === content.size with %i breaks', (breaks) => {
    const parts: Array<string | typeof BR> = ['Start'];
    for (let i = 0; i < breaks; i++) { parts.push(BR); parts.push(`seg${i}`); }
    const node = pmDoc(doc(block('dialogue', ...parts))).firstChild!;
    expect(node.textContent.length).toBe(node.content.size);
  });

  it('keeps the identity with marks applied', () => {
    const node = pmDoc(doc({
      type: 'action',
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'plain' },
      ],
    })).firstChild!;
    expect(node.textContent).toBe('bold\nplain');
    expect(node.textContent.length).toBe(node.content.size);
  });

  it('accepts a break inside every text-bearing screenplay block', () => {
    const types = [
      'sceneHeading', 'action', 'character', 'dialogue', 'parenthetical',
      'transition', 'general', 'shot', 'newAct', 'endOfAct', 'lyrics',
      'showEpisode', 'castList', 'titlePage', 'customElement',
      'avPara', 'avShot', 'avDirection',
    ];
    for (const type of types) {
      const node = testSchema.nodes[type].createChecked(
        null,
        [
          testSchema.text('A'),
          testSchema.nodes.hardBreak.create(),
          testSchema.text('B'),
        ],
      );
      expect(node.textContent, `${type} should accept a hard break`).toBe('A\nB');
    }
  });

  it('INVARIANT: every inline non-text node has a one-character leafText', () => {
    for (const [name, type] of Object.entries(testSchema.nodes)) {
      const spec = type.spec as { inline?: boolean; leafText?: (n: unknown) => string };
      if (name === 'text' || !spec.inline) continue;
      expect(typeof spec.leafText, `inline node "${name}" needs a leafText`).toBe('function');
      expect(spec.leafText!(null).length, `"${name}" leafText must be 1 char`).toBe(1);
    }
  });
});

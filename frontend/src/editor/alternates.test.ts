import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { getAttributesFromExtensions, getSchema, getSplittedAttributes } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { testSchema, testExtensions, block, doc, marked } from '../test/screenplaySchema';
import {
  addAlternateTransaction,
  alternateTargetAt,
  alternatesOf,
  cycleAlternateTransaction,
  deleteShownAlternateTransaction,
  keepOnlyShownTransaction,
  versionCount,
  versionIndex,
  ALTERNATES_META,
} from './alternates';
import {
  addSceneAlternateTransaction,
  cycleSceneAlternateTransaction,
  deleteShownSceneAlternateTransaction,
  keepOnlyShownSceneTransaction,
} from './sceneAlternates';
import { alternateSessionGuard, buildAlternateDecorations } from './extensions/Alternates';
import { exportFountain } from '../utils/fountainExporter';
import { exportFDX } from '../utils/fdxExporter';

function stateOf(...blocks: JSONContent[]) {
  return EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(...blocks)) });
}

/** A position inside the top-level block at `index`. */
function inside(s: EditorState, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += s.doc.child(i).nodeSize;
  return pos + 1;
}

const line = (s: EditorState, index = 1) => s.doc.child(index);

/** Replace the text of the block at `index`, as typing over the selection would. */
function retype(s: EditorState, index: number, text: string): EditorState {
  const from = inside(s, index);
  const to = from + line(s, index).content.size;
  return s.apply(s.tr.insertText(text, from, to));
}

/** A dialogue line with versions "One", "Two", "Three", showing "Three". */
function threeVersions(): EditorState {
  let s = stateOf(block('character', 'MAYA'), block('dialogue', 'One'));
  s = retype(s.apply(addAlternateTransaction(s, inside(s, 1))!), 1, 'Two');
  s = retype(s.apply(addAlternateTransaction(s, inside(s, 1))!), 1, 'Three');
  return s;
}

describe('adding alternates', () => {
  it('keeps the current text as a version and selects the line for the new one', () => {
    const s = stateOf(block('character', 'MAYA'), block('dialogue', 'You came back.'));
    const next = s.apply(addAlternateTransaction(s, inside(s, 1))!);
    expect(line(next).textContent).toBe('You came back.');
    expect(versionCount(line(next))).toBe(2);
    expect(versionIndex(line(next))).toBe(1);
    expect(next.selection.from).toBe(inside(next, 1));
    expect(next.selection.to).toBe(inside(next, 1) + 'You came back.'.length);
  });

  it('works on action and dialogue, and nowhere else', () => {
    const s = stateOf(block('sceneHeading', 'INT. ROOM - DAY'), block('action', 'She waits.'), block('character', 'MAYA'));
    expect(alternateTargetAt(s, inside(s, 0))).toBeNull();
    expect(alternateTargetAt(s, inside(s, 1))?.node.type.name).toBe('action');
    expect(alternateTargetAt(s, inside(s, 2))).toBeNull();
    expect(addAlternateTransaction(s, inside(s, 2))).toBeNull();
  });

  it('works in dual dialogue', () => {
    const s = stateOf({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [block('character', 'A'), block('dialogue', 'Now.')] },
        { type: 'dualDialogueColumn', content: [block('character', 'B'), block('dialogue', 'Later.')] },
      ],
    });
    let target = -1;
    s.doc.descendants((n, p) => { if (n.isText && n.text === 'Now.') target = p; });
    expect(target).toBeGreaterThan(0);
    const next = s.apply(addAlternateTransaction(s, target)!);
    let count = 0;
    next.doc.descendants((n) => { if (n.type.name === 'dialogue' && versionCount(n) === 2) count++; });
    expect(count).toBe(1);
  });
});

describe('switching versions', () => {
  it('steps forward and back through every version in the order they were added', () => {
    let s = threeVersions();
    expect([line(s).textContent, versionIndex(line(s)) + 1, versionCount(line(s))]).toEqual(['Three', 3, 3]);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      s = s.apply(cycleAlternateTransaction(s, inside(s, 1), 1)!);
      seen.push(`${line(s).textContent}:${versionIndex(line(s)) + 1}`);
    }
    expect(seen).toEqual(['One:1', 'Two:2', 'Three:3']);
    s = s.apply(cycleAlternateTransaction(s, inside(s, 1), -1)!);
    expect(line(s).textContent).toBe('Two');
    expect(versionIndex(line(s))).toBe(1);
  });

  it('keeps the marks of each version', () => {
    let s = stateOf(block('character', 'MAYA'), marked('dialogue', 'Shout it', 'italic'));
    s = s.apply(addAlternateTransaction(s, inside(s, 1))!);
    s = retype(s, 1, 'Whisper it');
    s = s.apply(cycleAlternateTransaction(s, inside(s, 1), 1)!);
    expect(line(s).textContent).toBe('Shout it');
    expect(line(s).firstChild?.marks.map((m) => m.type.name)).toEqual(['italic']);
  });

  it('does nothing on a line with no versions', () => {
    const s = stateOf(block('action', 'Alone.'));
    expect(cycleAlternateTransaction(s, inside(s, 0), 1)).toBeNull();
    expect(deleteShownAlternateTransaction(s, inside(s, 0))).toBeNull();
    expect(keepOnlyShownTransaction(s, inside(s, 0))).toBeNull();
  });
});

describe('removing versions', () => {
  it('deletes the version showing and shows the next', () => {
    let s = threeVersions();
    s = s.apply(cycleAlternateTransaction(s, inside(s, 1), 1)!); // One, 1/3
    s = s.apply(cycleAlternateTransaction(s, inside(s, 1), 1)!); // Two, 2/3
    s = s.apply(deleteShownAlternateTransaction(s, inside(s, 1))!);
    expect([line(s).textContent, versionIndex(line(s)) + 1, versionCount(line(s))]).toEqual(['Three', 2, 2]);
    s = s.apply(cycleAlternateTransaction(s, inside(s, 1), 1)!);
    expect(line(s).textContent).toBe('One');
  });

  it('deleting down to one version leaves a plain line', () => {
    let s = stateOf(block('action', 'A'));
    s = retype(s.apply(addAlternateTransaction(s, inside(s, 0))!), 0, 'B');
    s = s.apply(deleteShownAlternateTransaction(s, inside(s, 0))!);
    expect(line(s, 0).textContent).toBe('A');
    expect(line(s, 0).attrs.alternates).toBeNull();
  });

  it('keeps only the version showing', () => {
    let s = threeVersions();
    s = s.apply(keepOnlyShownTransaction(s, inside(s, 1))!);
    expect(line(s).textContent).toBe('Three');
    expect(versionCount(line(s))).toBe(1);
    expect(line(s).attrs.alternateIndex).toBe(0);
  });
});

describe('alternates in the document', () => {
  it('go one undo step per switch', () => {
    const s = threeVersions();
    const tr = cycleAlternateTransaction(s, inside(s, 1), 1)!;
    expect(tr.steps.length).toBeGreaterThan(0);
    // One transaction is one history entry; nothing else is needed for undo.
    expect(tr.docChanged).toBe(true);
  });

  it('survive a save and load as JSON', () => {
    const s = threeVersions();
    const reloaded = testSchema.nodeFromJSON(JSON.parse(JSON.stringify(s.doc.toJSON())));
    expect(alternatesOf(reloaded.child(1)).map((a) => a.content[0]?.text)).toEqual(['One', 'Two']);
    expect(versionIndex(reloaded.child(1))).toBe(2);
  });

  it('are not copied onto a new line made by pressing Enter', () => {
    // Enter is TipTap's splitBlock, which carries over only the attributes
    // that keep on split; this asks it what it would carry.
    const s = threeVersions();
    const carried = getSplittedAttributes(getAttributesFromExtensions(testExtensions), 'dialogue', line(s).attrs);
    expect(carried).not.toHaveProperty('alternates');
    expect(carried).not.toHaveProperty('alternateIndex');
  });

  it('do not stop an older build opening the script; it keeps the version showing', () => {
    const older = getSchema(testExtensions.filter((e) => e.name !== 'alternates'));
    const reloaded = older.nodeFromJSON(threeVersions().doc.toJSON());
    expect(reloaded.child(1).textContent).toBe('Three');
    expect(reloaded.child(1).attrs).not.toHaveProperty('alternates');
  });

  it('ignore stored versions that are not versions', () => {
    const node = testSchema.nodeFromJSON({ ...block('action', 'x'), attrs: { alternates: [null, { id: 1 }, { id: 'a', content: [] }] } });
    expect(alternatesOf(node)).toHaveLength(1);
  });

  it('draw one chip per line that has versions', () => {
    const s = threeVersions();
    expect(buildAlternateDecorations(s.doc).find()).toHaveLength(1);
    expect(buildAlternateDecorations(stateOf(block('action', 'x')).doc).find()).toHaveLength(0);
  });

  it('only the version showing reaches an export', () => {
    const json = threeVersions().doc.toJSON();
    const fountain = exportFountain(json);
    expect(fountain).toContain('Three');
    // The other versions travel as Fountain notes, which are never printed
    // (utils/formatAnnotations); the script text holds only the one showing.
    const script = fountain.replace(/\[\[[\s\S]*?\]\]/g, '');
    expect(script).not.toContain('One');
    expect(script).not.toContain('Two');
    const fdx = exportFDX(json);
    expect(fdx).toContain('Three');
    expect(fdx).not.toMatch(/>One<|>Two</);
  });
});

describe('marking alternates transactions for suggest mode', () => {
  // Suggest mode refuses these whole (extensions/Suggestions): a suggestion
  // can carry the text of a switch but not the stored versions.
  it('marks every line action', () => {
    const s = threeVersions();
    const pos = inside(s, 1);
    for (const tr of [
      addAlternateTransaction(s, pos),
      cycleAlternateTransaction(s, pos, 1),
      cycleAlternateTransaction(s, pos, -1),
      deleteShownAlternateTransaction(s, pos),
      keepOnlyShownTransaction(s, pos),
    ]) expect(tr?.getMeta(ALTERNATES_META)).toBe(true);
  });

  it('marks every scene action', () => {
    let s = stateOf(block('sceneHeading', 'INT. ROOM - DAY'), block('action', 'She waits.'));
    const added = addSceneAlternateTransaction(s, inside(s, 0));
    expect(added?.getMeta(ALTERNATES_META)).toBe(true);
    s = s.apply(added!);
    const pos = inside(s, 0);
    for (const tr of [
      cycleSceneAlternateTransaction(s, pos, 1),
      cycleSceneAlternateTransaction(s, pos, -1),
      deleteShownSceneAlternateTransaction(s, pos),
      keepOnlyShownSceneTransaction(s, pos),
    ]) expect(tr?.getMeta(ALTERNATES_META)).toBe(true);
  });

  it('leaves ordinary typing unmarked', () => {
    const s = stateOf(block('action', 'She waits.'));
    expect(s.tr.insertText('!', inside(s, 0) + 3).getMeta(ALTERNATES_META)).toBeUndefined();
  });
});

describe('alternate versions during live collaboration', () => {
  for (const scene of [false, true]) {
    it(`refuses every ${scene ? 'scene' : 'line'} version change without changing stored or active content`, () => {
      let s = scene
        ? stateOf(block('sceneHeading', 'INT. ROOM - DAY'), block('action', 'She waits.'))
        : threeVersions();
      if (scene) s = s.apply(addSceneAlternateTransaction(s, inside(s, 0))!);
      let collaborating = true;
      let blocked = 0;
      s = s.reconfigure({ plugins: [alternateSessionGuard(() => collaborating, () => { blocked++; })] });
      const pos = inside(s, scene ? 0 : 1);
      const actions = scene
        ? [addSceneAlternateTransaction, (state: EditorState, at: number) => cycleSceneAlternateTransaction(state, at, 1),
          (state: EditorState, at: number) => cycleSceneAlternateTransaction(state, at, -1), deleteShownSceneAlternateTransaction, keepOnlyShownSceneTransaction]
        : [addAlternateTransaction, (state: EditorState, at: number) => cycleAlternateTransaction(state, at, 1),
          (state: EditorState, at: number) => cycleAlternateTransaction(state, at, -1), deleteShownAlternateTransaction, keepOnlyShownTransaction];
      for (const action of actions) {
        const result = s.applyTransaction(action(s, pos)!);
        expect(result.transactions).toHaveLength(0);
        expect(result.state.doc).toBe(s.doc);
      }
      expect(blocked).toBe(actions.length);
      // Typing and incoming ordinary transactions still work.
      expect(s.applyTransaction(s.tr.insertText('New ', pos)).transactions).toHaveLength(1);
      // Ending the session immediately restores version operations.
      collaborating = false;
      expect(s.applyTransaction(actions[0](s, pos)!).transactions).toHaveLength(1);
    });
  }
});

import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { testSchema, block, doc, marked, BR } from '../test/screenplaySchema';
import { applyCharacterRename, findCharacterRenameMatches, matchCase } from './characterRename';

function state(...blocks: Parameters<typeof doc>) {
  return EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(...blocks)) });
}

function texts(s: EditorState): string[] {
  const out: string[] = [];
  s.doc.forEach((n) => out.push(n.textContent));
  return out;
}

function rename(s: EditorState, from: string, to: string, withMentions = true): EditorState {
  const { cues, mentions } = findCharacterRenameMatches(s.doc, from, to);
  const tr = s.tr;
  applyCharacterRename(tr, withMentions ? [...cues, ...mentions] : cues);
  return s.apply(tr);
}

describe('matchCase', () => {
  it('writes the new name the way the old one was written', () => {
    expect(matchCase('SARAH', 'Sam Lee')).toBe('SAM LEE');
    expect(matchCase('Sarah', 'sam lee')).toBe('Sam Lee');
    expect(matchCase('sarah', 'Sam')).toBe('sam');
    expect(matchCase('McKenzie', 'O\'Neil')).toBe('O\'Neil');
  });
});

describe('character rename', () => {
  it('renames every cue and keeps its extensions', () => {
    const s = state(
      block('character', 'SARAH'), block('dialogue', 'Hi.'),
      block('character', 'SARAH (V.O.)'), block('dialogue', 'Still me.'),
      block('character', "SARAH (CONT'D)"), block('dialogue', 'Yes.'),
      block('character', 'SARAHJANE'), block('dialogue', 'Not her.'),
    );
    const next = rename(s, 'SARAH', 'Sam', false);
    expect(texts(next)).toEqual([
      'SAM', 'Hi.', 'SAM (V.O.)', 'Still me.', "SAM (CONT'D)", 'Yes.', 'SARAHJANE', 'Not her.',
    ]);
  });

  it('finds a cue by its key whatever its case or extension', () => {
    const s = state(block('character', "Sarah (cont'd)"));
    const { cues } = findCharacterRenameMatches(s.doc, 'SARAH', 'Sam');
    expect(cues).toHaveLength(1);
    expect(texts(rename(s, 'SARAH', 'SAM'))).toEqual(["Sam (cont'd)"]);
  });

  it('does not rename a name that only appears inside an extension', () => {
    const s = state(block('character', 'BOB (TO SARAH)'));
    expect(findCharacterRenameMatches(s.doc, 'SARAH', 'Sam').cues).toHaveLength(0);
  });

  it('offers mentions outside cues, skipping lower-case words', () => {
    const s = state(
      block('sceneHeading', "INT. WILL'S APARTMENT - DAY"),
      block('action', 'WILL enters. Nobody will notice.'),
      block('character', 'WILL'),
      block('dialogue', 'Will you stop?'),
    );
    const { cues, mentions } = findCharacterRenameMatches(s.doc, 'WILL', 'Max');
    expect(cues).toHaveLength(1);
    expect(mentions.map((m) => [m.blockType, m.text, m.replacement])).toEqual([
      ['sceneHeading', 'WILL', 'MAX'],
      ['action', 'WILL', 'MAX'],
      ['dialogue', 'Will', 'Max'],
    ]);
    // A reviewer can leave the dialogue one out.
    const tr = s.tr;
    applyCharacterRename(tr, [...cues, ...mentions.slice(0, 2)]);
    expect(texts(s.apply(tr))).toEqual([
      "INT. MAX'S APARTMENT - DAY", 'MAX enters. Nobody will notice.', 'MAX', 'Will you stop?',
    ]);
  });

  it('handles several matches in one block and a longer replacement', () => {
    const s = state(block('action', 'Sarah sees Sarah in the mirror.'), block('character', 'SARAH'));
    expect(texts(rename(s, 'Sarah', 'Alexandra'))).toEqual(['Alexandra sees Alexandra in the mirror.', 'ALEXANDRA']);
  });

  it('renames multi-word names', () => {
    const s = state(block('character', 'MARY JANE (O.S.)'), block('action', 'MARY JANE waves.'));
    expect(texts(rename(s, 'MARY JANE', 'MJ'))).toEqual(['MJ (O.S.)', 'MJ waves.']);
  });

  it('keeps the marks on the name', () => {
    const s = state(marked('action', 'SARAH runs.', 'bold'));
    const next = rename(s, 'SARAH', 'SAM');
    const first = next.doc.child(0).child(0);
    expect(first.text).toBe('SAM runs.');
    expect(first.marks.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('keeps positions right across hard breaks', () => {
    const s = state(block('action', 'Line one', BR, 'SARAH waits.'));
    expect(texts(rename(s, 'SARAH', 'SAM'))).toEqual(['Line one\nSAM waits.']);
  });

  it('renames cues inside dual dialogue', () => {
    const s = state({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [block('character', 'SARAH'), block('dialogue', 'A.')] },
        { type: 'dualDialogueColumn', content: [block('character', 'BOB'), block('dialogue', 'B.')] },
      ],
    });
    const next = rename(s, 'SARAH', 'SAM');
    expect(next.doc.textBetween(0, next.doc.content.size, '|')).toBe('SAM|A.|BOB|B.');
  });

  it('is a single undoable transaction', () => {
    const s = state(block('character', 'SARAH'), block('character', 'SARAH (V.O.)'));
    const { cues } = findCharacterRenameMatches(s.doc, 'SARAH', 'SAM');
    const tr = s.tr;
    expect(applyCharacterRename(tr, cues)).toBe(2);
    expect(tr.steps.length).toBe(2);
  });
});

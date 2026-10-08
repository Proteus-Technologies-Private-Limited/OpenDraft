import { describe, it, expect } from 'vitest';
import { block, doc, pmDoc, BR } from '../../test/screenplaySchema';
import {
  buildReadLines, lineIndexAt, speakable, spokenRangeToDoc, spokenRangeToText, wordRanges,
  type BuildOptions,
} from './script';

const ALL: BuildOptions = {
  readSceneHeadings: true,
  readAction: true,
  readParentheticals: true,
  readTransitions: true,
  announceCharacters: false,
};

const script = () => pmDoc(doc(
  block('sceneHeading', 'INT. KITCHEN - NIGHT'),
  block('action', 'SARAH (30s) stirs a pot. Rain hammers the windows.'),
  block('character', 'SARAH (V.O.)'),
  block('parenthetical', '(quietly)'),
  block('dialogue', 'You came back.'),
  block('character', 'JOHN'),
  block('dialogue', 'I never left.'),
  block('transition', 'CUT TO:'),
  block('sceneHeading', 'EXT. STREET - DAY'),
  block('action', 'Empty.'),
));

describe('speakable', () => {
  it('reads scene-heading abbreviations and separators the way a reader would', () => {
    expect(speakable('INT. KITCHEN - NIGHT', 'sceneHeading').spoken).toBe('Interior. Kitchen. Night');
    expect(speakable('INT./EXT. CAR - MOVING', 'sceneHeading').spoken).toBe('Interior, exterior. Car. Moving');
    expect(speakable('EXT. STREET', 'sceneHeading').spoken).toBe('Exterior. Street');
  });

  it('does not read a leading scene number', () => {
    expect(speakable('12 INT. KITCHEN - NIGHT', 'sceneHeading').spoken).toBe('Interior. Kitchen. Night');
  });

  it('puts capitalised names in title case so voices do not spell them out', () => {
    expect(speakable('SARAH enters.', 'action').spoken).toBe('Sarah enters.');
  });

  it('keeps acronyms and vowel-less capitals as they are', () => {
    expect(speakable('The FBI agent watches TV.', 'action').spoken).toBe('The FBI agent watches TV.');
  });

  it('leaves mixed-case text untouched', () => {
    const s = 'You came back, didn\'t you?';
    expect(speakable(s, 'dialogue')).toEqual({ spoken: s, map: [...Array(s.length + 1).keys()] });
  });

  it('maps every spoken character back into the written text', () => {
    const text = 'INT. KITCHEN - NIGHT';
    const { spoken, map } = speakable(text, 'sceneHeading');
    expect(map).toHaveLength(spoken.length + 1);
    const k = spoken.indexOf('Kitchen');
    expect(text.slice(map[k], map[k + 'Kitchen'.length])).toBe('KITCHEN');
    for (let i = 1; i < map.length; i++) expect(map[i]).toBeGreaterThanOrEqual(map[i - 1]);
  });
});

describe('buildReadLines', () => {
  it('gives each line to the right reader', () => {
    const lines = buildReadLines(script(), ALL);
    expect(lines.map((l) => [l.kind, l.speaker])).toEqual([
      ['sceneHeading', null],
      ['action', null],
      ['parenthetical', 'SARAH'],
      ['dialogue', 'SARAH'],
      ['dialogue', 'JOHN'],
      ['transition', null],
      ['sceneHeading', null],
      ['action', null],
    ]);
    expect(lines[3].cue).toBe('SARAH (V.O.)');
    // The parenthetical travels with the speech it directs.
    expect(lines[3].direction).toBe('quietly');
    expect(lines[4].direction).toBeNull();
    expect(lines.map((l) => l.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('numbers scenes, with lines before the first heading in scene -1', () => {
    const d = pmDoc(doc(block('action', 'FADE IN:'), block('sceneHeading', 'INT. A - DAY'), block('action', 'X.')));
    expect(buildReadLines(d, ALL).map((l) => l.sceneIndex)).toEqual([-1, 0, 0]);
  });

  it('honours the read options', () => {
    const lines = buildReadLines(script(), {
      readSceneHeadings: false, readAction: false, readParentheticals: false, readTransitions: false, announceCharacters: false,
    });
    expect(lines.map((l) => l.text)).toEqual(['You came back.', 'I never left.']);
    // Skipped headings still count as scenes.
    expect(lines.map((l) => l.sceneIndex)).toEqual([0, 0]);
  });

  it('announces characters by name when asked', () => {
    const lines = buildReadLines(script(), { ...ALL, announceCharacters: true, readParentheticals: false });
    const cue = lines.find((l) => l.kind === 'character')!;
    expect(cue.spoken).toBe('Sarah.');
    expect(cue.speaker).toBeNull();
  });

  it('skips empty blocks, the title page and notes', () => {
    const d = pmDoc(doc(
      { type: 'titlePage', content: [block('general', 'MY SCRIPT')] } as never,
      block('action'),
      block('note', 'Fix this later'),
      block('action', 'Real line.'),
    ));
    expect(buildReadLines(d, ALL).map((l) => l.text)).toEqual(['Real line.']);
  });

  it('reads a hard break as a space and keeps positions aligned', () => {
    const d = pmDoc(doc(block('character', 'ANNA'), block('dialogue', 'One.', BR, 'Two.')));
    const [line] = buildReadLines(d, ALL);
    expect(line.text).toBe('One. Two.');
    expect(line.positions).toHaveLength(line.text.length);
    const t = line.text.indexOf('Two');
    expect(d.textBetween(line.positions[t], line.positions[t + 2] + 1)).toBe('Two');
  });

  it('reads both sides of dual dialogue, left first', () => {
    const d = pmDoc(doc({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [block('character', 'AL'), block('dialogue', 'Left.')] },
        { type: 'dualDialogueColumn', content: [block('character', 'BO'), block('dialogue', 'Right.')] },
      ],
    }));
    expect(buildReadLines(d, ALL).map((l) => [l.speaker, l.text])).toEqual([['AL', 'Left.'], ['BO', 'Right.']]);
  });
});

describe('positions', () => {
  it('maps a spoken word to the written word in the document', () => {
    const d = script();
    const heading = buildReadLines(d, ALL)[0];
    const s = heading.spoken.indexOf('Kitchen');
    const range = spokenRangeToDoc(heading, s, s + 'Kitchen'.length)!;
    expect(d.textBetween(range.from, range.to)).toBe('KITCHEN');
    expect(spokenRangeToText(heading, s, s + 7)).toEqual({ start: 5, end: 12 });
  });

  it('finds the line at or after a document position', () => {
    const lines = buildReadLines(script(), ALL);
    expect(lineIndexAt(lines, 0)).toBe(0);
    expect(lineIndexAt(lines, lines[4].from + 2)).toBe(4);
    expect(lineIndexAt(lines, 1e9)).toBe(0);
  });
});

describe('wordRanges', () => {
  it('weights words by length and the pause after them', () => {
    const w = wordRanges('Hi, there. Go');
    expect(w.map((x) => [x.start, x.end])).toEqual([[0, 3], [4, 10], [11, 13]]);
    expect(w[1].weight).toBeGreaterThan(w[0].weight);
  });
});

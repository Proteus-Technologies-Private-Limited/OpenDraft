import { describe, expect, it } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import { testSchema, block, doc } from '../test/screenplaySchema';
import {
  EMPTY_SCENE_DETAILS,
  SCENE_DETAILS_ATTR,
  SHOT_COSTUMES_ATTR,
  addPresentCharacter,
  addSceneCostume,
  collectSceneBriefs,
  costumesIn,
  headingTimeOfDay,
  isEmptySceneDetails,
  moveSceneCostume,
  readSceneDetails,
  readShotCostumes,
  removePresentCharacter,
  removeSceneCostume,
  renameCharacterInDetails,
  renameCharacterInScript,
  sceneAt,
  sceneDetailsAttr,
  setSceneCostumeWhen,
  shotCostumeFor,
  shotShowsCharacter,
} from './sceneDetails';
import { cleanCostumes, mergeCostumes, newCostumeId } from './characterCostumes';

const heading = (text: string, attrs: Record<string, unknown> = {}) => ({ ...block('sceneHeading', text), attrs });

describe('readSceneDetails', () => {
  it('reads what it wrote, and the JSON text the HTML form carries', () => {
    const d = { costumes: { ANNA: [{ costumeId: 'c1', when: '' }, { costumeId: 'c2', when: 'When she leaves' }] }, present: ['TEO'], lookId: 'look-1', setting: 'Morning prep' };
    expect(readSceneDetails(d)).toEqual(d);
    expect(readSceneDetails(JSON.stringify(d))).toEqual(d);
  });

  it('gives the empty details for nothing, or for anything malformed', () => {
    for (const raw of [null, undefined, 42, 'not json', [], { costumes: 'x', present: 'y' }]) {
      expect(readSceneDetails(raw)).toBe(EMPTY_SCENE_DETAILS);
    }
  });

  it('drops costumes without an id, repeats, and names that are not strings', () => {
    const d = readSceneDetails({
      costumes: { 'anna (cont’d)': [{ costumeId: 'c1' }, { costumeId: 'c1' }, { when: 'x' }, null], '': [{ costumeId: 'c9' }] },
      present: ['teo', 'teo', 3, ''],
    });
    expect(d.costumes).toEqual({ ANNA: [{ costumeId: 'c1', when: '' }] });
    expect(d.present).toEqual(['TEO']);
  });

  it('stores null when there is nothing to keep', () => {
    expect(sceneDetailsAttr(EMPTY_SCENE_DETAILS)).toBeNull();
    expect(isEmptySceneDetails(readSceneDetails({ setting: '' }))).toBe(true);
  });
});

describe('changing a scene’s costumes', () => {
  it('adds costumes in the order they are worn, once each', () => {
    let d = addSceneCostume(EMPTY_SCENE_DETAILS, 'anna', 'c1');
    d = addSceneCostume(d, 'ANNA', 'c2');
    d = addSceneCostume(d, 'ANNA', 'c1');
    expect(costumesIn(d, 'Anna').map((c) => c.costumeId)).toEqual(['c1', 'c2']);
    expect(EMPTY_SCENE_DETAILS.costumes).toEqual({}); // never mutated
  });

  it('notes when a change happens, reorders and removes', () => {
    let d = addSceneCostume(addSceneCostume(EMPTY_SCENE_DETAILS, 'ANNA', 'c1'), 'ANNA', 'c2');
    d = setSceneCostumeWhen(d, 'ANNA', 'c2', 'After the call');
    expect(costumesIn(d, 'ANNA')[1].when).toBe('After the call');
    d = moveSceneCostume(d, 'ANNA', 'c2', -1);
    expect(costumesIn(d, 'ANNA').map((c) => c.costumeId)).toEqual(['c2', 'c1']);
    expect(moveSceneCostume(d, 'ANNA', 'c2', -1)).toBe(d);
    d = removeSceneCostume(removeSceneCostume(d, 'ANNA', 'c1'), 'ANNA', 'c2');
    expect(d.costumes).toEqual({});
  });

  it('keeps someone who is there without speaking, and forgets their costumes when they go', () => {
    let d = addPresentCharacter(EMPTY_SCENE_DETAILS, 'luca');
    d = addPresentCharacter(addSceneCostume(d, 'LUCA', 'c5'), 'LUCA');
    expect(d.present).toEqual(['LUCA']);
    d = removePresentCharacter(d, 'LUCA');
    expect(d.present).toEqual([]);
    expect(d.costumes).toEqual({});
  });
});

describe('renaming a character', () => {
  it('moves costumes onto the new name after any it already had', () => {
    let d = addSceneCostume(addSceneCostume(EMPTY_SCENE_DETAILS, 'ANNA', 'c1'), 'ANN', 'c2');
    d = addPresentCharacter(d, 'ANN');
    const after = renameCharacterInDetails(d, 'ANN', 'ANNA');
    expect(costumesIn(after, 'ANNA').map((c) => c.costumeId)).toEqual(['c1', 'c2']);
    expect(after.costumes.ANN).toBeUndefined();
    expect(after.present).toEqual(['ANNA']);
  });

  it('leaves details that never mention the old name as they are', () => {
    const d = addSceneCostume(EMPTY_SCENE_DETAILS, 'TEO', 'c1');
    expect(renameCharacterInDetails(d, 'ANN', 'ANNA')).toBe(d);
  });

  it('rewrites the headings and shots of the script in one transaction', () => {
    const pm = testSchema.nodeFromJSON(doc(
      heading('INT. KITCHEN - DAY', { [SCENE_DETAILS_ATTR]: { costumes: { ANN: [{ costumeId: 'c1', when: '' }] }, present: [], lookId: null, setting: '' } }),
      { ...block('shot', 'CLOSE ON ANN.'), attrs: { [SHOT_COSTUMES_ATTR]: { ANN: 'c1' } } },
      heading('EXT. ROOF - NIGHT'),
    ));
    const state = EditorState.create({ schema: testSchema, doc: pm });
    const tr = state.tr;
    expect(renameCharacterInScript(tr, 'ANN', 'ANNA')).toBe(2);
    const briefs = collectSceneBriefs(tr.doc);
    expect(costumesIn(briefs[0].details, 'ANNA')).toEqual([{ costumeId: 'c1', when: '' }]);
    expect(briefs[0].shots[0].costumes).toEqual({ ANNA: 'c1' });
    expect(renameCharacterInScript(state.tr, 'NOBODY', 'SOMEONE')).toBe(0);
  });
});

describe('shots', () => {
  it('reads a shot’s costume choices, dropping anything malformed', () => {
    expect(readShotCostumes({ anna: 'c1', teo: 4, '': 'x' })).toEqual({ ANNA: 'c1' });
    expect(readShotCostumes('{"TEO":"c2"}')).toEqual({ TEO: 'c2' });
    expect(readShotCostumes('nope')).toEqual({});
  });

  it('a shot shows a character whose name stands as a word in it', () => {
    expect(shotShowsCharacter('TWO SHOT. Anna, jacket on, at the door. Teo watches.', 'TEO')).toBe(true);
    expect(shotShowsCharacter('WIDE. ANNA at the stove.', 'ANNA')).toBe(true);
    expect(shotShowsCharacter('WIDE. HANNAH at the stove.', 'ANNA')).toBe(false);
    expect(shotShowsCharacter('CLOSE ON the cup.', 'ANNA')).toBe(false);
  });

  it('uses the costume a shot picked, else the first for the first shot and the last after it', () => {
    const list = [{ costumeId: 'c1', when: '' }, { costumeId: 'c2', when: 'later' }];
    expect(shotCostumeFor(list, 'c2', 0)).toBe('c2');
    expect(shotCostumeFor(list, undefined, 0)).toBe('c1');
    expect(shotCostumeFor(list, 'gone', 2)).toBe('c2');
    expect(shotCostumeFor([], 'c1', 0)).toBeNull();
  });
});

describe('collectSceneBriefs', () => {
  const pm = testSchema.nodeFromJSON(doc(
    heading('INT. KITCHEN - DAY', { synopsis: 'Anna opens up.', sceneColor: '#2563eb', [SCENE_DETAILS_ATTR]: { costumes: {}, present: ['LUCA', 'ANNA'], lookId: null, setting: '' } }),
    block('action', 'Anna pours coffee.'),
    block('character', 'ANNA'),
    block('dialogue', 'It’s cold again.'),
    block('character', 'TEO (O.S.)'),
    block('parenthetical', '(calling)'),
    block('dialogue', 'Bus was late.'),
    block('dialogue', 'Sorry.'),
    block('action', 'She sighs.'),
    block('character', 'ANNA'),
    block('dialogue', 'Watch the stock.'),
    block('shot', 'WIDE. Anna at the stove.'),
    heading('EXT. ROOFTOP. NIGHT'),
    { type: 'dualDialogue', content: [
      { type: 'dualDialogueColumn', content: [block('character', 'ANNA'), block('dialogue', 'To the last one.')] },
      { type: 'dualDialogueColumn', content: [block('character', 'TEO'), block('dialogue', 'To the worst.')] },
    ] },
  ));
  const briefs = collectSceneBriefs(pm);

  it('lists every scene with what its heading says', () => {
    expect(briefs.map((b) => [b.index, b.heading, b.location, b.locationType, b.timeOfDay])).toEqual([
      [0, 'INT. KITCHEN - DAY', 'KITCHEN', 'interior', 'DAY'],
      [1, 'EXT. ROOFTOP. NIGHT', 'ROOFTOP', 'exterior', 'NIGHT'],
    ]);
    expect(briefs[0].synopsis).toBe('Anna opens up.');
    expect(briefs[0].color).toBe('#2563eb');
  });

  it('counts each speaker’s lines, then those there without speaking', () => {
    expect(briefs[0].cast).toEqual([
      { name: 'ANNA', lines: 2, silent: false },
      { name: 'TEO', lines: 2, silent: false },
      { name: 'LUCA', lines: 0, silent: true },
    ]);
  });

  it('finds speakers inside dual dialogue', () => {
    expect(briefs[1].cast.map((c) => [c.name, c.lines])).toEqual([['ANNA', 1], ['TEO', 1]]);
  });

  it('lists a scene’s shots', () => {
    expect(briefs[0].shots.map((s) => s.text)).toEqual(['WIDE. Anna at the stove.']);
    expect(briefs[1].shots).toEqual([]);
  });

  it('finds the scene a position is in', () => {
    expect(sceneAt(briefs, briefs[1].pos + 3)?.index).toBe(1);
    expect(sceneAt(briefs, briefs[0].pos)?.index).toBe(0);
    expect(sceneAt([], 10)).toBeNull();
  });
});

describe('headingTimeOfDay', () => {
  it.each([
    ['INT. KITCHEN - NIGHT', 'NIGHT'],
    ['EXT. BEACH', ''],
    ['INT. HOUSE - KITCHEN', ''],
    ['INT. LAB - MOMENTS LATER', 'MOMENTS LATER'],
    ['', ''],
  ])('%s → %s', (text, time) => {
    expect(headingTimeOfDay(text)).toBe(time);
  });
});

describe('character costumes', () => {
  it('keeps well-formed costumes once each', () => {
    expect(cleanCostumes([
      { id: 'c1', name: ' Chef whites ', imageAssetId: 'a1', notes: 'Stained' },
      { id: 'c1', name: 'Again' }, { name: 'No id' }, { id: 'c2', name: ' ' }, 'junk',
    ])).toEqual([{ id: 'c1', name: 'Chef whites', imageAssetId: 'a1', notes: 'Stained' }]);
    expect(cleanCostumes(undefined)).toEqual([]);
  });

  it('merges two lists without repeating an id', () => {
    const a = [{ id: 'c1', name: 'A', imageAssetId: null, notes: '' }];
    const b = [{ id: 'c1', name: 'A2', imageAssetId: null, notes: '' }, { id: 'c2', name: 'B', imageAssetId: null, notes: '' }];
    expect(mergeCostumes(a, b).map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('gives new ids that do not repeat', () => {
    const ids = new Set(Array.from({ length: 100 }, newCostumeId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^cos-[0-9a-f]{12}$/);
  });
});

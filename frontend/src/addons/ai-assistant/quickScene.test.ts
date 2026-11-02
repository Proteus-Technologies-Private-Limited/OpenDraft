import { describe, it, expect } from 'vitest';
import { parseQuickScene, parseSceneWithDialogue } from './quickScene';

describe('parseQuickScene', () => {
  it('turns an Italian move outside into a scene heading and action', () => {
    expect(parseQuickScene('ora siamo fuori casa, poco dopo. vilgax sta cacando')).toEqual({
      heading: 'EXT. CASA - LATER',
      action: 'vilgax sta cacando',
    });
  });

  it('understands inside and a time of day', () => {
    expect(parseQuickScene('siamo dentro casa, di notte. Ben dorme.')).toEqual({
      heading: 'INT. CASA - NIGHT',
      action: 'Ben dorme.',
    });
  });

  it('reads an explicit heading at the start', () => {
    expect(parseQuickScene('interno casa giorno, ben entra arrabbiato.')).toEqual({
      heading: 'INT. CASA - DAY',
      action: 'ben entra arrabbiato.',
    });
    expect(parseQuickScene('EXT. LAUNDRY - NIGHT, Ada waits.')).toEqual({
      heading: 'EXT. LAUNDRY - NIGHT',
      action: 'Ada waits.',
    });
  });

  it('reads a heading with no punctuation or action after it', () => {
    expect(parseQuickScene('esterno casa notte')).toEqual({ heading: 'EXT. CASA - NIGHT' });
    expect(parseQuickScene('interno casa giorno')).toEqual({ heading: 'INT. CASA - DAY' });
    expect(parseQuickScene('EXT. LAUNDRY - NIGHT')).toEqual({ heading: 'EXT. LAUNDRY - NIGHT' });
  });

  it('understands the English move', () => {
    expect(parseQuickScene('We are outside the house, a little later. Vilgax waits.')).toEqual({
      heading: 'EXT. HOUSE - LATER',
      action: 'Vilgax waits.',
    });
  });

  it('leaves dialogue and ordinary action to the model', () => {
    expect(parseQuickScene('Ben dice: Ciao a tutti.')).toBeNull();
    expect(parseQuickScene('Ben entra in casa e si siede.')).toBeNull();
  });

  it('leaves a heading whose body contains dialogue to the model', () => {
    expect(parseQuickScene(
      'interno casa giorno, ben entra arrabbiato. Ben urla "È L\'ORA DELL\'EROE!" e vilgax risponde "GODO PORCODIOOOOO"',
    )).toBeNull();
  });

  it('ignores very long prompts', () => {
    expect(parseQuickScene('siamo fuori casa, poco dopo. ' + 'x'.repeat(700))).toBeNull();
  });
});

describe('parseSceneWithDialogue', () => {
  it('splits a heading scene with two quoted lines into formatted blocks', () => {
    const out = parseSceneWithDialogue(
      'interno casa giorno, ben entra in casa arrabbiato, si spoglia nudo, vede vilgax che entra in casa. ben rimane impalato e urla "È L\'ORA DELL\'EROE!" e vilgax risponde "GODO PORCODIOOOOO"',
    );
    expect(out?.blocks).toEqual([
      { type: 'sceneHeading', text: 'INT. CASA - DAY' },
      { type: 'action', text: 'ben entra in casa arrabbiato, si spoglia nudo, vede vilgax che entra in casa.' },
      { type: 'action', text: 'ben rimane impalato' },
      { type: 'character', text: 'BEN' },
      { type: 'dialogue', text: "È L'ORA DELL'EROE!" },
      { type: 'character', text: 'VILGAX' },
      { type: 'dialogue', text: 'GODO PORCODIOOOOO' },
    ]);
  });

  it('reads an explicit heading and a named cue with a colon', () => {
    const out = parseSceneWithDialogue('INT. HOUSE - NIGHT, ADA: "Get out."');
    expect(out?.blocks).toEqual([
      { type: 'sceneHeading', text: 'INT. HOUSE - NIGHT' },
      { type: 'character', text: 'ADA' },
      { type: 'dialogue', text: 'Get out.' },
    ]);
  });

  it('returns null when a quote has no clear speaker', () => {
    expect(parseSceneWithDialogue('INT. HOUSE - NIGHT, "Get out."')).toBeNull();
  });
});

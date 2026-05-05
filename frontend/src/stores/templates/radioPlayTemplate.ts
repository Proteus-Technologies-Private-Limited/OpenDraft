/**
 * Radio play / audio drama format.
 *
 * Conventions:
 *  - SCENE numbers (no INT/EXT)
 *  - SOUND EFFECT and MUSIC CUE elements (all caps, distinguished from dialogue)
 *  - Narrator dialogue variant
 *  - No camera shots, no transitions
 */

import type { FormattingTemplate, StarterNode } from '../formattingTypes';
import { rule, disabled } from './_helpers';

export const RADIO_PLAY_ID = '__radio_play__';

const STARTER: StarterNode[] = [
  { type: 'sceneHeading', content: [{ type: 'text', text: 'SCENE 1' }] },
  { type: 'customElement', attrs: { customTypeId: 'soundEffect', customLabel: 'Sound Effect' }, content: [{ type: 'text', text: 'SFX: WAVES CRASHING ON A ROCKY SHORE.' }] },
  { type: 'customElement', attrs: { customTypeId: 'musicCue', customLabel: 'Music Cue' }, content: [{ type: 'text', text: 'MUSIC: SLOW STRINGS, SOMBER.' }] },
  { type: 'character', content: [{ type: 'text', text: 'NARRATOR' }] },
  { type: 'dialogue', content: [{ type: 'text', text: 'On a cold morning in October...' }] },
];

export const RADIO_PLAY_TEMPLATE: FormattingTemplate = {
  id: RADIO_PLAY_ID,
  name: 'Radio Play',
  description: 'Audio drama: numbered scenes, SOUND/MUSIC cues, narrator. No camera or visual elements.',
  mode: 'override',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  scriptTypeGroup: 'Audio',
  scriptTypeTagline: 'Radio drama / audio play (BBC, podcast fiction)',
  pageTimeSeconds: 60,
  starterDocument: STARTER,
  rules: {
    sceneHeading: rule('sceneHeading', 'Scene', true, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 18,
      nextOnEnter: 'soundEffect',
      nextOnTab: 'character',
      placeholder: 'SCENE 1',
    }),
    action: rule('action', 'Action', true, {
      marginTop: 6,
      nextOnEnter: 'character',
      placeholder: 'Action description...',
    }),
    character: rule('character', 'Character', true, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 12,
      leftIndent: 3.50,
      nextOnEnter: 'dialogue',
      nextOnTab: 'parenthetical',
      placeholder: 'CHARACTER NAME',
    }),
    dialogue: rule('dialogue', 'Dialogue', true, {
      leftIndent: 2.50,
      rightIndent: 6.00,
      nextOnEnter: 'character',
      nextOnTab: 'parenthetical',
      placeholder: 'Dialogue...',
    }),
    parenthetical: rule('parenthetical', 'Parenthetical', true, {
      italic: true,
      leftIndent: 3.00,
      rightIndent: 5.50,
      nextOnEnter: 'dialogue',
      placeholder: '(beat / off-mic)',
    }),
    transition: disabled('transition', 'Transition'),
    general: rule('general', 'General', true, { nextOnEnter: 'general' }),
    shot: disabled('shot', 'Shot'),
    newAct: rule('newAct', 'New Act', true, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'sceneHeading',
      placeholder: 'ACT ONE',
    }),
    endOfAct: rule('endOfAct', 'End of Act', true, {
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'newAct',
      placeholder: 'END OF ACT ONE',
    }),
    lyrics: rule('lyrics', 'Lyrics', true, {
      italic: true,
      leftIndent: 2.50,
      rightIndent: 6.00,
      nextOnEnter: 'lyrics',
      placeholder: 'Lyrics...',
    }),
    showEpisode: rule('showEpisode', 'Show/Episode', true, {
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 12,
      nextOnEnter: 'sceneHeading',
      placeholder: 'SHOW TITLE',
    }),
    castList: disabled('castList', 'Cast List'),
    // Custom: SFX cue, all caps
    soundEffect: rule('soundEffect', 'Sound Effect', false, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: 'character',
      placeholder: 'SFX: ...',
    }),
    // Custom: music cue, all caps + italic
    musicCue: rule('musicCue', 'Music Cue', false, {
      bold: true,
      italic: true,
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: 'character',
      placeholder: 'MUSIC: ...',
    }),
  },
};

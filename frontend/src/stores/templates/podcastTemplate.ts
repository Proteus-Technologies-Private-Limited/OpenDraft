/**
 * Scripted podcast / audio fiction format.
 *
 * Radio Play's elements and layout, with the numbers a recording session works
 * from (utils/elementNumbers):
 *  - every line of dialogue numbered through the whole script, so the director
 *    can call "pick up from 41";
 *  - sound effects and music cues numbered on their own as FX 1, FX 2… and
 *    MX 1, MX 2…, the labels a cue sheet uses.
 *
 * Built from the Radio Play rules rather than copied, so the two audio formats
 * keep one layout. Radio Play itself numbers nothing: scripts already written
 * in it must not grow numbers they never had.
 */

import type { ElementNumbering, FormattingElementRule, FormattingTemplate, StarterNode } from '../formattingTypes';
import { RADIO_PLAY_TEMPLATE } from './radioPlayTemplate';

export const PODCAST_ID = '__podcast__';

const STARTER: StarterNode[] = [
  { type: 'sceneHeading', content: [{ type: 'text', text: 'SCENE 1' }] },
  { type: 'customElement', attrs: { customTypeId: 'soundEffect', customLabel: 'Sound Effect' }, content: [{ type: 'text', text: 'SFX: RAIN ON A TIN ROOF.' }] },
  { type: 'character', content: [{ type: 'text', text: 'HOST' }] },
  { type: 'dialogue', content: [{ type: 'text', text: 'Welcome back. Tonight, a story about a lighthouse.' }] },
  { type: 'customElement', attrs: { customTypeId: 'musicCue', customLabel: 'Music Cue' }, content: [{ type: 'text', text: 'MUSIC: THEME IN, THEN UNDER.' }] },
  { type: 'character', content: [{ type: 'text', text: 'KEEPER' }] },
  { type: 'dialogue', content: [{ type: 'text', text: 'Nobody has climbed those stairs in twenty years.' }] },
];

/** A Radio Play rule with numbering switched on. A fresh object: the Radio
 *  Play rules are a shared system template and must never be reached. */
function numbered(id: string, numbering: ElementNumbering): FormattingElementRule {
  return { ...RADIO_PLAY_TEMPLATE.rules[id], numbering: { ...numbering, resetOn: [...numbering.resetOn] } };
}

export const PODCAST_TEMPLATE: FormattingTemplate = {
  id: PODCAST_ID,
  name: 'Podcast',
  description: 'Scripted podcast and audio fiction: every line of dialogue numbered for the recording session, FX and music cues numbered on their own.',
  mode: 'override',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  scriptTypeGroup: 'Audio',
  scriptTypeTagline: 'Scripted podcast / audio fiction, lines numbered for recording',
  pageTimeSeconds: RADIO_PLAY_TEMPLATE.pageTimeSeconds,
  starterDocument: STARTER,
  rules: {
    ...Object.fromEntries(Object.entries(RADIO_PLAY_TEMPLATE.rules).map(([id, r]) => [id, { ...r }])),
    dialogue: numbered('dialogue', { enabled: true, resetOn: [] }),
    soundEffect: numbered('soundEffect', { enabled: true, resetOn: [], prefix: 'FX ' }),
    musicCue: numbered('musicCue', { enabled: true, resetOn: [], prefix: 'MX ' }),
  },
};

/**
 * Single-camera 1-hour TV drama (Breaking Bad, Stranger Things).
 *
 * Very close to feature screenplay; main differences:
 *  - Acts I–V structure (Teaser optional)
 *  - 1 page = ~60 sec
 */

import type { FormattingTemplate, StarterNode } from '../formattingTypes';
import { rule } from './_helpers';

export const ONE_HOUR_DRAMA_ID = '__one_hour_drama__';

const STARTER: StarterNode[] = [
  { type: 'newAct', content: [{ type: 'text', text: 'TEASER' }] },
  { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LOCATION - DAY' }] },
  { type: 'action', content: [{ type: 'text', text: 'Open on...' }] },
  { type: 'endOfAct', content: [{ type: 'text', text: 'END OF TEASER' }] },
  { type: 'newAct', content: [{ type: 'text', text: 'ACT ONE' }] },
  { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LOCATION - DAY' }] },
  { type: 'endOfAct', content: [{ type: 'text', text: 'END OF ACT ONE' }] },
  { type: 'newAct', content: [{ type: 'text', text: 'TAG' }] },
  { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LOCATION - DAY' }] },
  { type: 'action', content: [{ type: 'text', text: 'Closing beat...' }] },
  { type: 'endOfAct', content: [{ type: 'text', text: 'END OF TAG' }] },
];

export const ONE_HOUR_DRAMA_TEMPLATE: FormattingTemplate = {
  id: ONE_HOUR_DRAMA_ID,
  name: '1-Hour TV Drama',
  description: 'Single-camera teleplay for hour-long dramas. Same look as a feature screenplay with TV act structure (Teaser, Acts I–V).',
  mode: 'override',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  scriptTypeGroup: 'TV',
  scriptTypeTagline: '1-hour single-camera drama (Breaking Bad, Stranger Things)',
  pageTimeSeconds: 60,
  starterDocument: STARTER,
  rules: {
    sceneHeading: rule('sceneHeading', 'Scene Heading', true, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: 'action',
      nextOnTab: 'action',
      placeholder: 'INT./EXT. LOCATION - TIME',
    }),
    action: rule('action', 'Action', true, {
      marginTop: 12,
      nextOnEnter: 'action',
      nextOnTab: 'character',
      placeholder: 'Describe the action...',
    }),
    character: rule('character', 'Character', true, {
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
      nextOnEnter: 'dialogue',
      nextOnTab: 'parenthetical',
      placeholder: 'Dialogue...',
    }),
    parenthetical: rule('parenthetical', 'Parenthetical', true, {
      leftIndent: 3.00,
      rightIndent: 5.50,
      nextOnEnter: 'dialogue',
      placeholder: '(direction)',
    }),
    transition: rule('transition', 'Transition', true, {
      textTransform: 'uppercase',
      textAlign: 'right',
      marginTop: 12,
      leftIndent: 5.50,
      nextOnEnter: 'sceneHeading',
      placeholder: 'CUT TO:',
    }),
    general: rule('general', 'General', true, { nextOnEnter: 'general' }),
    shot: rule('shot', 'Shot', true, {
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'SHOT DESCRIPTION',
    }),
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
      nextOnEnter: 'newAct',
      placeholder: 'SHOW TITLE',
    }),
    castList: rule('castList', 'Cast List', true, {
      textTransform: 'uppercase',
      leftIndent: 1.75,
      nextOnEnter: 'castList',
      placeholder: 'Cast...',
    }),
  },
};


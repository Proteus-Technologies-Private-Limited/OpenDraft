/**
 * Multi-camera sitcom teleplay format (Big Bang Theory, Seinfeld, Mom).
 *
 * Conventions:
 *  - Stage directions ALL CAPS + UNDERLINED
 *  - Scene headings ALL CAPS + UNDERLINED
 *  - Dialogue is double-spaced
 *  - Each scene starts on a new page
 *  - Scene character list (parenthesized, all-caps) immediately after scene heading
 *  - Page = ~30 sec of screen time (vs 60 sec for single-cam)
 */

import type { FormattingTemplate, StarterNode } from '../formattingTypes';
import { rule, disabled } from './_helpers';

export const MULTICAM_SITCOM_ID = '__multicam_sitcom__';

const STARTER: StarterNode[] = [
  { type: 'newAct', content: [{ type: 'text', text: 'COLD OPEN' }] },
  { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LIVING ROOM - DAY' }] },
  { type: 'customElement', attrs: { customTypeId: 'sceneCharacters', customLabel: 'Scene Characters' }, content: [{ type: 'text', text: '(CHARACTER A, CHARACTER B)' }] },
  { type: 'action', content: [{ type: 'text', text: 'CHARACTER A ENTERS THROUGH THE FRONT DOOR.' }] },
  { type: 'endOfAct', content: [{ type: 'text', text: 'END OF COLD OPEN' }] },
  { type: 'newAct', content: [{ type: 'text', text: 'ACT ONE' }] },
  { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LIVING ROOM - DAY' }] },
  { type: 'customElement', attrs: { customTypeId: 'sceneCharacters', customLabel: 'Scene Characters' }, content: [{ type: 'text', text: '(CHARACTER A, CHARACTER B)' }] },
  { type: 'endOfAct', content: [{ type: 'text', text: 'END OF ACT ONE' }] },
  { type: 'newAct', content: [{ type: 'text', text: 'TAG' }] },
  { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LIVING ROOM - NIGHT' }] },
  { type: 'customElement', attrs: { customTypeId: 'sceneCharacters', customLabel: 'Scene Characters' }, content: [{ type: 'text', text: '(CHARACTER A)' }] },
  { type: 'action', content: [{ type: 'text', text: 'A FINAL BUTTON BEAT.' }] },
  { type: 'endOfAct', content: [{ type: 'text', text: 'END OF TAG' }] },
];

export const MULTICAM_SITCOM_TEMPLATE: FormattingTemplate = {
  id: MULTICAM_SITCOM_ID,
  name: 'Multi-Cam Sitcom',
  description: 'Multi-camera teleplay (live-audience sitcoms): double-spaced dialogue, all-caps underlined stage directions, scene character list, scene-per-page.',
  mode: 'override',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  scriptTypeGroup: 'TV',
  scriptTypeTagline: 'Live-audience sitcom (Big Bang Theory, Mom)',
  pageTimeSeconds: 30,
  forceBreakBefore: ['sceneHeading'],
  lineHeightMultiplier: { dialogue: 2.0 },
  starterDocument: STARTER,
  rules: {
    sceneHeading: rule('sceneHeading', 'Scene Heading', true, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      marginTop: 24,
      nextOnEnter: 'sceneCharacters',
      nextOnTab: 'action',
      placeholder: 'INT./EXT. LOCATION - TIME',
    }),
    action: rule('action', 'Stage Direction', true, {
      underline: true,
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: 'character',
      nextOnTab: 'character',
      placeholder: 'ENTER/EXIT/CROSS...',
    }),
    character: rule('character', 'Character', true, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 24,
      leftIndent: 3.50,
      nextOnEnter: 'dialogue',
      nextOnTab: 'parenthetical',
      placeholder: 'CHARACTER NAME',
    }),
    dialogue: rule('dialogue', 'Dialogue', true, {
      leftIndent: 2.50,
      rightIndent: 6.00,
      marginTop: 6,
      nextOnEnter: 'character',
      nextOnTab: 'parenthetical',
      placeholder: 'Dialogue...',
    }),
    parenthetical: rule('parenthetical', 'Parenthetical', true, {
      italic: true,
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
    shot: disabled('shot', 'Shot'),
    newAct: rule('newAct', 'Act/Scene Heading', true, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'sceneHeading',
      placeholder: 'ACT ONE',
    }),
    endOfAct: rule('endOfAct', 'End of Act/Scene', true, {
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
    // Custom element: parenthesized list of characters appearing in the scene
    sceneCharacters: rule('sceneCharacters', 'Scene Characters', false, {
      italic: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 6,
      nextOnEnter: 'action',
      placeholder: '(CHARACTER A, CHARACTER B)',
    }),
  },
};

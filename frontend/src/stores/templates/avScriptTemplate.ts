/**
 * AV (Audio | Video) two-column script — used for commercials, corporate
 * videos, documentary scripts, and other industrial/promotional formats.
 *
 * Document body is a sequence of avBlock nodes (each containing one or more
 * avRows of two cells). The starter document seeds one empty row.
 */

import type { FormattingTemplate, StarterNode } from '../formattingTypes';
import { rule, disabled } from './_helpers';

export const AV_SCRIPT_ID = '__av_script__';

const STARTER: StarterNode[] = [
  {
    type: 'avBlock',
    content: [
      {
        type: 'avRow',
        content: [
          {
            type: 'avCell',
            attrs: { side: 'video' },
            content: [
              { type: 'avShot', content: [{ type: 'text', text: 'WIDE ON A BUSY CITY STREET.' }] },
            ],
          },
          {
            type: 'avCell',
            attrs: { side: 'audio' },
            content: [
              { type: 'avPara', content: [{ type: 'text', text: 'NARRATOR (V.O.): Every day, millions of decisions...' }] },
            ],
          },
        ],
      },
    ],
  },
];

export const AV_SCRIPT_TEMPLATE: FormattingTemplate = {
  id: AV_SCRIPT_ID,
  name: 'AV Script (Two Column)',
  description: 'Two-column Audio | Video script — commercials, corporate video, documentary. Each row pairs a video shot with its audio.',
  mode: 'override',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  scriptTypeGroup: 'AV',
  scriptTypeTagline: 'Two-column commercial / corporate / documentary script',
  pageTimeSeconds: 30,
  starterDocument: STARTER,
  rules: {
    // Most screenplay elements are still available outside the AV body
    // (e.g. for a title page or intro paragraphs above the AV section).
    sceneHeading: rule('sceneHeading', 'Scene Heading', true, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'INT./EXT. LOCATION - TIME',
    }),
    action: rule('action', 'Action', true, {
      marginTop: 6,
      nextOnEnter: 'action',
      placeholder: 'Pre-roll text...',
    }),
    character: disabled('character', 'Character'),
    dialogue: disabled('dialogue', 'Dialogue'),
    parenthetical: disabled('parenthetical', 'Parenthetical'),
    transition: rule('transition', 'Transition', true, {
      textTransform: 'uppercase',
      textAlign: 'right',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'CUT TO:',
    }),
    general: rule('general', 'General', true, { nextOnEnter: 'general' }),
    shot: disabled('shot', 'Shot'),
    newAct: rule('newAct', 'Section', true, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'action',
      placeholder: 'SECTION ONE',
    }),
    endOfAct: disabled('endOfAct', 'End of Act'),
    lyrics: disabled('lyrics', 'Lyrics'),
    showEpisode: rule('showEpisode', 'Title', true, {
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'TITLE',
    }),
    castList: disabled('castList', 'Cast List'),
    // Inner AV-cell paragraphs — formatting only, since they live inside avCell.
    avPara: rule('avPara', 'Audio/Video Body', false, {
      nextOnEnter: 'avPara',
      placeholder: 'Body text...',
    }),
    avShot: rule('avShot', 'Video Shot', false, {
      bold: true,
      textTransform: 'uppercase',
      nextOnEnter: 'avPara',
      placeholder: 'WIDE ON / CLOSE UP / ETC.',
    }),
    avDirection: rule('avDirection', 'Audio Direction', false, {
      italic: true,
      nextOnEnter: 'avPara',
      placeholder: '(audio direction)',
    }),
  },
};

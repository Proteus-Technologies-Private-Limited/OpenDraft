/**
 * AV (Audio | Video) two-column script — used for commercials, corporate
 * videos, documentary scripts, and other industrial/promotional formats.
 *
 * Document body is a sequence of avBlock nodes (each containing one or more
 * avRows of two cells). The starter document seeds one empty row.
 */

import type { FormattingTemplate, StarterNode } from '../formattingTypes';
import { rule, disabled, outlineRules, avBlockRule } from './_helpers';

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
      // Staging and what happens on screen — the visual column.
      avCell: 'video',
    }),
    // On-camera speech. An AV script is not narration-only: a corporate video
    // has a spokesperson, a documentary has an interview, and both are ordinary
    // dialogue. Final Draft AV carried Character and Dialogue as styles inside
    // the columns, and WriterDuet's A/V template puts them in the audio one —
    // which is where `avCell` sends them here. Disabling them outright, as this
    // template used to, left no way to write a piece to camera at all.
    character: rule('character', 'Character', true, {
      textTransform: 'uppercase',
      bold: true,
      marginTop: 6,
      nextOnEnter: 'dialogue',
      nextOnTab: 'parenthetical',
      placeholder: 'CHARACTER NAME',
      avCell: 'audio',
    }),
    dialogue: rule('dialogue', 'Dialogue', true, {
      nextOnEnter: 'action',
      placeholder: 'Dialogue...',
      avCell: 'audio',
    }),
    parenthetical: rule('parenthetical', 'Parenthetical', true, {
      italic: true,
      nextOnEnter: 'dialogue',
      placeholder: '(direction)',
      avCell: 'audio',
    }),
    transition: rule('transition', 'Transition', true, {
      textTransform: 'uppercase',
      textAlign: 'right',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'CUT TO:',
    }),
    general: rule('general', 'General (Unformatted text)', true, {
      nextOnEnter: 'general',
      avCell: 'both',
    }),
    // A camera instruction belongs in the visual column, beside the shot it
    // describes — the same split WriterDuet's A/V template draws.
    shot: rule('shot', 'Shot', true, {
      textTransform: 'uppercase',
      marginTop: 6,
      nextOnEnter: 'action',
      placeholder: 'SHOT DESCRIPTION',
      avCell: 'video',
    }),
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
    // Music video is a first-class AV format — it is what Celtx's own AV guide
    // is written around — and a lyric is sung audio.
    lyrics: rule('lyrics', 'Lyrics', true, {
      italic: true,
      nextOnEnter: 'lyrics',
      placeholder: 'Lyrics...',
      avCell: 'audio',
    }),
    showEpisode: rule('showEpisode', 'Title', true, {
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'TITLE',
    }),
    ...outlineRules(),
    castList: disabled('castList', 'Cast List'),
    // Offered in the element menu so a second AV body — after an intro
    // paragraph, or under a scene heading that titles it — can be started
    // without going to the Format menu.
    ...avBlockRule(true),
    // The four AV paragraph types. `avCell: 'both'` is what they are, not a
    // setting: they exist only inside a cell, they are what an AV body is made
    // of, and the element menu offers all four in either column whatever a
    // template says — see utils/avCellElements.ts. Only their formatting is
    // the template's to change.
    avPara: rule('avPara', 'Audio/Video Body', false, {
      nextOnEnter: 'avPara',
      placeholder: 'Body text...',
      avCell: 'both',
    }),
    avShot: rule('avShot', 'Video Shot', false, {
      bold: true,
      textTransform: 'uppercase',
      nextOnEnter: 'avPara',
      placeholder: 'WIDE ON / CLOSE UP / ETC.',
      avCell: 'both',
    }),
    avDirection: rule('avDirection', 'Audio Direction', false, {
      italic: true,
      nextOnEnter: 'avPara',
      placeholder: '(audio direction)',
      avCell: 'both',
    }),
    avGraphic: rule('avGraphic', 'On-Screen Text', false, {
      textTransform: 'uppercase',
      nextOnEnter: 'avPara',
      placeholder: 'SUPER / LOWER THIRD / CAPTION',
      avCell: 'both',
    }),
  },
};

/**
 * Stage play format (theater).
 *
 * Conventions:
 *  - Character names CENTERED above dialogue (no leftIndent slug)
 *  - Stage directions in italic, parenthesized, indented
 *  - ACT / SCENE headings instead of INT/EXT slugs
 *  - No camera shots, no transitions, no cast list (use program for cast)
 */

import type { FormattingTemplate, StarterNode } from '../formattingTypes';
import { rule, disabled } from './_helpers';

export const STAGE_PLAY_ID = '__stage_play__';

const STARTER: StarterNode[] = [
  { type: 'newAct', content: [{ type: 'text', text: 'ACT I' }] },
  { type: 'sceneHeading', content: [{ type: 'text', text: 'SCENE 1' }] },
  { type: 'customElement', attrs: { customTypeId: 'stageDirection', customLabel: 'Stage Direction' }, content: [{ type: 'text', text: '(The lights rise on a sparsely furnished room.)' }] },
];

export const STAGE_PLAY_TEMPLATE: FormattingTemplate = {
  id: STAGE_PLAY_ID,
  name: 'Stage Play',
  description: 'Theater script: centered character names, italic parenthetical stage directions, ACT/SCENE structure.',
  mode: 'override',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  scriptTypeGroup: 'Stage',
  scriptTypeTagline: 'Theater script (acts, scenes, centered characters)',
  pageTimeSeconds: 60,
  starterDocument: STARTER,
  titlePageFields: ['tpTitle', 'tpWrittenBy', 'tpDraft', 'tpDraftDate', 'tpContact', 'tpCopyright', 'tpNotes'],
  rules: {
    sceneHeading: rule('sceneHeading', 'Scene Heading', true, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 18,
      nextOnEnter: 'stageDirection',
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
      textAlign: 'center',
      marginTop: 12,
      leftIndent: 1.50,
      rightIndent: 7.50,
      nextOnEnter: 'dialogue',
      nextOnTab: 'parenthetical',
      placeholder: 'CHARACTER NAME',
    }),
    dialogue: rule('dialogue', 'Dialogue', true, {
      leftIndent: 1.50,
      rightIndent: 7.50,
      nextOnEnter: 'character',
      nextOnTab: 'parenthetical',
      placeholder: 'Dialogue...',
    }),
    parenthetical: rule('parenthetical', 'Parenthetical', true, {
      italic: true,
      leftIndent: 2.50,
      rightIndent: 6.50,
      nextOnEnter: 'dialogue',
      placeholder: '(direction)',
    }),
    transition: disabled('transition', 'Transition'),
    general: rule('general', 'General', true, { nextOnEnter: 'general' }),
    shot: disabled('shot', 'Shot'),
    newAct: rule('newAct', 'New Act', true, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 36,
      fontSize: 16,
      nextOnEnter: 'sceneHeading',
      placeholder: 'ACT I',
    }),
    endOfAct: rule('endOfAct', 'End of Act', true, {
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'newAct',
      placeholder: 'END OF ACT I',
    }),
    lyrics: rule('lyrics', 'Lyrics', true, {
      italic: true,
      textAlign: 'center',
      leftIndent: 2.00,
      rightIndent: 7.00,
      nextOnEnter: 'lyrics',
      placeholder: 'Lyrics...',
    }),
    showEpisode: disabled('showEpisode', 'Show/Episode'),
    castList: disabled('castList', 'Cast List'),
    // Custom: italic, parenthesized stage direction set off from dialogue
    stageDirection: rule('stageDirection', 'Stage Direction', false, {
      italic: true,
      leftIndent: 2.50,
      rightIndent: 6.50,
      marginTop: 6,
      nextOnEnter: 'character',
      placeholder: '(stage direction)',
    }),
  },
};

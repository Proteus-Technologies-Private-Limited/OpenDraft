/**
 * Industry Standard formatting template — codifies the hardcoded CSS rules
 * and Enter/Tab transitions from the original screenplay editor.
 *
 * This is a readonly constant, never stored in the database.
 */

import type { FormattingTemplate, FormattingElementRule } from './formattingTypes';
import { INDUSTRY_STANDARD_ID } from './formattingTypes';
import { outlineRules, titlePageRules, avBlockRule } from './templates/_helpers';

function rule(
  id: string,
  label: string,
  overrides: Partial<FormattingElementRule>,
): FormattingElementRule {
  return {
    id,
    label,
    isBuiltIn: true,
    enabled: true,
    fontFamily: null,
    fontSize: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    textTransform: 'none',
    textColor: null,
    backgroundColor: null,
    textAlign: 'left',
    marginTop: 0,
    leftIndent: 1.50,
    rightIndent: 7.50,
    nextOnEnter: id,
    nextOnTab: null,
    placeholder: '',
    allowFormatOverride: true,
    avCell: 'none',
    ...overrides,
  };
}

export const INDUSTRY_STANDARD_TEMPLATE: FormattingTemplate = {
  id: INDUSTRY_STANDARD_ID,
  name: 'Film Screenplay',
  description: 'Industry-standard feature-film screenplay formatting (Final Draft compatible).',
  mode: 'enforce',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  rules: {
    sceneHeading: rule('sceneHeading', 'Scene Heading', {
      textColor: '#FF2600',
      bold: true,
      textTransform: 'uppercase',
      // Two blank lines, matching Final Draft's Screenplay template default
      // (Space Before = 2) and what WriTea Draft's own FDX and OSF exporters have
      // always written. Documents saved under the previous one-line default are
      // pinned to it on load and offered the change — see
      // `sceneHeadingSpaceBefore` in editorStore.
      marginTop: 24,
      nextOnEnter: 'action',
      nextOnTab: 'action',
      placeholder: 'INT./EXT. LOCATION - TIME',
    }),
    action: rule('action', 'Action', {
      textColor: '#AB7942',
      marginTop: 12,
      nextOnEnter: 'action',
      nextOnTab: 'character',
      placeholder: 'Describe the action...',
    }),
    character: rule('character', 'Character', {
      textColor: '#0096FF',
      textTransform: 'uppercase',
      marginTop: 12,
      leftIndent: 3.50,
      nextOnEnter: 'dialogue',
      nextOnTab: 'parenthetical',
      placeholder: 'CHARACTER NAME',
    }),
    dialogue: rule('dialogue', 'Dialogue', {
      textColor: '#009400',
      leftIndent: 2.50,
      rightIndent: 6.00,
      nextOnEnter: 'action',
      nextOnTab: 'parenthetical',
      placeholder: 'Dialogue...',
    }),
    parenthetical: rule('parenthetical', 'Parenthetical', {
      textColor: '#00DA00',
      leftIndent: 3.00,
      rightIndent: 5.50,
      nextOnEnter: 'dialogue',
      nextOnTab: 'dialogue',
      placeholder: 'Parenthetical',
    }),
    transition: rule('transition', 'Transition', {
      textColor: '#FF9300',
      textTransform: 'uppercase',
      textAlign: 'right',
      marginTop: 12,
      leftIndent: 5.50,
      nextOnEnter: 'sceneHeading',
      nextOnTab: 'sceneHeading',
      placeholder: 'TRANSITION:',
    }),
    general: rule('general', 'General (Unformatted text)', {
      nextOnEnter: 'general',
      placeholder: 'Text...',
    }),
    shot: rule('shot', 'Shot', {
      textColor: '#9437FF',
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'SHOT DESCRIPTION',
    }),
    newAct: rule('newAct', 'New Act', {
      enabled: false,
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'sceneHeading',
      placeholder: 'ACT ONE',
    }),
    endOfAct: rule('endOfAct', 'End of Act', {
      enabled: false,
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'newAct',
      placeholder: 'END OF ACT',
    }),
    lyrics: rule('lyrics', 'Lyrics', {
      enabled: false,
      italic: true,
      leftIndent: 2.50,
      rightIndent: 6.00,
      nextOnEnter: 'lyrics',
      placeholder: 'Lyrics...',
    }),
    showEpisode: rule('showEpisode', 'Show/Episode', {
      enabled: false,
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 12,
      nextOnEnter: 'action',
      placeholder: 'SHOW TITLE',
    }),
    castList: rule('castList', 'Cast List', {
      enabled: false,
      textTransform: 'uppercase',
      leftIndent: 1.75,
      nextOnEnter: 'castList',
      placeholder: 'Cast...',
    }),
    // Alt: a custom element carried over from the writer's Final Draft template.
    // Dialogue indents, pink text, Enter returns to Action. Shortcut: Ctrl+; (see
    // elementShortcuts in ScreenplayEditor).
    alt: rule('alt', 'Alt', {
      isBuiltIn: false,
      textColor: '#FF8AD8',
      leftIndent: 2.50,
      rightIndent: 6.00,
      nextOnEnter: 'action',
      nextOnTab: 'action',
      placeholder: 'Alt...',
    }),
    // Section and Note are Fountain outline elements that Final Draft does not have.
    ...Object.fromEntries(
      Object.entries(outlineRules()).map(([id, r]) => [id, { ...r, enabled: false }]),
    ),
    // A two-column AV body. On in a screenplay because a screenplay genuinely
    // has them — a commercial inside a feature, a documentary insert, a music
    // video sequence — and because `Insert AV Columns` has always worked here;
    // this is what puts it in the element menu beside every other element,
    // rather than only in the Format menu.
    ...avBlockRule(false),
    // The title page's own elements, so its typography is part of the template
    // rather than fixed in the stylesheet.
    ...titlePageRules(),
  },
};

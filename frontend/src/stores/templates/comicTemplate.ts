/**
 * Comic book / graphic novel full script.
 *
 * Laid out the way full scripts for Dark Horse, Image and DC are written, and
 * the way Final Draft's and Fade In's comic templates break them down:
 *
 *      PAGE ONE (TWO PANELS)         ← Page: starts a new sheet
 *      PANEL 1                       ← Panel: numbered within the page
 *      Wide on the lighthouse…       ← Description, for the artist
 *    1 CAPTION: The northern coast.  ← lettering numbers: captions and
 *                MARA                   balloons in one run down the page
 *         2 Twenty years…
 *      SFX: KRA-KOOM                 ← sound effect, not lettered
 *
 * Every number is worked out by element numbering (utils/elementNumbers), never
 * typed, so moving a panel or cutting a page renumbers everything after it:
 *  - Page is numbered through the whole script, spelled out — PAGE ONE — as the
 *    start of its own line;
 *  - Panel is numbered PANEL 1, 2, 3… and starts again on every Page;
 *  - each balloon (Dialogue) and each Caption takes the next lettering number
 *    on the page, in the margin, the numbers a letterer places on the art.
 *
 * Page and Panel are headings whose number is their text, so they are counted
 * even while empty; anything typed on them follows the number — "(SPLASH)",
 * "(FIVE PANELS)".
 *
 * Caption, SFX and Note to Artist keep the full Description width: custom
 * elements print and paginate at General's indents (utils/pdfExporter
 * FD_INDENTS), so an indent set here would wrap one way on screen and another
 * on paper.
 */

import type { FormattingTemplate, StarterNode } from '../formattingTypes';
import { rule, disabled, outlineRules, avBlockRule } from './_helpers';

export const COMIC_ID = '__comic__';

/** The custom element ids, for the template's rules and tests. */
export const COMIC_PAGE = 'comicPage';
export const COMIC_PANEL = 'comicPanel';
export const COMIC_CAPTION = 'caption';
export const COMIC_SFX = 'soundEffect';
export const COMIC_ARTIST_NOTE = 'artistNote';

const custom = (customTypeId: string, customLabel: string, text?: string): StarterNode => ({
  type: 'customElement',
  attrs: { customTypeId, customLabel },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});
const para = (type: string, text: string): StarterNode => ({ type, content: [{ type: 'text', text }] });

const STARTER: StarterNode[] = [
  custom(COMIC_PAGE, 'Page', '(TWO PANELS)'),
  custom(COMIC_PANEL, 'Panel'),
  para('action', 'Wide, establishing. A lighthouse on a black rock, waves exploding against its base. Night, and a storm coming in.'),
  custom(COMIC_CAPTION, 'Caption', 'CAPTION: The northern coast. 1953.'),
  custom(COMIC_SFX, 'SFX', 'SFX: KRA-KOOOM'),
  custom(COMIC_PANEL, 'Panel'),
  para('action', 'Inside the lamp room. MARA (30s, oilskin coat) stares out at the storm, one hand on the glass.'),
  para('character', 'MARA'),
  para('dialogue', 'Twenty years, and it has never once gone dark.'),
  para('character', 'MARA (WHISPER)'),
  para('dialogue', 'Until tonight.'),
  custom(COMIC_PAGE, 'Page', '(SPLASH)'),
  custom(COMIC_PANEL, 'Panel'),
  para('action', 'Full page. The lamp is out. Below, in the black water, something enormous is rising.'),
  custom(COMIC_ARTIST_NOTE, 'Note to Artist', 'NOTE: Keep the reader’s eye on the water — the creature should take a second look to find.'),
];

export const COMIC_TEMPLATE: FormattingTemplate = {
  id: COMIC_ID,
  name: 'Comic Book',
  description: 'Comic book and graphic novel full script: pages and panels numbered automatically, captions and balloons lettered 1, 2, 3 down each page.',
  mode: 'override',
  category: 'system',
  createdAt: '',
  updatedAt: '',
  scriptTypeGroup: 'Comics',
  scriptTypeTagline: 'Comic book / graphic novel full script, pages and panels numbered',
  starterDocument: STARTER,
  // Each comic page starts a fresh sheet, so the artist can be handed a page
  // of script per page of art. Switched off in the Template Editor like any
  // other forced break.
  forceBreakBefore: [COMIC_PAGE],
  rules: {
    // Kept for a writer who wants sequences, but not in the Enter/Tab flow and
    // numbered by nothing here: a comic script is paced in pages, not scenes.
    sceneHeading: rule('sceneHeading', 'Scene Heading', true, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 24,
      nextOnEnter: COMIC_PAGE,
      placeholder: 'SEQUENCE / LOCATION',
    }),
    action: rule('action', 'Description', true, {
      marginTop: 6,
      nextOnEnter: 'character',
      nextOnTab: COMIC_CAPTION,
      placeholder: 'What the artist draws in this panel...',
    }),
    character: rule('character', 'Character', true, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 12,
      leftIndent: 3.50,
      nextOnEnter: 'dialogue',
      nextOnTab: 'parenthetical',
      placeholder: 'CHARACTER (WHISPER)',
    }),
    // Each Dialogue paragraph is one balloon.
    dialogue: rule('dialogue', 'Balloon (Dialogue)', true, {
      leftIndent: 2.50,
      rightIndent: 6.00,
      nextOnEnter: 'character',
      nextOnTab: COMIC_PANEL,
      placeholder: 'Balloon text...',
      numbering: { enabled: true, resetOn: [COMIC_PAGE] },
    }),
    parenthetical: rule('parenthetical', 'Parenthetical', true, {
      italic: true,
      leftIndent: 3.00,
      rightIndent: 5.50,
      nextOnEnter: 'dialogue',
      placeholder: '(tailless / burst / small)',
    }),
    transition: disabled('transition', 'Transition'),
    general: rule('general', 'General (Unformatted text)', true, { nextOnEnter: 'general' }),
    shot: disabled('shot', 'Shot'),
    newAct: rule('newAct', 'Chapter', true, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: COMIC_PAGE,
      placeholder: 'CHAPTER ONE',
    }),
    endOfAct: rule('endOfAct', 'End of Chapter', true, {
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 24,
      nextOnEnter: 'newAct',
      placeholder: 'END OF CHAPTER ONE',
    }),
    lyrics: disabled('lyrics', 'Lyrics'),
    showEpisode: rule('showEpisode', 'Issue Title', true, {
      bold: true,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 12,
      nextOnEnter: COMIC_PAGE,
      placeholder: 'ISSUE #1: TITLE',
    }),
    ...outlineRules(),
    // Off by default, present so a user template built on this one can switch
    // it on. See avBlockRule() in _helpers.ts.
    ...avBlockRule(false),
    castList: disabled('castList', 'Cast List'),
    // Custom: the page heading. Its number is its text — PAGE ONE — so the
    // placeholder only shows while element numbers are hidden.
    [COMIC_PAGE]: rule(COMIC_PAGE, 'Page', false, {
      bold: true,
      underline: true,
      textTransform: 'uppercase',
      marginTop: 24,
      nextOnEnter: COMIC_PANEL,
      nextOnTab: 'action',
      placeholder: 'PAGE',
      numbering: { enabled: true, resetOn: [], prefix: 'PAGE ', style: 'words', placement: 'inline' },
    }),
    // Custom: the panel heading, PANEL 1, 2, 3… on each page.
    [COMIC_PANEL]: rule(COMIC_PANEL, 'Panel', false, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 18,
      nextOnEnter: 'action',
      nextOnTab: 'character',
      placeholder: 'PANEL',
      numbering: { enabled: true, resetOn: [COMIC_PAGE], prefix: 'PANEL ', placement: 'inline' },
    }),
    // Custom: narration box. Lettered in the same run as the balloons.
    [COMIC_CAPTION]: rule(COMIC_CAPTION, 'Caption', false, {
      marginTop: 12,
      nextOnEnter: 'character',
      nextOnTab: COMIC_SFX,
      placeholder: 'CAPTION: ...',
      numbering: { enabled: true, resetOn: [COMIC_PAGE], countWith: 'dialogue' },
    }),
    // Custom: a lettered sound effect. The same id as Radio Play's, so it
    // travels to Final Draft as a Sound Effect.
    [COMIC_SFX]: rule(COMIC_SFX, 'SFX', false, {
      bold: true,
      textTransform: 'uppercase',
      marginTop: 12,
      nextOnEnter: COMIC_PANEL,
      nextOnTab: 'character',
      placeholder: 'SFX: ...',
    }),
    // Custom: an aside to the artist. Printed — the artist is who reads the
    // script — unlike the outline Note, which never leaves the app.
    [COMIC_ARTIST_NOTE]: rule(COMIC_ARTIST_NOTE, 'Note to Artist', false, {
      italic: true,
      marginTop: 12,
      nextOnEnter: 'action',
      nextOnTab: COMIC_PANEL,
      placeholder: 'NOTE: ...',
    }),
  },
};

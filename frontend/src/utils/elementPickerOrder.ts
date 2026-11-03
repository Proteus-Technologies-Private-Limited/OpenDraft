/**
 * Which elements the Enter element menu offers, and in what order.
 *
 * The elements come from the same place, through the same filter, as the
 * toolbar's element list (`scriptBodyElementRules`), so the two can never
 * disagree about what exists — a template's own elements such as Sound Effect
 * included (discussion #183). The fixed orders below only rank them: the
 * likeliest next element first, the template's own elements after the script
 * elements, the non-printing ones last. On a line that is already a custom
 * element, that element leads, as each built-in one does for itself.
 */
import type { ElementType } from '../stores/editorStore';
import { AV_BLOCK_RULE_ID, isTitlePageRuleId } from '../stores/formattingTypes';
import type { FormattingTemplate } from '../stores/formattingTypes';
import { scriptBodyElementRules } from './avCellElements';

// Context-aware element ordering: most likely choices first per current type
// The two non-printing elements sit at the end of every list: they are
// structure, not script, so they should never be the first thing offered.
// AV Columns joins them there: it inserts a two-column body rather than
// restyling the line, so it is never the answer to "what comes next?" either.
const OUTLINE_TYPES: ElementType[] = ['section', 'note'];
const TAIL_TYPES: ElementType[] = [...OUTLINE_TYPES, AV_BLOCK_RULE_ID];

const ELEMENT_ORDER: Record<string, ElementType[]> = {
  sceneHeading: ['action', 'character', 'general', 'transition', 'shot', 'sceneHeading', 'dialogue', 'parenthetical', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  action:       ['action', 'character', 'dialogue', 'general', 'sceneHeading', 'transition', 'shot', 'parenthetical', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  character:    ['dialogue', 'parenthetical', 'action', 'character', 'general', 'sceneHeading', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  dialogue:     ['action', 'character', 'general', 'dialogue', 'parenthetical', 'sceneHeading', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  parenthetical:['dialogue', 'action', 'character', 'general', 'parenthetical', 'sceneHeading', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  transition:   ['sceneHeading', 'action', 'transition', 'general', 'character', 'dialogue', 'parenthetical', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  general:      ['general', 'action', 'character', 'dialogue', 'sceneHeading', 'transition', 'parenthetical', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  shot:         ['action', 'shot', 'character', 'general', 'sceneHeading', 'transition', 'dialogue', 'parenthetical', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  newAct:       ['sceneHeading', 'action', 'newAct', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  endOfAct:     ['newAct', 'sceneHeading', 'action', 'endOfAct', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'lyrics', 'showEpisode', 'castList'],
  lyrics:       ['lyrics', 'dialogue', 'action', 'character', 'general', 'sceneHeading', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'showEpisode', 'castList'],
  showEpisode:  ['action', 'sceneHeading', 'showEpisode', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'castList'],
  castList:     ['castList', 'action', 'character', 'general', 'sceneHeading', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode'],
  section:      ['action', 'sceneHeading', 'section', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
  note:         ['action', 'note', 'sceneHeading', 'general', 'character', 'dialogue', 'parenthetical', 'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList'],
};
for (const [type, order] of Object.entries(ELEMENT_ORDER)) {
  ELEMENT_ORDER[type] = [...order, ...TAIL_TYPES.filter((t) => !order.includes(t))];
}

const DEFAULT_ORDER: ElementType[] = [
  'action', 'character', 'dialogue', 'general', 'sceneHeading', 'parenthetical',
  'transition', 'shot', 'newAct', 'endOfAct', 'lyrics', 'showEpisode', 'castList',
  ...TAIL_TYPES,
];

export function pickerElementTypes(
  template: FormattingTemplate | null | undefined,
  defaultType: ElementType,
): ElementType[] {
  const ids = scriptBodyElementRules(template, isTitlePageRuleId).map((r) => r.id as ElementType);
  const order = ELEMENT_ORDER[defaultType] || DEFAULT_ORDER;
  // Elements no fixed order names (the template's own) sit just before the
  // non-printing tail, which every order ends with.
  const customRank = order.indexOf(TAIL_TYPES[0]) - 0.5;
  const rank = (id: ElementType): number => {
    if (id === defaultType && !order.includes(id)) return -1;
    const i = order.indexOf(id);
    return i < 0 ? customRank : i;
  };
  // Array.prototype.sort is stable, so equal ranks keep template order.
  return [...ids].sort((x, y) => rank(x) - rank(y));
}

/**
 * Enter on a heading whose number is its whole text.
 *
 * Enter on an empty line opens the element menu (components/ScreenplayEditor),
 * which is right for a line that looks empty. A comic script's Panel does not:
 * with nothing typed it still reads "PANEL 3" (utils/elementNumbers, inline
 * placement), and the writer pressing Enter on it means "on to the panel's
 * description", exactly as on any heading with text. So such a line moves on
 * to its `nextOnEnter` element, and the heading stays as it is.
 *
 * Only while element numbers are shown: with them hidden the line really is
 * blank on screen, and the menu is what a blank line offers.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { FormattingElementRule } from '../stores/formattingTypes';
import { AV_BLOCK_RULE_ID } from '../stores/formattingTypes';
import { isInlineNumbering, numberingRulesOf } from '../utils/elementNumbers';
import { elementIdOf } from '../utils/pageBreaks';

/**
 * Handle Enter on an empty, inline-numbered heading: add the element that
 * follows it below and put the cursor there. False — nothing dispatched — for
 * every other line, so the caller's own Enter handling runs.
 */
export function enterFromNumberedHeading(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  rules: Record<string, FormattingElementRule>,
  numbersVisible: boolean,
): boolean {
  if (!numbersVisible) return false;
  const { $from, empty } = state.selection;
  if (!empty) return false;
  const node = $from.parent;
  if (!node.isTextblock || node.textContent.trim() !== '') return false;

  const id = elementIdOf({ type: node.type.name, attrs: node.attrs });
  if (!isInlineNumbering(numberingRulesOf(rules)[id])) return false;

  const nextId = rules[id].nextOnEnter;
  const nextRule = rules[nextId];
  if (!nextId || nextId === AV_BLOCK_RULE_ID) return false;

  const { schema } = state;
  let next: PmNode | null | undefined;
  if (schema.nodes[nextId] && nextId !== 'customElement') {
    next = schema.nodes[nextId].createAndFill();
  } else if (nextRule) {
    next = schema.nodes.customElement?.createAndFill({ customTypeId: nextId, customLabel: nextRule.label });
  }
  if (!next || !next.isTextblock) return false;

  try {
    const after = $from.after($from.depth);
    const tr = state.tr.insert(after, next);
    tr.setSelection(TextSelection.create(tr.doc, after + 1));
    dispatch?.(tr.scrollIntoView());
    return true;
  } catch (err) {
    // A container that does not take the next element here (a dual-dialogue
    // column, say): leave Enter to the caller rather than lose the keystroke.
    console.warn('[numberedHeadingEnter] could not add the next element', err);
    return false;
  }
}

/**
 * The element types an AV cell offers, resolved against the active template.
 *
 * Two authorities, and it matters which answers what:
 *
 *   - The SCHEMA says what an `avCell` will hold: the four AV paragraph types
 *     plus the screenplay elements in `AV_SCREENPLAY_CELL_ELEMENT_IDS`. It is
 *     deliberately permissive, because a template can be switched on a document
 *     that already exists and changing template must restyle a document, never
 *     make it unparseable.
 *   - The TEMPLATE says which of those the writer is actually offered, and in
 *     which column, through `FormattingElementRule.avCell`. That is the knob:
 *     a template that wants Character and Dialogue in the audio column says so,
 *     and one that wants a bare two-column body says nothing and gets the four
 *     AV types.
 *
 * The four AV paragraph types are always offered, whatever the template says —
 * including a type the template explicitly disables. They are what an AV body
 * is made of, and a list that omitted one would leave a paragraph the writer
 * could neither convert nor convert back. The same reasoning covers
 * `currentId`: whatever the caret is sitting on is always in the list, however
 * it got there.
 *
 * Deriving the list from the schema rather than filtering the template's rules
 * is also what keeps two cases editable at all — both of them real:
 *
 *   - An AV body inside a screenplay. `Insert AV Columns` puts one in any
 *     script, and Film Screenplay has no `avPara` rule to find.
 *   - An AV script whose template did not come back with it — a restored
 *     session, an imported document, a `.odraft` opened from a backup. The
 *     document still holds real AV nodes; only the formatting preference is
 *     missing, and that is not a reason to make the document uneditable.
 */
import type { FormattingTemplate, FormattingElementRule, AvCellPlacement } from '../stores/formattingTypes';
import { AV_SCRIPT_TEMPLATE } from '../stores/templates/avScriptTemplate';
import {
  AV_BASE_CELL_ELEMENT_IDS,
  AV_SCREENPLAY_CELL_ELEMENT_IDS,
} from '../editor/extensions/AvBlock';

/** Which cell a rule is offered in. Absent — every rule written before the
 *  field existed — reads as 'none', so nothing changes for a template that
 *  has not opted in. */
export function avPlacementOf(rule: FormattingElementRule | null | undefined): AvCellPlacement {
  const placement = rule?.avCell;
  return placement === 'video' || placement === 'audio' || placement === 'both' ? placement : 'none';
}

/** True when `rule` is offered in the given cell. */
export function allowedInAvCell(
  rule: FormattingElementRule | null | undefined,
  side: 'video' | 'audio',
): boolean {
  const placement = avPlacementOf(rule);
  return placement === 'both' || placement === side;
}

/** A rule for one of the four AV paragraph types, preferring the template's own
 *  wording so a writer who renamed "Video Shot" still sees their own label. */
function avBaseRule(template: FormattingTemplate | null | undefined, id: string): FormattingElementRule | null {
  return template?.rules?.[id] || AV_SCRIPT_TEMPLATE.rules[id] || null;
}

/**
 * The elements offered inside an AV cell, in menu order.
 *
 * `side` is the column the caret is in; `currentId` is the element it is
 * sitting on, which is always included so it can be converted back.
 */
export function avCellElementRules(
  template: FormattingTemplate | null | undefined,
  side: 'video' | 'audio' = 'video',
  currentId?: string | null,
): FormattingElementRule[] {
  const out: FormattingElementRule[] = [];
  const seen = new Set<string>();

  const push = (rule: FormattingElementRule | null | undefined) => {
    if (!rule || seen.has(rule.id)) return;
    seen.add(rule.id);
    out.push(rule);
  };

  // 1. The AV format's own four, always.
  for (const id of AV_BASE_CELL_ELEMENT_IDS) push(avBaseRule(template, id));

  // 2. Whatever the template lets into this column, in the template's own
  //    order — that order is the one the Template Editor shows, so the menu
  //    and the editor agree on how the format is laid out.
  const screenplayIds = new Set<string>(AV_SCREENPLAY_CELL_ELEMENT_IDS);
  for (const rule of Object.values(template?.rules || {})) {
    if (!rule.enabled || !allowedInAvCell(rule, side)) continue;
    // A built-in id has to be one the cell's content expression accepts; a
    // template's own custom id rides in on `customElement`, which it does.
    if (rule.isBuiltIn && !screenplayIds.has(rule.id) && !AV_BASE_CELL_ELEMENT_IDS.includes(rule.id as never)) continue;
    push(rule);
  }

  // 3. Whatever the caret is on, however it got there.
  if (currentId && !seen.has(currentId)) {
    push(template?.rules?.[currentId] || AV_SCRIPT_TEMPLATE.rules[currentId] || null);
  }

  return out;
}

/**
 * The elements offered OUTSIDE an AV cell — the ordinary script body.
 *
 * The four AV paragraph types are dropped. They exist only inside a cell, and
 * `setNode('avShot')` on a line of Action asks the schema for a node the
 * document cannot hold there. The AV template marks them enabled (it has to —
 * that is how their formatting is edited), so a list that filtered on `enabled`
 * alone offered them everywhere.
 *
 * `avBlock` stays in: it is a real thing to insert here, and every caller
 * routes it to `insertAvRow` rather than `setNode` — see `AV_BLOCK_RULE_ID`.
 *
 * Shared by the toolbar's dropdown and Format ▸ Element so the two cannot
 * drift, which they had already begun to: the toolbar filtered the AV types out
 * and the menu did not.
 */
export function scriptBodyElementRules(
  template: FormattingTemplate | null | undefined,
  isTitlePageId: (id: string) => boolean,
): FormattingElementRule[] {
  const cellOnly = new Set<string>(AV_BASE_CELL_ELEMENT_IDS);
  return Object.values(template?.rules || {}).filter(
    (r) => r.enabled && !isTitlePageId(r.id) && !cellOnly.has(r.id),
  );
}

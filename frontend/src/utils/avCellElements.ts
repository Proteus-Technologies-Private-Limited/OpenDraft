/**
 * The element types an AV cell can actually hold.
 *
 * `avCell`'s content expression is `(avPara | avShot | avDirection | avGraphic)+`
 * in the schema, for every document, whatever template is active. A template
 * decides how those four look, not whether they exist — so the element list
 * offered inside an AV cell has to come from the schema and borrow the
 * template's labels, rather than being filtered out of the template's rules.
 *
 * Filtering the template's rules is what the toolbar used to do, and it has two
 * ways of leaving the writer with an empty dropdown and a body they cannot type
 * an element into:
 *
 *   - An AV body inside a screenplay. `Insert AV Columns` puts one in any
 *     script, and Industry Standard has no avPara rule to find.
 *   - An AV script whose template did not come back with it — a restored
 *     session, an imported document, a `.odraft` opened from a backup. The
 *     document still holds real AV nodes; only the formatting preference is
 *     missing, and that is not a reason to make the document uneditable.
 */
import type { FormattingTemplate, FormattingElementRule } from '../stores/formattingTypes';
import { AV_SCRIPT_TEMPLATE } from '../stores/templates/avScriptTemplate';
import { AV_CELL_ELEMENT_IDS } from '../editor/extensions/AvBlock';

/**
 * The four AV cell types, in menu order, resolved against `template`.
 *
 * A rule the template defines wins, so a writer who has restyled "Video Shot"
 * in their own AV template still sees their own label. Anything it does not
 * define falls back to the built-in AV template, which is where these types are
 * described in the first place.
 *
 * A type the template explicitly disables is still offered: the schema will
 * accept it regardless, and a list that omits it would leave a paragraph the
 * writer cannot convert or convert back.
 */
export function avCellElementRules(template: FormattingTemplate | null | undefined): FormattingElementRule[] {
  const out: FormattingElementRule[] = [];
  for (const id of AV_CELL_ELEMENT_IDS) {
    const rule = template?.rules?.[id] || AV_SCRIPT_TEMPLATE.rules[id];
    if (rule) out.push(rule);
  }
  return out;
}

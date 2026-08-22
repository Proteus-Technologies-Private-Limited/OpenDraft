/**
 * Shared helpers for system script-type templates.
 */

import type { FormattingElementRule } from '../formattingTypes';
import { TITLE_PAGE_ELEMENTS, titlePageRuleId } from '../formattingTypes';

/** Build a rule from defaults + overrides — same shape as industryStandardTemplate.ts. */
export function rule(
  id: string,
  label: string,
  isBuiltIn: boolean,
  overrides: Partial<FormattingElementRule>,
): FormattingElementRule {
  return {
    id,
    label,
    isBuiltIn,
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
    ...overrides,
  };
}

/** Mark a rule as disabled — used to remove an element from a script type. */
export function disabled(id: string, label: string): FormattingElementRule {
  return { ...rule(id, label, true, {}), enabled: false };
}

/**
 * The default title-page rules, matching what screenplay.css has always drawn:
 * a bold uppercase centred title, a centred credit, the draft flush left, and
 * the contact and copyright blocks flush right.
 *
 * Indents span the full text column rather than the body's 1.5"–7.5", because
 * a title page is not laid out on the dialogue grid — a centred title needs the
 * whole width to centre within, and a right-aligned contact block needs to
 * reach the right margin.
 */
export function titlePageRules(): Record<string, FormattingElementRule> {
  const defaults: Record<string, Partial<FormattingElementRule>> = {
    title: { bold: true, textTransform: 'uppercase', textAlign: 'center' },
    author: { textAlign: 'center' },
    draft: { textAlign: 'left' },
    contact: { textAlign: 'right' },
    copyright: { textAlign: 'right' },
    date: { textAlign: 'center' },
  };
  const out: Record<string, FormattingElementRule> = {};
  for (const { field, label } of TITLE_PAGE_ELEMENTS) {
    const id = titlePageRuleId(field);
    out[id] = rule(id, label, true, {
      leftIndent: 1.0,
      rightIndent: 7.5,
      // Enter inside the title page keeps you in the same field; there is no
      // flow between them the way Character flows into Dialogue.
      nextOnEnter: id,
      ...defaults[field],
    });
  }
  return out;
}

/**
 * The Enter element menu offers exactly what the toolbar's element list
 * offers (discussion #183: a template's Sound Effect was in the toolbar but
 * missing from the menu).
 */
import { describe, it, expect } from 'vitest';
import { pickerElementTypes } from './elementPickerOrder';
import { scriptBodyElementRules } from './avCellElements';
import { createDefaultRule, isTitlePageRuleId } from '../stores/formattingTypes';
import type { FormattingTemplate } from '../stores/formattingTypes';
import { SYSTEM_TEMPLATE_LIST } from '../stores/formattingTemplateStore';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import type { ElementType } from '../stores/editorStore';

function withCustom(base: FormattingTemplate, id: string, label: string): FormattingTemplate {
  return { ...base, rules: { ...base.rules, [id]: createDefaultRule(id, label, false) } };
}

const toolbarIds = (t: FormattingTemplate) =>
  scriptBodyElementRules(t, isTitlePageRuleId).map((r) => r.id).sort();

describe('pickerElementTypes', () => {
  it('offers the same elements as the toolbar list, for every built-in format', () => {
    for (const t of SYSTEM_TEMPLATE_LIST) {
      for (const at of ['action', 'character', 'sceneHeading'] as ElementType[]) {
        expect([...pickerElementTypes(t, at)].sort(), `${t.name} after ${at}`).toEqual(toolbarIds(t));
      }
    }
  });

  it('includes a custom element, after the script elements and before the non-printing ones', () => {
    const t = withCustom(INDUSTRY_STANDARD_TEMPLATE, 'sfx-1', 'Sound Effect');
    const list = pickerElementTypes(t, 'action');
    expect([...list].sort()).toEqual(toolbarIds(t));
    const at = list.indexOf('sfx-1' as ElementType);
    expect(at).toBeGreaterThan(list.indexOf('character'));
    expect(at).toBeLessThan(list.indexOf('section'));
    expect(list[0]).toBe('action'); // the usual context order is kept
  });

  it('puts the custom element first on a line that already is one', () => {
    const t = withCustom(INDUSTRY_STANDARD_TEMPLATE, 'sfx-1', 'Sound Effect');
    expect(pickerElementTypes(t, 'sfx-1' as ElementType)[0]).toBe('sfx-1');
  });

  it('leaves out a disabled custom element, as the toolbar does', () => {
    const t = withCustom(INDUSTRY_STANDARD_TEMPLATE, 'sfx-1', 'Sound Effect');
    t.rules['sfx-1'] = { ...t.rules['sfx-1'], enabled: false };
    expect(pickerElementTypes(t, 'action')).not.toContain('sfx-1');
  });
});

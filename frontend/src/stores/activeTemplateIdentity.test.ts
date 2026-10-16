/**
 * `getActiveTemplate()` answers with the same object until the template changes.
 *
 * Toolbar, MenuBar, FormatPanel, ElementPicker and ScriptContextMenu subscribe
 * with `useFormattingTemplateStore((s) => s.getActiveTemplate())`, and React
 * re-renders whenever that is a different object. A duplicate of any system
 * format but Industry Standard is stored without the title-page rules, was
 * filled in afresh on every read, and applying it left a blank window
 * (React error #185, maximum update depth exceeded).
 */
import { describe, it, expect } from 'vitest';
import { useFormattingTemplateStore, SYSTEM_TEMPLATE_LIST } from './formattingTemplateStore';
import type { FormattingTemplate } from './formattingTypes';

const copyOf = (source: FormattingTemplate): FormattingTemplate => ({
  ...source,
  id: `copy-of-${source.id}`,
  name: `${source.name} (Copy)`,
  category: 'user',
  rules: JSON.parse(JSON.stringify(source.rules)),
});

describe('getActiveTemplate identity', () => {
  for (const source of SYSTEM_TEMPLATE_LIST) {
    it(`is stable for ${source.name} (Copy)`, () => {
      const copy = copyOf(source);
      useFormattingTemplateStore.setState({ templates: [copy], activeTemplateId: copy.id });
      const get = () => useFormattingTemplateStore.getState().getActiveTemplate();
      expect(get()).toBe(get());
      // Still filled in: the title page's rules are there to read.
      expect(Object.keys(get().rules).some((id) => id.startsWith('titlePage:'))).toBe(true);
    });
  }

  it('answers anew once the template is edited', () => {
    const copy = copyOf(SYSTEM_TEMPLATE_LIST[1]);
    useFormattingTemplateStore.setState({ templates: [copy], activeTemplateId: copy.id });
    const before = useFormattingTemplateStore.getState().getActiveTemplate();
    useFormattingTemplateStore.setState({ templates: [{ ...copy, name: 'Renamed' }] });
    const after = useFormattingTemplateStore.getState().getActiveTemplate();
    expect(after).not.toBe(before);
    expect(after.name).toBe('Renamed');
  });
});

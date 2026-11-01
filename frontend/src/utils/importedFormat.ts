import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import type {
  FormattingElementRule,
  FormattingTemplate,
} from '../stores/formattingTypes';
export function importedFormat(
  rules: Record<string, Partial<FormattingElementRule>>,
): FormattingTemplate {
  const id = `osf-import:${crypto.randomUUID()}`;
  const merged = structuredClone(INDUSTRY_STANDARD_TEMPLATE.rules);
  for (const [type, patch] of Object.entries(rules))
    if (merged[type]) merged[type] = { ...merged[type], ...patch };
  return {
    ...INDUSTRY_STANDARD_TEMPLATE,
    id,
    name: 'Imported Fade In formatting',
    category: 'user',
    rules: merged,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
export function restoreImportedFormat(value: unknown): void {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return;
    }
  }
  if (!value || typeof value !== 'object') return;
  const template = value as FormattingTemplate;
  if (
    typeof template.id !== 'string' ||
    !template.id.startsWith('osf-import:') ||
    !template.rules ||
    typeof template.rules !== 'object'
  )
    return;
  const fallback = structuredClone(INDUSTRY_STANDARD_TEMPLATE.rules);
  for (const [id, rule] of Object.entries(template.rules))
    if (fallback[id] && rule && typeof rule === 'object')
      fallback[id] = { ...fallback[id], ...rule };
  const restored = {
    ...INDUSTRY_STANDARD_TEMPLATE,
    ...template,
    rules: fallback,
  };
  const store = useFormattingTemplateStore.getState();
  useFormattingTemplateStore.setState({
    templates: [
      ...store.templates.filter((t) => t.id !== restored.id),
      restored,
    ],
  });
}

import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import type {
  FormattingElementRule,
  FormattingTemplate,
} from '../stores/formattingTypes';
import type { ImportedLineSpacing } from './lineSpacing';
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
  useFormattingTemplateStore.getState().restoreDocumentTemplate(template.id, template);
}

/**
 * The format an .fdx with line spacing opens in: Industry Standard, opened up
 * as the file's element settings say (utils/lineSpacing). Only built when the
 * file is not single-spaced, so an ordinary import is untouched.
 */
export function importedLineSpacingFormat(spacing: ImportedLineSpacing): FormattingTemplate {
  const ts = new Date().toISOString();
  return {
    ...structuredClone(INDUSTRY_STANDARD_TEMPLATE),
    id: `fdx-import:${crypto.randomUUID()}`,
    name: 'Imported Final Draft formatting', // i18n-ignore: stored as the format's name
    category: 'user',
    lineSpacing: spacing.lineSpacing,
    ...(Object.keys(spacing.lineHeightMultiplier).length > 0
      ? { lineHeightMultiplier: { ...spacing.lineHeightMultiplier } }
      : {}),
    createdAt: ts,
    updatedAt: ts,
  };
}

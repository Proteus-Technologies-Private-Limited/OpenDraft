/** Portable document formats. Reading a snapshot never changes the template library. */
import {
  createDefaultRule,
  type FormattingElementRule,
  type FormattingTemplate,
} from '../stores/formattingTypes';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const elementId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_:-]+$/.test(value) &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Accept older snapshots with missing optional fields; reject malformed known fields. */
export function parseTemplateSnapshot(
  value: unknown,
  expectedId: string,
): FormattingTemplate | null {
  try {
    if (typeof value === 'string') value = JSON.parse(value);
    if (
      !record(value) ||
      value.id !== expectedId ||
      !expectedId ||
      ['__proto__', 'prototype', 'constructor'].includes(expectedId)
    )
      return null;
    for (const key of [
      'description',
      'scriptTypeGroup',
      'scriptTypeTagline',
      'createdAt',
      'updatedAt',
    ])
      if (key in value && typeof value[key] !== 'string') return null;
    if (
      typeof value.name !== 'string' ||
      !record(value.rules) ||
      !['enforce', 'override'].includes(String(value.mode))
    )
      return null;
    const rules: Record<string, FormattingElementRule> = {};
    for (const [id, raw] of Object.entries(value.rules)) {
      if (
        !elementId(id) ||
        !record(raw) ||
        raw.id !== id ||
        typeof raw.label !== 'string' ||
        typeof raw.isBuiltIn !== 'boolean'
      )
        return null;
      for (const key of [
        'enabled',
        'bold',
        'italic',
        'underline',
        'strikethrough',
        'allowFormatOverride',
      ]) {
        if (key in raw && typeof raw[key] !== 'boolean') return null;
      }
      for (const key of ['marginTop', 'leftIndent', 'rightIndent'])
        if (key in raw && !finite(raw[key])) return null;
      if (raw.fontSize != null && (!finite(raw.fontSize) || raw.fontSize <= 0))
        return null;
      for (const key of ['fontFamily', 'textColor', 'backgroundColor']) {
        if (
          raw[key] != null &&
          (typeof raw[key] !== 'string' ||
            /[;{}<>\r\n]/.test(raw[key] as string))
        )
          return null;
      }
      if (
        'textTransform' in raw &&
        !['none', 'uppercase', 'lowercase'].includes(String(raw.textTransform))
      )
        return null;
      if (
        'textAlign' in raw &&
        !['left', 'center', 'right', 'justify'].includes(String(raw.textAlign))
      )
        return null;
      if (
        'avCell' in raw &&
        !['none', 'both', 'audio', 'video'].includes(String(raw.avCell))
      )
        return null;
      if ('nextOnEnter' in raw && !elementId(raw.nextOnEnter)) return null;
      if (raw.nextOnTab != null && !elementId(raw.nextOnTab)) return null;
      if ('placeholder' in raw && typeof raw.placeholder !== 'string')
        return null;
      if (raw.numbering != null) {
        const n = raw.numbering;
        if (
          !record(n) ||
          typeof n.enabled !== 'boolean' ||
          !Array.isArray(n.resetOn) ||
          !n.resetOn.every(elementId)
        )
          return null;
        if (
          n.startAt !== undefined &&
          (!finite(n.startAt) || !Number.isInteger(n.startAt) || n.startAt < 1)
        )
          return null;
        if (n.prefix !== undefined && typeof n.prefix !== 'string') return null;
        if (
          n.style !== undefined &&
          !['plain', 'scene', 'words'].includes(String(n.style))
        )
          return null;
        if (
          n.placement !== undefined &&
          !['margin', 'inline'].includes(String(n.placement))
        )
          return null;
        if (n.countWith !== undefined && !elementId(n.countWith)) return null;
      }
      rules[id] = {
        ...createDefaultRule(id, raw.label, raw.isBuiltIn),
        ...raw,
      } as FormattingElementRule;
    }
    if (!Object.keys(rules).length) return null;
    if (
      value.forceBreakBefore !== undefined &&
      (!Array.isArray(value.forceBreakBefore) ||
        !value.forceBreakBefore.every(elementId))
    )
      return null;
    if (value.titlePageFields !== undefined && !strings(value.titlePageFields))
      return null;
    if (
      value.starterDocument !== undefined &&
      !Array.isArray(value.starterDocument)
    )
      return null;
    if (value.pageLayout !== undefined && !record(value.pageLayout))
      return null;
    if (
      value.lineHeightMultiplier !== undefined &&
      (!record(value.lineHeightMultiplier) ||
        !Object.values(value.lineHeightMultiplier).every(
          (v) => finite(v) && v > 0,
        ))
    )
      return null;
    if (
      value.pageTimeSeconds !== undefined &&
      (!finite(value.pageTimeSeconds) || value.pageTimeSeconds <= 0)
    )
      return null;
    // Clone at the document boundary: edits or a subsequent save must not mutate
    // the caller's payload, another script's snapshot or a library template.
    return JSON.parse(
      JSON.stringify({
        ...value,
        rules,
        description:
          typeof value.description === 'string' ? value.description : '',
        category: 'user',
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
      }),
    ) as FormattingTemplate;
  } catch {
    return null;
  }
}

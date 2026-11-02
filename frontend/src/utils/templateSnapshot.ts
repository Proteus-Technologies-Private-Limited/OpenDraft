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

/** Validate partial geometry/settings without importing editor stores at runtime. */
export function validTemplatePageLayout(value: unknown): boolean {
  if (!record(value)) return false;
  const numeric = ['pageWidth', 'pageHeight', 'topMargin', 'bottomMargin', 'headerMargin', 'footerMargin', 'leftMargin', 'rightMargin', 'headerStartPage', 'footerStartPage', 'startingPageNumber'];
  const known = new Set([...numeric, 'headerContent', 'footerContent', 'moresContds', 'footnotes', 'osfSource']);
  for (const [key, field] of Object.entries(value)) {
    if (!known.has(key)) return false;
    if (numeric.includes(key) && (!finite(field) || field < 0)) return false;
    if (['pageWidth', 'pageHeight', 'headerStartPage', 'footerStartPage', 'startingPageNumber'].includes(key) && (!finite(field) || field <= 0)) return false;
    if (key.endsWith('StartPage') || key === 'startingPageNumber') if (!Number.isInteger(field)) return false;
    if (key === 'headerContent' || key === 'footerContent') {
      if (!record(field) || Object.entries(field).some(([k, v]) => !['left', 'center', 'right'].includes(k) || typeof v !== 'string')) return false;
    }
    if (key === 'moresContds') {
      if (!record(field) || Object.entries(field).some(([k, v]) =>
        ['characterContd', 'dialogueBreakContd'].includes(k) ? typeof v !== 'boolean'
          : ['contdText', 'moreText'].includes(k) ? typeof v !== 'string' : true)) return false;
    }
    if (key === 'footnotes') {
      if (!record(field)) return false;
      for (const [k, v] of Object.entries(field)) {
        if (['enabled', 'includeInExports'].includes(k)) { if (typeof v !== 'boolean') return false; }
        else if (k === 'startAt') { if (!finite(v) || !Number.isInteger(v) || v < 1) return false; }
        else {
          const choices: Record<string, readonly string[]> = {
            placement: ['footnote', 'endnote'], numberFormat: ['arabic', 'lowerAlpha', 'upperAlpha', 'lowerRoman', 'upperRoman', 'symbol'],
            markerStyle: ['superscript', 'bracketed'], numbering: ['continuous', 'restartEachPage'],
          };
          if (typeof v !== 'string' || !Object.hasOwn(choices, k) || !choices[k].includes(v)) return false;
        }
      }
    }
    if (key === 'osfSource') {
      const stringMap = (v: unknown) => record(v) && Object.values(v).every(x => typeof x === 'string');
      if (!record(field) || Object.keys(field).some(k => !['settings', 'styles'].includes(k))
        || !stringMap(field.settings) || !record(field.styles) || !Object.values(field.styles).every(stringMap)) return false;
    }
  }
  return (value.pageWidth as number ?? 8.5) > (value.leftMargin as number ?? 1.5) + (value.rightMargin as number ?? 1)
    && (value.pageHeight as number ?? 11) * 72 > (value.topMargin as number ?? 72) + (value.bottomMargin as number ?? 72);
}

function jsonData(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonData);
  return record(value) && Object.entries(value).every(([k, v]) => !['__proto__', 'prototype', 'constructor'].includes(k) && jsonData(v));
}
function starterNode(value: unknown, types: Set<string>): boolean {
  if (!record(value) || !elementId(value.type) || !types.has(value.type)) return false;
  if (Object.keys(value).some(k => !['type', 'text', 'attrs', 'marks', 'content'].includes(k))) return false;
  if (value.type === 'text' && typeof value.text !== 'string') return false;
  if (value.text !== undefined && (value.type !== 'text' || typeof value.text !== 'string')) return false;
  if (value.attrs !== undefined && (!record(value.attrs) || !jsonData(value.attrs))) return false;
  if (value.content !== undefined && (!Array.isArray(value.content) || !value.content.every(node => starterNode(node, types)))) return false;
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every(mark =>
    record(mark) && elementId(mark.type) && Object.keys(mark).every(k => ['type', 'attrs'].includes(k))
      && (mark.attrs === undefined || record(mark.attrs) && jsonData(mark.attrs))))) return false;
  return true;
}

/** Compare definitions, ignoring object-key order and bookkeeping timestamps. */
export function sameTemplateDefinition(a: FormattingTemplate, b: FormattingTemplate): boolean {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : record(value) ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, ordered(v)])) : value;
  const definition = (template: FormattingTemplate) => ordered(Object.fromEntries(
    Object.entries(template).filter(([key]) => !['createdAt', 'updatedAt'].includes(key)),
  ));
  return JSON.stringify(definition(a)) === JSON.stringify(definition(b));
}

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
      const ruleKeys = new Set([...Object.keys(createDefaultRule(id, raw.label, raw.isBuiltIn)), 'avCell', 'numbering']);
      if (Object.keys(raw).some(key => !ruleKeys.has(key))) return null;
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
          Object.keys(n).some(key => !['enabled', 'resetOn', 'prefix', 'startAt', 'style', 'placement', 'countWith'].includes(key)) ||
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
    const starterTypes = new Set([
      ...Object.keys(rules), 'text', 'hardBreak', 'customElement', 'dualDialogue',
      'dualDialogueColumn', 'titlePage', 'screenplayImage', 'avBlock', 'avRow',
      'avCell', 'avPara', 'avShot', 'avDirection', 'avGraphic', 'avImage',
    ]);
    if (value.starterDocument !== undefined && (!Array.isArray(value.starterDocument)
      || !value.starterDocument.every(node => starterNode(node, starterTypes)
        && record(node) && !['text', 'hardBreak'].includes(String(node.type))))) return null;
    if (value.pageLayout !== undefined && !validTemplatePageLayout(value.pageLayout))
      return null;
    if (
      value.lineHeightMultiplier !== undefined &&
      (!record(value.lineHeightMultiplier) ||
        !Object.keys(value.lineHeightMultiplier).every(elementId) ||
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

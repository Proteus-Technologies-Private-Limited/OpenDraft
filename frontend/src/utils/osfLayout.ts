import { DEFAULT_PAGE_LAYOUT, type PageLayout } from '../stores/editorStore';
import type { FormattingElementRule } from '../stores/formattingTypes';
import { osfToInches, osfToPoints } from './layoutUnits';
export interface OsfSourceSettings {
  settings: Record<string, string>;
  styles: Record<string, Record<string, string>>;
}
export const OSF_BUILTIN_TYPES = [
  'general',
  'sceneHeading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
];
/** OSF 2.1 camelCase and 4.0 base-style aliases share one internal spelling. */
export function canonicalOsfStyle(
  source: Record<string, string>,
): Record<string, string> {
  const attrs = { ...source };
  const aliases: Record<string, string> = {
    builtInIndex: 'builtin_index',
    baseStyleName: 'basestylename',
    basestyle: 'basestylename',
    baseStyle: 'basestylename',
    leftIndent: 'leftindent',
    rightIndent: 'rightindent',
    spaceBefore: 'spacebefore',
    keepWithNext: 'keepwithnext',
    allCaps: 'allcaps',
    pageBreakBefore: 'pagebreakbefore',
    dualDialogue: 'dualdialogue',
  };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias in attrs && !(canonical in attrs))
      attrs[canonical] = attrs[alias];
    delete attrs[alias];
  }
  return attrs;
}
export function attributesOf(el: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(el.attributes).map((a) => [a.name, a.value]),
  );
}
export function parseOsfLayout(
  root: Element,
  warnings: string[],
): {
  pageLayout: Partial<PageLayout>;
  rules: Record<string, Partial<FormattingElementRule>>;
} {
  const element = root.getElementsByTagName('settings')[0];
  const settings = element ? attributesOf(element) : {};
  const pageLayout: Partial<PageLayout> = {};
  const supportedSettings = new Set([
    'page_width',
    'page_height',
    'margin_left',
    'margin_right',
    'margin_top',
    'margin_bottom',
    'normal_linesperinch',
    'element_spacing',
    'scene_numbering',
    'scenes_locked',
    'revision',
    'show_revisions',
  ]);
  const otherSettings = Object.keys(settings).filter(
    (key) => !supportedSettings.has(key),
  );
  if (otherSettings.length)
    warnings.push(
      `OSF settings retained for export but not applied by the editor: ${otherSettings.join(', ')}.`,
    );

  const fields = {
    page_width: 'pageWidth',
    page_height: 'pageHeight',
    margin_left: 'leftMargin',
    margin_right: 'rightMargin',
    margin_top: 'topMargin',
    margin_bottom: 'bottomMargin',
  } as const;
  for (const [attr, field] of Object.entries(fields)) {
    if (!(attr in settings)) continue;
    const n = Number(settings[attr]);
    if (
      !settings[attr].trim() ||
      !Number.isFinite(n) ||
      n < 0 ||
      ((field === 'pageWidth' || field === 'pageHeight') && n === 0)
    ) {
      warnings.push(`Invalid OSF setting ${attr}: ${settings[attr]}.`);
      continue;
    }
    pageLayout[field] =
      field === 'topMargin' || field === 'bottomMargin'
        ? osfToPoints(n)
        : osfToInches(n);
  }
  if (
    settings.normal_linesperinch &&
    Number(settings.normal_linesperinch) !== 6
  )
    warnings.push(
      'OSF line spacing is retained for export but OpenDraft renders six lines per inch.',
    );
  if (settings.element_spacing && Number(settings.element_spacing) !== 1)
    warnings.push(
      'OSF element-spacing multiplier is retained for export but is not rendered.',
    );
  // Margins that leave no room to write are a damaged setting, not a reason to
  // refuse the script: fall back to the default margins (and, if even those do
  // not fit, the default page) and say so.
  const printable = (l: PageLayout) =>
    l.leftMargin + l.rightMargin < l.pageWidth &&
    l.topMargin + l.bottomMargin < l.pageHeight * 72;
  let layout: PageLayout = { ...DEFAULT_PAGE_LAYOUT, ...pageLayout };
  if (!printable(layout)) {
    for (const key of ['leftMargin', 'rightMargin', 'topMargin', 'bottomMargin'] as const)
      delete pageLayout[key];
    layout = { ...DEFAULT_PAGE_LAYOUT, ...pageLayout };
    if (!printable(layout)) {
      delete pageLayout.pageWidth;
      delete pageLayout.pageHeight;
      layout = { ...DEFAULT_PAGE_LAYOUT };
    }
    warnings.push(
      "The file's margins leave no printable page area; OpenDraft's default page layout was used instead.",
    );
  }
  const styles: OsfSourceSettings['styles'] = {};
  for (const el of Array.from(
    root.getElementsByTagName('styles')[0]?.getElementsByTagName('style') ?? [],
  )) {
    const attrs = attributesOf(el);
    if (attrs.name) styles[attrs.name] = attrs;
  }
  const names = new Map(
    Object.keys(styles).map((name) => [name.toLowerCase(), name]),
  );
  const resolve = (
    name: string,
    seen = new Set<string>(),
  ): Record<string, string> => {
    if (seen.has(name)) {
      warnings.push(`Cyclic OSF base style: ${name}.`);
      return {};
    }
    seen.add(name);
    const own = canonicalOsfStyle(styles[name]);
    const base =
      own.basestylename ?? own.baseStyleName ?? own.basestyle ?? own.baseStyle;
    const parent = base ? names.get(base.toLowerCase()) : undefined;
    return { ...(parent ? resolve(parent, seen) : {}), ...own };
  };
  const rules: Record<string, Partial<FormattingElementRule>> = {};
  for (const name of Object.keys(styles)) {
    const own = styles[name];
    const type =
      OSF_BUILTIN_TYPES[Number(own.builtin_index ?? own.builtInIndex ?? -1)] ??
      (name.toLowerCase() === 'lyrics' ? 'lyrics' : undefined);
    if (!type) {
      warnings.push(
        `Custom OSF style "${name}" is retained for export, but its paragraph-specific formatting cannot be guaranteed.`,
      );
      continue;
    }
    const attrs = resolve(name);
    const supportedStyle = new Set([
      'name',
      'label',
      'builtin',
      'builtin_index',
      'builtInIndex',
      'basestylename',
      'baseStyleName',
      'basestyle',
      'baseStyle',
      'font',
      'size',
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'allcaps',
      'align',
      'spacebefore',
      'leftindent',
      'rightindent',
      'keepwithnext',
    ]);
    const otherProperties = Object.keys(canonicalOsfStyle(own)).filter(
      (key) => !supportedStyle.has(key),
    );
    if (otherProperties.length)
      warnings.push(
        `OSF ${name} properties retained for export but not applied by the editor: ${otherProperties.join(', ')}.`,
      );
    const rule: Partial<FormattingElementRule> = {};
    for (const key of ['bold', 'italic', 'underline', 'strikethrough'] as const)
      if (key in attrs) rule[key] = attrs[key] === '1' || attrs[key] === 'true';
    if ('allcaps' in attrs)
      rule.textTransform = /^(1|true)$/.test(attrs.allcaps)
        ? 'uppercase'
        : 'none';
    if (['left', 'center', 'right', 'justify'].includes(attrs.align))
      rule.textAlign = attrs.align as FormattingElementRule['textAlign'];
    if (attrs.font) rule.fontFamily = attrs.font;
    for (const [attribute, key] of [
      ['size', 'fontSize'],
      ['spacebefore', 'marginTop'],
      ['leftindent', 'leftIndent'],
      ['rightindent', 'rightIndent'],
    ] as const) {
      if (!(attribute in attrs)) continue;
      const n = Number(attrs[attribute]);
      if (
        !attrs[attribute].trim() ||
        !Number.isFinite(n) ||
        (n < 0 && attribute !== 'leftindent' && attribute !== 'rightindent') ||
        (attribute === 'size' && n === 0)
      ) {
        warnings.push(`Invalid OSF ${name} ${attribute}.`);
        continue;
      }
      rule[key] =
        attribute === 'spacebefore'
          ? n * 12
          : attribute === 'leftindent'
            ? layout.leftMargin + osfToInches(n)
            : attribute === 'rightindent'
              ? layout.pageWidth - layout.rightMargin - osfToInches(n)
              : n;
    }
    const keepsNext = /^(1|true)$/i.test(attrs.keepwithnext ?? '');
    const defaultKeepsNext = [
      'sceneHeading',
      'character',
      'parenthetical',
    ].includes(type);
    if ('keepwithnext' in attrs && keepsNext !== defaultKeepsNext)
      warnings.push(
        `OSF ${name} keep-with-next is retained for export; pagination uses OpenDraft's element flow rules.`,
      );
    rules[type] = rule;
  }
  pageLayout.osfSource = { settings, styles };
  return { pageLayout, rules };
}

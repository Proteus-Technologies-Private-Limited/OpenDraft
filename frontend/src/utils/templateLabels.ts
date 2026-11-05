/**
 * Display text for formatting templates.
 *
 * A built-in template is identified by its stable id; the name, description,
 * group and tagline stored on the template are the English source and stay as
 * they are (a name may be saved or compared). What the writer reads is looked
 * up here by id, with the stored English as the fallback. A writer's own
 * template has no entry, so what they typed is shown verbatim.
 *
 * The tables hold functions, never strings, so `t()` runs at render time in the
 * current language — not once at import.
 */

import { t } from '../i18n';
import type { FormattingTemplate } from '../stores/formattingTypes';

interface SystemText {
  name: () => string;
  description: () => string;
  tagline?: () => string;
}

const SYSTEM_TEXT: Record<string, SystemText> = {
  __industry_standard__: {
    name: () => t('templates:system.industryStandard.name'),
    description: () => t('templates:system.industryStandard.description'),
  },
  __one_hour_drama__: {
    name: () => t('templates:system.oneHourDrama.name'),
    description: () => t('templates:system.oneHourDrama.description'),
    tagline: () => t('templates:system.oneHourDrama.tagline'),
  },
  __multicam_sitcom__: {
    name: () => t('templates:system.multicamSitcom.name'),
    description: () => t('templates:system.multicamSitcom.description'),
    tagline: () => t('templates:system.multicamSitcom.tagline'),
  },
  __stage_play__: {
    name: () => t('templates:system.stagePlay.name'),
    description: () => t('templates:system.stagePlay.description'),
    tagline: () => t('templates:system.stagePlay.tagline'),
  },
  __radio_play__: {
    name: () => t('templates:system.radioPlay.name'),
    description: () => t('templates:system.radioPlay.description'),
    tagline: () => t('templates:system.radioPlay.tagline'),
  },
  __podcast__: {
    name: () => t('templates:system.podcast.name'),
    description: () => t('templates:system.podcast.description'),
    tagline: () => t('templates:system.podcast.tagline'),
  },
  __comic__: {
    name: () => t('templates:system.comic.name'),
    description: () => t('templates:system.comic.description'),
    tagline: () => t('templates:system.comic.tagline'),
  },
  __av_script__: {
    name: () => t('templates:system.avScript.name'),
    description: () => t('templates:system.avScript.description'),
    tagline: () => t('templates:system.avScript.tagline'),
  },
};

const GROUP_TEXT: Record<string, () => string> = {
  TV: () => t('templates:group.tv'),
  Stage: () => t('templates:group.stage'),
  Audio: () => t('templates:group.audio'),
  Comics: () => t('templates:group.comics'),
  AV: () => t('templates:group.av'),
};

function systemText(tpl: Pick<FormattingTemplate, 'id' | 'category'>): SystemText | null {
  if (tpl.category !== 'system') return null;
  return Object.prototype.hasOwnProperty.call(SYSTEM_TEXT, tpl.id) ? SYSTEM_TEXT[tpl.id] : null;
}

function safe(read: () => string, fallback: string): string {
  try {
    return read() || fallback;
  } catch (err) {
    console.warn('[templateLabels] could not translate template text', err);
    return fallback;
  }
}

/** Name to show for a template: translated if built in, as typed if the writer's own. */
export function templateName(tpl: Pick<FormattingTemplate, 'id' | 'name' | 'category'>): string {
  const s = systemText(tpl);
  return s ? safe(s.name, tpl.name) : tpl.name;
}

export function templateDescription(tpl: Pick<FormattingTemplate, 'id' | 'description' | 'category'>): string {
  const s = systemText(tpl);
  return s ? safe(s.description, tpl.description) : tpl.description;
}

/** The picker-card line: the tagline when the template has one, else its description. */
export function templateTagline(
  tpl: Pick<FormattingTemplate, 'id' | 'description' | 'category' | 'scriptTypeTagline'>,
): string {
  const s = systemText(tpl);
  if (s && tpl.scriptTypeTagline && s.tagline) return safe(s.tagline, tpl.scriptTypeTagline);
  return tpl.scriptTypeTagline || templateDescription(tpl);
}

export function templateGroup(tpl: Pick<FormattingTemplate, 'category' | 'scriptTypeGroup'>): string | undefined {
  const g = tpl.scriptTypeGroup;
  if (!g) return g;
  if (tpl.category === 'system' && Object.prototype.hasOwnProperty.call(GROUP_TEXT, g)) {
    return safe(GROUP_TEXT[g], g);
  }
  return g;
}

/**
 * Element colours for exports.
 *
 * A formatting template can give each element a text colour and a background,
 * and the editor paints them with CSS. The PDF writer asks here for the same
 * answer, once per export, the way it asks elementSpacing for the space before
 * each element: read lazily and defensively, so an export still produces a
 * document when the template store has not been hydrated (tests, headless).
 */

import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';

export interface ElementColors {
  /** "#rrggbb", or null to leave the text black. */
  text: string | null;
  /** "#rrggbb", or null to leave the line unpainted. */
  background: string | null;
}

export interface ColorRuleSource {
  rules?: Record<string, {
    enabled?: boolean;
    textColor?: string | null;
    backgroundColor?: string | null;
  } | undefined>;
}

/** "#rgb" or "#rrggbb" as "#rrggbb", or null for anything a PDF cannot be given. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1];
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `#${full.toLowerCase()}`;
}

/** Colours by element id, for the elements of a template that set any. */
export function buildElementColors(tpl: ColorRuleSource | null | undefined): Record<string, ElementColors> {
  const out: Record<string, ElementColors> = {};
  if (!tpl?.rules) return out;
  for (const [id, rule] of Object.entries(tpl.rules)) {
    if (!rule || rule.enabled === false) continue;
    const text = normalizeHex(rule.textColor);
    const background = normalizeHex(rule.backgroundColor);
    if (text || background) out[id] = { text, background };
  }
  return out;
}

/** Colours by element id for the active template. */
export function getElementColors(): Record<string, ElementColors> {
  try {
    return buildElementColors(useFormattingTemplateStore.getState().getActiveTemplate());
  } catch (err) {
    console.warn('[elementColors] could not read template colours, drawing plain ink', err);
    return {};
  }
}

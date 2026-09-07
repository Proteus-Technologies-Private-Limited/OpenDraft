/**
 * Zustand store for the formatting template system.
 *
 * Manages template CRUD, per-document template assignment, and provides
 * the resolved active template.
 */

import { create } from 'zustand';
import type { FormattingTemplate } from './formattingTypes';
import { INDUSTRY_STANDARD_ID } from './formattingTypes';
import { INDUSTRY_STANDARD_TEMPLATE } from './industryStandardTemplate';
import { titlePageRules } from './templates/_helpers';
import { MULTICAM_SITCOM_TEMPLATE, MULTICAM_SITCOM_ID } from './templates/multicamSitcomTemplate';
import { ONE_HOUR_DRAMA_TEMPLATE, ONE_HOUR_DRAMA_ID } from './templates/oneHourDramaTemplate';
import { STAGE_PLAY_TEMPLATE, STAGE_PLAY_ID } from './templates/stagePlayTemplate';
import { RADIO_PLAY_TEMPLATE, RADIO_PLAY_ID } from './templates/radioPlayTemplate';
import { AV_SCRIPT_TEMPLATE, AV_SCRIPT_ID } from './templates/avScriptTemplate';
import { api } from '../services/api';
import { useSettingsStore } from './settingsStore';

/** Built-in system templates, keyed by id. Read-only — never persisted. */
export const SYSTEM_TEMPLATES: Record<string, FormattingTemplate> = {
  [INDUSTRY_STANDARD_ID]: INDUSTRY_STANDARD_TEMPLATE,
  [MULTICAM_SITCOM_ID]: MULTICAM_SITCOM_TEMPLATE,
  [ONE_HOUR_DRAMA_ID]: ONE_HOUR_DRAMA_TEMPLATE,
  [STAGE_PLAY_ID]: STAGE_PLAY_TEMPLATE,
  [RADIO_PLAY_ID]: RADIO_PLAY_TEMPLATE,
  [AV_SCRIPT_ID]: AV_SCRIPT_TEMPLATE,
};

/** Ordered list of system templates for the format picker. */
export const SYSTEM_TEMPLATE_LIST: FormattingTemplate[] = [
  INDUSTRY_STANDARD_TEMPLATE,
  ONE_HOUR_DRAMA_TEMPLATE,
  MULTICAM_SITCOM_TEMPLATE,
  STAGE_PLAY_TEMPLATE,
  RADIO_PLAY_TEMPLATE,
  AV_SCRIPT_TEMPLATE,
];

interface FormattingTemplateState {
  /** All user-created templates */
  templates: FormattingTemplate[];
  /** Active template id for the currently open document */
  activeTemplateId: string | null;
  /** Whether templates have been loaded from storage */
  loaded: boolean;

  // ── Computed helpers ──
  /** Returns the resolved active template (per-document or industry standard). */
  getActiveTemplate: () => FormattingTemplate;
  /** Returns list of enabled element ids in the active template. */
  getEnabledElements: () => string[];
  /** Returns whether the active template is in enforce mode. */
  isEnforceMode: () => boolean;

  // ── Actions ──
  loadTemplates: () => Promise<void>;
  createTemplate: (t: Partial<FormattingTemplate>) => Promise<FormattingTemplate>;
  updateTemplate: (id: string, data: Partial<FormattingTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<FormattingTemplate>;
  setActiveTemplateId: (id: string | null) => void;
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* fallback */ }
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Give a stored template the title-page rules it predates.
 *
 * Templates are persisted as whole objects, so every one saved before the title
 * page had rules of its own comes back without them — and a missing rule means
 * the template editor cannot show the field and the stylesheet emits nothing
 * for it. Filling the gaps on read costs one object spread and needs no
 * migration pass over storage, which matters because templates live in three
 * places (local SQLite, the backend, and the cloud copy).
 *
 * Only absent ids are added: a rule the writer has already customised is left
 * exactly as they set it.
 */
function withTitlePageRules(template: FormattingTemplate): FormattingTemplate {
  const defaults = titlePageRules();
  const missing = Object.keys(defaults).filter((id) => !template.rules?.[id]);
  if (missing.length === 0) return template;
  const rules = { ...template.rules };
  for (const id of missing) rules[id] = defaults[id];
  return { ...template, rules };
}


/**
 * The optional script-type fields of a template, picked off `source` and
 * included only where it actually has them.
 *
 * These carry the parts of a format that live outside `rules`: the starter
 * pages, which title-page fields appear, act breaks, dialogue line spacing.
 * Create and duplicate both dropped them, which went unnoticed while a custom
 * template could only restyle the document already on screen. It stops being
 * invisible once a custom template can start a new script — a copy of the
 * Multi-Cam Sitcom would open on a blank page, single-spaced.
 *
 * Absent keys are left out rather than written as `undefined`, so a template
 * round-trips through JSON storage unchanged. Callers that store the result
 * must deep-copy it: the source may be a system template, which is a shared
 * module-level singleton the template editor must never be able to reach.
 */
function optionalFormatFields(source: Partial<FormattingTemplate>): Partial<FormattingTemplate> {
  const out: Partial<FormattingTemplate> = {};
  if (source.pageLayout) out.pageLayout = source.pageLayout;
  if (source.starterDocument?.length) out.starterDocument = source.starterDocument;
  if (source.pageTimeSeconds !== undefined) out.pageTimeSeconds = source.pageTimeSeconds;
  if (source.titlePageFields?.length) out.titlePageFields = source.titlePageFields;
  if (source.forceBreakBefore?.length) out.forceBreakBefore = source.forceBreakBefore;
  if (source.lineHeightMultiplier) out.lineHeightMultiplier = source.lineHeightMultiplier;
  return out;
}

/** Resolve an id against the built-in formats first, then the writer's own. */
function resolveTemplate(
  id: string | null | undefined,
  templates: FormattingTemplate[],
): FormattingTemplate | null {
  if (!id) return null;
  const sys = SYSTEM_TEMPLATES[id];
  if (sys) return sys;
  const found = templates.find((t) => t.id === id);
  return found ? withTitlePageRules(found) : null;
}

/**
 * The template with this id, or null if nothing answers to it.
 *
 * Callers outside the store used to reach straight into SYSTEM_TEMPLATES, which
 * silently resolved every custom template to nothing.
 */
export function findTemplate(id: string | null | undefined): FormattingTemplate | null {
  return resolveTemplate(id, useFormattingTemplateStore.getState().templates);
}

/** In-flight load, so callers arriving together share one round-trip. */
let loadInFlight: Promise<void> | null = null;

/**
 * Resolves once the writer's own templates are in the store.
 *
 * The enabled-format ids come out of localStorage synchronously, but the
 * templates they name arrive from storage over a promise. Anything that turns
 * an id back into a template — starting a new script, above all — has to wait
 * here first, or a custom format silently falls back to Industry Standard
 * whenever the writer is quick enough to beat the load.
 */
export async function ensureTemplatesLoaded(): Promise<void> {
  const store = useFormattingTemplateStore.getState();
  if (store.loaded) return;
  if (!loadInFlight) {
    loadInFlight = store.loadTemplates().finally(() => { loadInFlight = null; });
  }
  await loadInFlight;
}

export const useFormattingTemplateStore = create<FormattingTemplateState>((set, get) => ({
  templates: [],
  activeTemplateId: null,
  loaded: false,

  getActiveTemplate: () => {
    const { activeTemplateId, templates } = get();
    return resolveTemplate(activeTemplateId, templates) || INDUSTRY_STANDARD_TEMPLATE;
  },

  getEnabledElements: () => {
    const template = get().getActiveTemplate();
    return Object.values(template.rules)
      .filter((r) => r.enabled)
      .map((r) => r.id);
  },

  isEnforceMode: () => {
    return get().getActiveTemplate().mode === 'enforce';
  },

  loadTemplates: async () => {
    try {
      const templates = await (api as any).listFormattingTemplates();
      set({ templates: (templates as FormattingTemplate[]).map(withTitlePageRules), loaded: true });
    } catch {
      // Storage not available yet or no templates
      set({ loaded: true });
    }
  },

  createTemplate: async (data) => {
    const id = uuid();
    const ts = now();
    const template: FormattingTemplate = {
      id,
      name: data.name || 'Untitled Template',
      description: data.description || '',
      mode: data.mode || 'enforce',
      category: data.category || 'user',
      rules: data.rules || { ...INDUSTRY_STANDARD_TEMPLATE.rules },
      // Deep-copied, so a template built from a system format cannot hold a
      // reference into it and let a later edit rewrite the built-in one.
      ...JSON.parse(JSON.stringify(optionalFormatFields(data))),
      createdAt: ts,
      updatedAt: ts,
    };
    try {
      await (api as any).createFormattingTemplate(template);
    } catch { /* web fallback: store in memory */ }
    set((s) => ({ templates: [...s.templates, template] }));
    return template;
  },

  updateTemplate: async (id, data) => {
    const ts = now();
    set((s) => ({
      templates: s.templates.map((t) =>
        t.id === id ? { ...t, ...data, updatedAt: ts } : t,
      ),
    }));
    const updated = get().templates.find((t) => t.id === id);
    if (updated) {
      try {
        await (api as any).updateFormattingTemplate(id, updated);
      } catch { /* ignore */ }
    }
  },

  deleteTemplate: async (id) => {
    set((s) => ({
      templates: s.templates.filter((t) => t.id !== id),
      activeTemplateId: s.activeTemplateId === id ? null : s.activeTemplateId,
    }));
    // A deleted template must also stop being a format new scripts can be
    // started in — otherwise the preference outlives the template it names and
    // New Screenplay quietly falls back to Industry Standard instead.
    const settings = useSettingsStore.getState();
    if (settings.enabledScriptFormats.includes(id)) {
      // The setter drops a default that is no longer enabled, so this covers
      // both preferences at once.
      settings.setEnabledScriptFormats(settings.enabledScriptFormats.filter((f) => f !== id));
    } else if (settings.defaultScriptFormat === id) {
      settings.setDefaultScriptFormat(null);
    }
    try {
      await (api as any).deleteFormattingTemplate(id);
    } catch { /* ignore */ }
  },

  duplicateTemplate: async (id) => {
    const source = SYSTEM_TEMPLATES[id] || get().templates.find((t) => t.id === id);
    if (!source) throw new Error('Template not found');

    return get().createTemplate({
      // Everything that makes the source the format it is, not just its rules:
      // a duplicate of the 1-Hour TV Drama that had lost the drama's starter
      // pages and act breaks would only look like the format it came from.
      ...optionalFormatFields(source),
      name: `${source.name} (Copy)`,
      description: source.description,
      mode: source.mode,
      rules: JSON.parse(JSON.stringify(source.rules)),
    });
  },

  setActiveTemplateId: (id) => {
    set({ activeTemplateId: id });
  },
}));

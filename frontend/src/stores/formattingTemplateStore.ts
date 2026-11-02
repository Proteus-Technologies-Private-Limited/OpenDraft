/**
 * Zustand store for the formatting template system.
 *
 * Manages template CRUD, per-document template assignment, and provides
 * the resolved active template.
 */

import { create } from 'zustand';
import { parseTemplateSnapshot, sameTemplateDefinition } from '../utils/templateSnapshot';
import type { FormattingTemplate } from './formattingTypes';
import { INDUSTRY_STANDARD_ID } from './formattingTypes';
import { INDUSTRY_STANDARD_TEMPLATE } from './industryStandardTemplate';
import { titlePageRules, avBlockRule } from './templates/_helpers';
import { MULTICAM_SITCOM_TEMPLATE, MULTICAM_SITCOM_ID } from './templates/multicamSitcomTemplate';
import { ONE_HOUR_DRAMA_TEMPLATE, ONE_HOUR_DRAMA_ID } from './templates/oneHourDramaTemplate';
import { STAGE_PLAY_TEMPLATE, STAGE_PLAY_ID } from './templates/stagePlayTemplate';
import { RADIO_PLAY_TEMPLATE, RADIO_PLAY_ID } from './templates/radioPlayTemplate';
import { PODCAST_TEMPLATE, PODCAST_ID } from './templates/podcastTemplate';
import { COMIC_TEMPLATE, COMIC_ID } from './templates/comicTemplate';
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
  [PODCAST_ID]: PODCAST_TEMPLATE,
  [COMIC_ID]: COMIC_TEMPLATE,
  [AV_SCRIPT_ID]: AV_SCRIPT_TEMPLATE,
};

/** Works in older WebViews as well as current browsers. */
export function isSystemTemplateId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SYSTEM_TEMPLATES, id);
}

/** Ordered list of system templates for the format picker. */
export const SYSTEM_TEMPLATE_LIST: FormattingTemplate[] = [
  INDUSTRY_STANDARD_TEMPLATE,
  ONE_HOUR_DRAMA_TEMPLATE,
  MULTICAM_SITCOM_TEMPLATE,
  STAGE_PLAY_TEMPLATE,
  RADIO_PLAY_TEMPLATE,
  PODCAST_TEMPLATE,
  COMIC_TEMPLATE,
  AV_SCRIPT_TEMPLATE,
];

interface FormattingTemplateState {
  /** All user-created templates */
  templates: FormattingTemplate[];
  /** Active template id for the currently open document */
  activeTemplateId: string | null;
  /** The open script's format, separate from this device's reusable library. */
  documentTemplate: FormattingTemplate | null;
  restoreDocumentTemplate: (id: unknown, snapshot?: unknown) => boolean;
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
 * Give a stored template the rules it predates.
 *
 * Templates are persisted as whole objects, so every one saved before an
 * element existed comes back without it — and a missing rule means the template
 * editor cannot show the field and the stylesheet emits nothing for it. Filling
 * the gaps on read costs one object spread and needs no migration pass over
 * storage, which matters because templates live in three places (local SQLite,
 * the backend, and the cloud copy).
 *
 * Two sets of rules have arrived this way: the title page's own elements, and
 * `avBlock` — the element-menu entry for a two-column AV body. The AV one comes
 * in switched OFF for a template that has never heard of it, because a writer's
 * own format is theirs to decide: the tick box in the Template Editor is how
 * they turn it on, not a default chosen for them.
 *
 * Only absent ids are added: a rule the writer has already customised is left
 * exactly as they set it.
 */
function withMissingRules(template: FormattingTemplate): FormattingTemplate {
  const defaults = { ...titlePageRules(), ...avBlockRule(false) };
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
  if (source.scriptTypeGroup) out.scriptTypeGroup = source.scriptTypeGroup;
  if (source.scriptTypeTagline) out.scriptTypeTagline = source.scriptTypeTagline;
  return out;
}

/** Resolve an id against the built-in formats first, then the writer's own. */
/**
 * `withMissingRules`, answered once per stored template.
 *
 * Components subscribe with `useFormattingTemplateStore((s) =>
 * s.getActiveTemplate())`, and React re-renders whenever that returns a
 * different object. A template saved without some rules — every duplicate of a
 * system format but Industry Standard, which alone carries the title-page
 * rules — was filled in afresh on every read, so the answer was never the same
 * object twice and the editor re-rendered until React gave up (error #185:
 * applying "Radio Play (Copy)" left a blank window). Templates are replaced,
 * never mutated, when they change, so keying on the object is enough.
 */
const filledTemplates = new WeakMap<FormattingTemplate, FormattingTemplate>();

function withMissingRulesOnce(template: FormattingTemplate): FormattingTemplate {
  let filled = filledTemplates.get(template);
  if (!filled) {
    filled = withMissingRules(template);
    filledTemplates.set(template, filled);
  }
  return filled;
}

function resolveTemplate(
  id: string | null | undefined,
  templates: FormattingTemplate[],
): FormattingTemplate | null {
  if (!id) return null;
  const sys = isSystemTemplateId(id) ? SYSTEM_TEMPLATES[id] : null;
  if (sys) return sys;
  const found = templates.find((t) => t.id === id);
  return found ? withMissingRulesOnce(found) : null;
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

/** Resolve a saved script independently of whichever document is open here. */
export function templateForSavedContent(content: Record<string, unknown> | null | undefined): FormattingTemplate | null {
  const id = content?._templateId;
  if (typeof id !== 'string') return null;
  if (isSystemTemplateId(id)) return SYSTEM_TEMPLATES[id];
  const snapshot = parseTemplateSnapshot(content?._templateSnapshot, id);
  return findTemplate(id) || (snapshot ? withMissingRulesOnce(snapshot) : null);
}

/** A detached copy of the active custom format, or no snapshot for built-ins. */
export function activeTemplateSnapshot(): FormattingTemplate | null {
  const store = useFormattingTemplateStore.getState();
  const active = store.getActiveTemplate();
  return active.id === store.activeTemplateId && !isSystemTemplateId(active.id)
    ? JSON.parse(JSON.stringify(active)) as FormattingTemplate : null;
}

/** Metadata saves must notice format-only edits, without reacting to unrelated library changes. */
export function subscribeActiveTemplate(listener: () => void): () => void {
  let previous = useFormattingTemplateStore.getState().getActiveTemplate();
  let previousId = useFormattingTemplateStore.getState().activeTemplateId;
  let wasLoaded = useFormattingTemplateStore.getState().loaded;
  return useFormattingTemplateStore.subscribe(state => {
    const current = state.getActiveTemplate();
    const libraryArrived = !wasLoaded && state.loaded;
    wasLoaded = state.loaded;
    if (libraryArrived) { previous = current; previousId = state.activeTemplateId; return; }
    if ((current !== previous && !sameTemplateDefinition(current, previous)) || state.activeTemplateId !== previousId) {
      previous = current;
      previousId = state.activeTemplateId;
      listener();
    }
  });
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
  documentTemplate: null,
  restoreDocumentTemplate: (value, snapshot) => {
    let payload = snapshot;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
    const legacyId = value === undefined && payload && typeof payload === 'object' && 'id' in payload ? payload.id : null;
    const selected = value ?? legacyId;
    const id = typeof selected === 'string' && selected ? selected : null;
    const parsed = id && !isSystemTemplateId(id) ? parseTemplateSnapshot(payload, id) : null;
    set({ activeTemplateId: id, documentTemplate: parsed ? withMissingRulesOnce(parsed) : null });
    return snapshot == null || !!id && isSystemTemplateId(id) || !!parsed;
  },
  loaded: false,

  getActiveTemplate: () => {
    const { activeTemplateId, templates, documentTemplate } = get();
    return resolveTemplate(activeTemplateId, templates)
      || (documentTemplate?.id === activeTemplateId ? documentTemplate : null)
      || INDUSTRY_STANDARD_TEMPLATE;
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
      set({ templates: (templates as FormattingTemplate[]).map(withMissingRules), loaded: true });
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
      activeTemplateId: s.activeTemplateId === id && !s.documentTemplate ? null : s.activeTemplateId,
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
    set({ activeTemplateId: id, documentTemplate: null });
  },
}));

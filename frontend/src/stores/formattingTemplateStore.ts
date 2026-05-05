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
import { MULTICAM_SITCOM_TEMPLATE, MULTICAM_SITCOM_ID } from './templates/multicamSitcomTemplate';
import { ONE_HOUR_DRAMA_TEMPLATE, ONE_HOUR_DRAMA_ID } from './templates/oneHourDramaTemplate';
import { STAGE_PLAY_TEMPLATE, STAGE_PLAY_ID } from './templates/stagePlayTemplate';
import { RADIO_PLAY_TEMPLATE, RADIO_PLAY_ID } from './templates/radioPlayTemplate';
import { AV_SCRIPT_TEMPLATE, AV_SCRIPT_ID } from './templates/avScriptTemplate';
import { api } from '../services/api';

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

export const useFormattingTemplateStore = create<FormattingTemplateState>((set, get) => ({
  templates: [],
  activeTemplateId: null,
  loaded: false,

  getActiveTemplate: () => {
    const { activeTemplateId, templates } = get();
    if (activeTemplateId) {
      const sys = SYSTEM_TEMPLATES[activeTemplateId];
      if (sys) return sys;
      const found = templates.find((t) => t.id === activeTemplateId);
      if (found) return found;
    }
    return INDUSTRY_STANDARD_TEMPLATE;
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
      set({ templates, loaded: true });
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
    try {
      await (api as any).deleteFormattingTemplate(id);
    } catch { /* ignore */ }
  },

  duplicateTemplate: async (id) => {
    const source = SYSTEM_TEMPLATES[id] || get().templates.find((t) => t.id === id);
    if (!source) throw new Error('Template not found');

    return get().createTemplate({
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

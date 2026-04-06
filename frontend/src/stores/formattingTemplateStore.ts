/**
 * Zustand store for the formatting template system.
 *
 * Manages global formatting mode, template CRUD, per-document template
 * assignment, and provides the resolved active template.
 */

import { create } from 'zustand';
import type { FormattingTemplate } from './formattingTypes';
import { INDUSTRY_STANDARD_ID } from './formattingTypes';
import { INDUSTRY_STANDARD_TEMPLATE } from './industryStandardTemplate';
import { api } from '../services/api';

const STORAGE_KEY_MODE = 'opendraft:formattingMode';
const STORAGE_KEY_DEFAULT = 'opendraft:defaultTemplateId';

interface FormattingTemplateState {
  /** Global preference: use industry standard or custom templates */
  formattingMode: 'standard' | 'custom';
  /** All user-created templates */
  templates: FormattingTemplate[];
  /** Default template id for new documents (when mode = custom) */
  defaultTemplateId: string | null;
  /** Active template id for the currently open document */
  activeTemplateId: string | null;
  /** Whether templates have been loaded from storage */
  loaded: boolean;

  // ── Computed helpers ──
  /** Returns the resolved active template (industry standard or custom). */
  getActiveTemplate: () => FormattingTemplate;
  /** Returns list of enabled element ids in the active template. */
  getEnabledElements: () => string[];

  // ── Actions ──
  setFormattingMode: (mode: 'standard' | 'custom') => void;
  loadTemplates: () => Promise<void>;
  createTemplate: (t: Partial<FormattingTemplate>) => Promise<FormattingTemplate>;
  updateTemplate: (id: string, data: Partial<FormattingTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  duplicateTemplate: (id: string) => Promise<FormattingTemplate>;
  setDefaultTemplateId: (id: string | null) => void;
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
  formattingMode: (localStorage.getItem(STORAGE_KEY_MODE) as 'standard' | 'custom') || 'standard',
  templates: [],
  defaultTemplateId: localStorage.getItem(STORAGE_KEY_DEFAULT) || null,
  activeTemplateId: null,
  loaded: false,

  getActiveTemplate: () => {
    const { formattingMode, activeTemplateId, templates, defaultTemplateId } = get();
    if (formattingMode === 'standard') return INDUSTRY_STANDARD_TEMPLATE;

    // Resolve: document-specific > global default > industry standard
    const resolvedId = activeTemplateId || defaultTemplateId;
    if (resolvedId && resolvedId !== INDUSTRY_STANDARD_ID) {
      const found = templates.find((t) => t.id === resolvedId);
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

  setFormattingMode: (mode) => {
    localStorage.setItem(STORAGE_KEY_MODE, mode);
    set({ formattingMode: mode });
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
      defaultTemplateId: s.defaultTemplateId === id ? null : s.defaultTemplateId,
      activeTemplateId: s.activeTemplateId === id ? null : s.activeTemplateId,
    }));
    try {
      await (api as any).deleteFormattingTemplate(id);
    } catch { /* ignore */ }
  },

  duplicateTemplate: async (id) => {
    const source = id === INDUSTRY_STANDARD_ID
      ? INDUSTRY_STANDARD_TEMPLATE
      : get().templates.find((t) => t.id === id);
    if (!source) throw new Error('Template not found');

    return get().createTemplate({
      name: `${source.name} (Copy)`,
      description: source.description,
      mode: source.mode,
      rules: JSON.parse(JSON.stringify(source.rules)),
    });
  },

  setDefaultTemplateId: (id) => {
    if (id) {
      localStorage.setItem(STORAGE_KEY_DEFAULT, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_DEFAULT);
    }
    set({ defaultTemplateId: id });
  },

  setActiveTemplateId: (id) => {
    set({ activeTemplateId: id });
  },
}));

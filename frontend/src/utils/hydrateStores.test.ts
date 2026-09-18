/**
 * Restoring a session has to bring the formatting template back with the
 * document.
 *
 * An AV script that came back under Industry Standard was the visible failure:
 * the toolbar's element list is scoped to the caret's context, and a screenplay
 * template has no AV cell rules to offer there.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { AV_SCRIPT_ID } from '../stores/templates/avScriptTemplate';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';

describe('hydrateEditorStoresFromContent — formatting template', () => {
  beforeEach(() => {
    useFormattingTemplateStore.getState().setActiveTemplateId(null);
  });

  it('restores the AV template from a recovery payload', () => {
    hydrateEditorStoresFromContent({ _notes: [], _templateId: AV_SCRIPT_ID });
    const active = useFormattingTemplateStore.getState().getActiveTemplate();
    expect(active.id).toBe(AV_SCRIPT_ID);
    // The four AV cell types are what the restored document's cells hold.
    expect(active.rules.avPara?.enabled).toBe(true);
  });

  it('leaves the template alone for a payload that names none', () => {
    useFormattingTemplateStore.getState().setActiveTemplateId(AV_SCRIPT_ID);
    hydrateEditorStoresFromContent({ _notes: [] });
    expect(useFormattingTemplateStore.getState().getActiveTemplate().id).toBe(AV_SCRIPT_ID);
  });

  it('falls back to Industry Standard for an id nothing answers to', () => {
    hydrateEditorStoresFromContent({ _notes: [], _templateId: 'deleted-on-another-device' });
    expect(useFormattingTemplateStore.getState().getActiveTemplate().id).toBe(INDUSTRY_STANDARD_ID);
  });
});

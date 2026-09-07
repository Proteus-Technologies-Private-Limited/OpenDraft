/**
 * The format a new script starts in.
 *
 * Issue #114 asked for a custom template to be settable as the default. The
 * preference is an id in settings, so what these tests guard is the two ways an
 * id can lie: naming a template that no longer exists, and naming one whose
 * format was hollowed out on the way into storage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useFormattingTemplateStore, findTemplate } from './formattingTemplateStore';
import { useSettingsStore } from './settingsStore';
import { MULTICAM_SITCOM_ID, MULTICAM_SITCOM_TEMPLATE } from './templates/multicamSitcomTemplate';
import { STAGE_PLAY_ID } from './templates/stagePlayTemplate';
import { INDUSTRY_STANDARD_ID } from './formattingTypes';

beforeEach(() => {
  useFormattingTemplateStore.setState({ templates: [], activeTemplateId: null, loaded: true });
  useSettingsStore.getState().setEnabledScriptFormats([]);
  useSettingsStore.getState().setDefaultScriptFormat(null);
});

describe('duplicating a script format', () => {
  it('keeps what makes the sitcom a sitcom, not just its fonts', async () => {
    const copy = await useFormattingTemplateStore.getState().duplicateTemplate(MULTICAM_SITCOM_ID);

    expect(copy.starterDocument).toEqual(MULTICAM_SITCOM_TEMPLATE.starterDocument);
    expect(copy.forceBreakBefore).toEqual(['newAct', 'sceneHeading']);
    expect(copy.lineHeightMultiplier).toEqual({ dialogue: 2.0 });
    expect(copy.pageTimeSeconds).toBe(30);
  });

  it('carries the stage play its own title-page field list', async () => {
    const copy = await useFormattingTemplateStore.getState().duplicateTemplate(STAGE_PLAY_ID);
    expect(copy.titlePageFields).toContain('tpWrittenBy');
  });

  // The system templates are module-level singletons shared by every document,
  // so a copy that pointed back into one would let the template editor rewrite
  // the built-in format for everybody.
  it('deep-copies, so editing the copy cannot reach the original', async () => {
    const copy = await useFormattingTemplateStore.getState().duplicateTemplate(MULTICAM_SITCOM_ID);
    copy.forceBreakBefore!.push('transition');
    copy.lineHeightMultiplier!.dialogue = 1;

    expect(MULTICAM_SITCOM_TEMPLATE.forceBreakBefore).toEqual(['newAct', 'sceneHeading']);
    expect(MULTICAM_SITCOM_TEMPLATE.lineHeightMultiplier).toEqual({ dialogue: 2.0 });
  });

  it('leaves absent fields absent rather than writing undefined into storage', async () => {
    const plain = await useFormattingTemplateStore.getState().createTemplate({ name: 'Plain' });
    expect(Object.keys(plain)).not.toContain('starterDocument');
    expect(Object.keys(plain)).not.toContain('forceBreakBefore');
  });
});

describe('resolving a format id', () => {
  it('finds the writer\'s own template, not only the built-in ones', async () => {
    const mine = await useFormattingTemplateStore.getState().createTemplate({ name: 'My Format' });

    expect(findTemplate(mine.id)?.name).toBe('My Format');
    expect(findTemplate(INDUSTRY_STANDARD_ID)?.id).toBe(INDUSTRY_STANDARD_ID);
    expect(findTemplate('no-such-template')).toBeNull();
    expect(findTemplate(null)).toBeNull();
  });
});

describe('the default new-script format', () => {
  it('is dropped when the format it names is switched off', async () => {
    const settings = useSettingsStore.getState();
    settings.setEnabledScriptFormats([INDUSTRY_STANDARD_ID, MULTICAM_SITCOM_ID]);
    settings.setDefaultScriptFormat(MULTICAM_SITCOM_ID);

    settings.setEnabledScriptFormats([INDUSTRY_STANDARD_ID]);

    expect(useSettingsStore.getState().defaultScriptFormat).toBeNull();
  });

  it('survives a change that leaves it enabled', () => {
    const settings = useSettingsStore.getState();
    settings.setEnabledScriptFormats([INDUSTRY_STANDARD_ID, MULTICAM_SITCOM_ID]);
    settings.setDefaultScriptFormat(MULTICAM_SITCOM_ID);

    settings.setEnabledScriptFormats([MULTICAM_SITCOM_ID, STAGE_PLAY_ID]);

    expect(useSettingsStore.getState().defaultScriptFormat).toBe(MULTICAM_SITCOM_ID);
  });

  // Otherwise the preference outlives the template it names, and New Screenplay
  // falls back to Industry Standard with no explanation.
  it('is retired along with the template it names', async () => {
    const store = useFormattingTemplateStore.getState();
    const mine = await store.createTemplate({ name: 'My Format' });
    const settings = useSettingsStore.getState();
    settings.setEnabledScriptFormats([INDUSTRY_STANDARD_ID, mine.id]);
    settings.setDefaultScriptFormat(mine.id);

    await useFormattingTemplateStore.getState().deleteTemplate(mine.id);

    expect(useSettingsStore.getState().defaultScriptFormat).toBeNull();
    expect(useSettingsStore.getState().enabledScriptFormats).toEqual([INDUSTRY_STANDARD_ID]);
  });

  it('leaves the other formats alone when a non-default template goes', async () => {
    const store = useFormattingTemplateStore.getState();
    const mine = await store.createTemplate({ name: 'Spare' });
    const settings = useSettingsStore.getState();
    settings.setEnabledScriptFormats([INDUSTRY_STANDARD_ID, mine.id]);
    settings.setDefaultScriptFormat(INDUSTRY_STANDARD_ID);

    await useFormattingTemplateStore.getState().deleteTemplate(mine.id);

    expect(useSettingsStore.getState().defaultScriptFormat).toBe(INDUSTRY_STANDARD_ID);
    expect(useSettingsStore.getState().enabledScriptFormats).toEqual([INDUSTRY_STANDARD_ID]);
  });
});

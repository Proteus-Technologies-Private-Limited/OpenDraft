/**
 * "AV Columns" as an element a template offers.
 *
 * `avBlock` carries a `FormattingElementRule` like any other element, so the
 * decision about whether a format may contain a two-column body lives in the
 * template — and, through the Template Editor's enable checkbox, with the
 * writer. Before this, the only route to one was the Format menu.
 *
 * It is not a paragraph type. Picking it inserts an `avBlock`, and its
 * typography fields are never read: an AV body is a table, and the formatting
 * lives on the elements in its cells.
 */
import { describe, it, expect } from 'vitest';
import {
  AV_BLOCK_RULE_ID,
  ELEMENT_DESCRIPTIONS,
  createDefaultRule,
  type FormattingTemplate,
} from './formattingTypes';
import { SYSTEM_TEMPLATE_LIST } from './formattingTemplateStore';
import { INDUSTRY_STANDARD_TEMPLATE } from './industryStandardTemplate';
import { AV_SCRIPT_TEMPLATE } from './templates/avScriptTemplate';
import { generateTemplateCss } from '../utils/templateCss';
import { DEFAULT_PAGE_LAYOUT } from './editorStore';

describe('the avBlock rule', () => {
  it('is present in every system format, so the Template Editor can show it', () => {
    for (const template of SYSTEM_TEMPLATE_LIST) {
      expect(template.rules[AV_BLOCK_RULE_ID], `${template.name} has no avBlock rule`).toBeTruthy();
    }
  });

  it('is on where a two-column body is expected', () => {
    expect(INDUSTRY_STANDARD_TEMPLATE.rules[AV_BLOCK_RULE_ID].enabled).toBe(true);
    expect(AV_SCRIPT_TEMPLATE.rules[AV_BLOCK_RULE_ID].enabled).toBe(true);
  });

  it('is off in the formats that have no use for one', () => {
    const off = SYSTEM_TEMPLATE_LIST
      .filter((t) => !t.rules[AV_BLOCK_RULE_ID].enabled)
      .map((t) => t.name);
    // Stage, radio and the two TV formats. The point is only that the default
    // varies by format and is a decision, not that any particular one is off.
    expect(off.length).toBeGreaterThan(0);
  });

  it('carries a label a menu can show, and an explanation', () => {
    const rule = AV_SCRIPT_TEMPLATE.rules[AV_BLOCK_RULE_ID];
    expect(rule.label.trim()).not.toBe('');
    expect(ELEMENT_DESCRIPTIONS[AV_BLOCK_RULE_ID]).toContain('two-column');
  });

  it('emits no CSS — there is no element on the page for it to style', () => {
    const css = generateTemplateCss(AV_SCRIPT_TEMPLATE, DEFAULT_PAGE_LAYOUT);
    expect(css).not.toContain(AV_BLOCK_RULE_ID);
    expect(css).not.toContain('av-block');
  });

  it('is never the target of an element flow', () => {
    // Enter and Tab switch a line's TYPE. "Insert a table" is not a type a line
    // can become, so no rule may point at it.
    for (const template of SYSTEM_TEMPLATE_LIST) {
      for (const rule of Object.values(template.rules)) {
        expect(rule.nextOnEnter, `${template.name}/${rule.id}`).not.toBe(AV_BLOCK_RULE_ID);
        expect(rule.nextOnTab, `${template.name}/${rule.id}`).not.toBe(AV_BLOCK_RULE_ID);
      }
    }
  });
});

describe('the avCell placement field', () => {
  it('defaults to "none" on a newly created rule', () => {
    expect(createDefaultRule('soundEffect', 'Sound Effect', false).avCell).toBe('none');
  });

  it('is "none" throughout a plain screenplay template', () => {
    // An AV body inserted into a screenplay offers exactly the four AV types,
    // as it did before the field existed.
    for (const rule of Object.values(INDUSTRY_STANDARD_TEMPLATE.rules)) {
      expect(rule.avCell ?? 'none', rule.id).toBe('none');
    }
  });

  it('splits the AV template the way the two-column format is written', () => {
    const r = AV_SCRIPT_TEMPLATE.rules;
    expect(r.action.avCell).toBe('video');
    expect(r.shot.avCell).toBe('video');
    expect(r.character.avCell).toBe('audio');
    expect(r.dialogue.avCell).toBe('audio');
    expect(r.parenthetical.avCell).toBe('audio');
    expect(r.lyrics.avCell).toBe('audio');
    expect(r.general.avCell).toBe('both');
  });

  it('re-enables the elements the AV template used to hide outright', () => {
    // Disabling them left no way to write an on-camera interview or a
    // spokesperson — which is most of what a corporate or documentary AV
    // script contains.
    for (const id of ['character', 'dialogue', 'parenthetical', 'shot', 'lyrics']) {
      expect(AV_SCRIPT_TEMPLATE.rules[id].enabled, id).toBe(true);
    }
  });
});

describe('templates saved before these rules existed', () => {
  /** A stored user template with neither the title-page nor the AV rules. */
  const legacy: FormattingTemplate = {
    ...INDUSTRY_STANDARD_TEMPLATE,
    id: 'user-1',
    category: 'user',
    rules: { action: INDUSTRY_STANDARD_TEMPLATE.rules.action },
  };

  it('gains the rule on read, switched off', async () => {
    // A writer's own format is theirs to decide: backfilling it ON would put an
    // element in their menu they never asked for. The tick box is how they
    // turn it on.
    const { useFormattingTemplateStore } = await import('./formattingTemplateStore');
    useFormattingTemplateStore.setState({ templates: [legacy], activeTemplateId: 'user-1' });
    const resolved = useFormattingTemplateStore.getState().getActiveTemplate();
    expect(resolved.rules[AV_BLOCK_RULE_ID]).toBeTruthy();
    expect(resolved.rules[AV_BLOCK_RULE_ID].enabled).toBe(false);
    useFormattingTemplateStore.setState({ templates: [], activeTemplateId: null });
  });

  it('leaves a rule the writer has already set exactly as it is', async () => {
    const { useFormattingTemplateStore } = await import('./formattingTemplateStore');
    const customised: FormattingTemplate = {
      ...legacy,
      rules: {
        ...legacy.rules,
        [AV_BLOCK_RULE_ID]: { ...AV_SCRIPT_TEMPLATE.rules[AV_BLOCK_RULE_ID], label: 'Columns' },
      },
    };
    useFormattingTemplateStore.setState({ templates: [customised], activeTemplateId: 'user-1' });
    const resolved = useFormattingTemplateStore.getState().getActiveTemplate();
    expect(resolved.rules[AV_BLOCK_RULE_ID].label).toBe('Columns');
    expect(resolved.rules[AV_BLOCK_RULE_ID].enabled).toBe(true);
    useFormattingTemplateStore.setState({ templates: [], activeTemplateId: null });
  });
});

import { describe, it, expect } from 'vitest';
import {
  TITLE_PAGE_ELEMENTS, titlePageRuleId, titlePageFieldOf, isTitlePageRuleId,
} from './formattingTypes';
import { titlePageRules } from './templates/_helpers';
import { INDUSTRY_STANDARD_TEMPLATE } from './industryStandardTemplate';
import { generateTemplateCss } from '../utils/templateCss';
import { DEFAULT_PAGE_LAYOUT } from './editorStore';

describe('title page element rules', () => {
  it('gives every field on the page a rule of its own', () => {
    const rules = titlePageRules();
    for (const { field } of TITLE_PAGE_ELEMENTS) {
      expect(rules[titlePageRuleId(field)], field).toBeDefined();
    }
  });

  it('ships them in the standard template, so the editor can show them', () => {
    for (const { field, label } of TITLE_PAGE_ELEMENTS) {
      const rule = INDUSTRY_STANDARD_TEMPLATE.rules[titlePageRuleId(field)];
      expect(rule, field).toBeDefined();
      expect(rule.label).toBe(label);
      expect(rule.enabled).toBe(true);
    }
  });

  it('keeps the look screenplay.css has always drawn', () => {
    const rules = titlePageRules();
    expect(rules['titlePage:title'].bold).toBe(true);
    expect(rules['titlePage:title'].textTransform).toBe('uppercase');
    expect(rules['titlePage:title'].textAlign).toBe('center');
    expect(rules['titlePage:draft'].textAlign).toBe('left');
    expect(rules['titlePage:contact'].textAlign).toBe('right');
    expect(rules['titlePage:copyright'].textAlign).toBe('right');
  });

  it('round-trips a rule id to its field and back', () => {
    expect(titlePageRuleId('contact')).toBe('titlePage:contact');
    expect(titlePageFieldOf('titlePage:contact')).toBe('contact');
    expect(titlePageFieldOf('action')).toBeNull();
    expect(isTitlePageRuleId('titlePage:title')).toBe(true);
    expect(isTitlePageRuleId('sceneHeading')).toBe(false);
  });

  // The ids share no namespace with element types, so nothing can mistake a
  // title-page rule for something a paragraph converts into.
  it('cannot collide with a body element id', () => {
    for (const id of Object.keys(INDUSTRY_STANDARD_TEMPLATE.rules)) {
      if (isTitlePageRuleId(id)) continue;
      expect(id.includes(':')).toBe(false);
    }
  });

  it('selects the title page classes the node view renders', () => {
    const css = generateTemplateCss(INDUSTRY_STANDARD_TEMPLATE, DEFAULT_PAGE_LAYOUT);
    // One node type with a `field` attribute, not a node type each.
    expect(css).toContain('.screenplay-element.title-page-title');
    expect(css).toContain('.screenplay-element.title-page-contact');
    // And never as though it were a node type of its own.
    expect(css).not.toContain('data-type="titlePage:title"');
  });

  it('carries a font choice into the stylesheet, which is the point of the rules', () => {
    const template = {
      ...INDUSTRY_STANDARD_TEMPLATE,
      rules: {
        ...INDUSTRY_STANDARD_TEMPLATE.rules,
        'titlePage:title': {
          ...INDUSTRY_STANDARD_TEMPLATE.rules['titlePage:title'],
          fontFamily: 'Cinzel',
          fontSize: 24,
        },
      },
    };
    const css = generateTemplateCss(template, DEFAULT_PAGE_LAYOUT);
    const block = css.split('.screenplay-element.title-page-title')[1] ?? '';
    expect(block).toContain("'Cinzel'");
    expect(block).toContain('font-size: 24pt;');
  });
});

describe('applying the template to the title page', () => {
  // The industry-standard template is served by the static stylesheet, so it
  // takes a different path — and the title page has no static rules a template
  // can drive. Emitting nothing there meant a title font set in the template
  // worked on every template except the default one.
  it('emits the title page rules even for the industry-standard template', () => {
    const css = generateTemplateCss(INDUSTRY_STANDARD_TEMPLATE, DEFAULT_PAGE_LAYOUT, {
      titlePageOnly: true,
    });
    for (const { field } of TITLE_PAGE_ELEMENTS) {
      expect(css, field).toContain(`.screenplay-element.title-page-${field}`);
    }
  });

  it('emits nothing else in that mode — the body keeps the static stylesheet', () => {
    const css = generateTemplateCss(INDUSTRY_STANDARD_TEMPLATE, DEFAULT_PAGE_LAYOUT, {
      titlePageOnly: true,
    });
    expect(css).not.toContain('scene-heading');
    expect(css).not.toContain('.character');
    expect(css).not.toContain('.dialogue');
  });

  it('carries a template title font through on the default template', () => {
    const template = {
      ...INDUSTRY_STANDARD_TEMPLATE,
      rules: {
        ...INDUSTRY_STANDARD_TEMPLATE.rules,
        'titlePage:title': {
          ...INDUSTRY_STANDARD_TEMPLATE.rules['titlePage:title'],
          fontFamily: 'Bebas Neue',
          fontSize: 30,
        },
      },
    };
    const css = generateTemplateCss(template, DEFAULT_PAGE_LAYOUT, { titlePageOnly: true });
    const block = css.split('.screenplay-element.title-page-title')[1] ?? '';
    expect(block).toContain("'Bebas Neue'");
    expect(block).toContain('font-size: 30pt;');
  });

  it('beats the static stylesheet on specificity, or it would never show', () => {
    // screenplay.css styles `.title-page-title` with one class; the generated
    // rule must outrank it rather than merely come later in the cascade.
    const css = generateTemplateCss(INDUSTRY_STANDARD_TEMPLATE, DEFAULT_PAGE_LAYOUT, {
      titlePageOnly: true,
    });
    expect(css).toContain('.page .screenplay-element.title-page-title');
  });
});

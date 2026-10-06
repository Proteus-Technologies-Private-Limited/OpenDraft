import { describe, it, expect } from 'vitest';
import { generateTemplateCss } from './templateCss';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

/** The CSS block for one element class. */
function blockFor(css: string, cls: string): string {
  return css.split(`.screenplay-element.${cls} {`)[1]?.split('}')[0] ?? '';
}

function withAction(textColor: string, backgroundColor: string) {
  return {
    ...INDUSTRY_STANDARD_TEMPLATE,
    rules: {
      ...INDUSTRY_STANDARD_TEMPLATE.rules,
      action: { ...INDUSTRY_STANDARD_TEMPLATE.rules.action, textColor, backgroundColor },
    },
  };
}

describe('template colours on Dark Pages', () => {
  it('lets plain black text and white fill follow the page — on Dark Pages only', () => {
    const css = generateTemplateCss(withAction('#000000', '#ffffff'), DEFAULT_PAGE_LAYOUT);
    // Everywhere else the template's own colours, exactly as before.
    const block = blockFor(css, 'action');
    expect(block).toContain('color: #000000;');
    expect(block).toContain('background-color: #ffffff;');
    const dark = css.split(':root[data-dark-pages="on"]:not([data-theme="light"]) .page .screenplay-element.action {')[1]?.split('}')[0] ?? '';
    expect(dark).toContain('color: var(--page-ink);');
    expect(dark).toContain('background-color: var(--page-paper);');
  });

  it('never turns a deliberate grey black or white outside Dark Pages', () => {
    const css = generateTemplateCss(withAction('#333333', '#f0f0f0'), DEFAULT_PAGE_LAYOUT);
    const block = blockFor(css, 'action');
    expect(block).toContain('color: #333333;');
    expect(block).toContain('background-color: #f0f0f0;');
  });

  it('keeps a chosen colour exactly as chosen', () => {
    const css = generateTemplateCss(withAction('#c00000', '#fff3c4'), DEFAULT_PAGE_LAYOUT);
    const block = blockFor(css, 'action');
    expect(block).toContain('color: #c00000;');
    expect(block).toContain('background-color: #fff3c4;');
    expect(css).not.toContain('[data-dark-pages="on"]:not([data-theme="light"]) .page .screenplay-element.action {');
  });

  it('draws placeholders in the page placeholder ink', () => {
    const css = generateTemplateCss(INDUSTRY_STANDARD_TEMPLATE, DEFAULT_PAGE_LAYOUT);
    expect(css).not.toContain('color: #ccc;');
    expect(css).toContain('color: var(--page-ink-placeholder);');
  });
});

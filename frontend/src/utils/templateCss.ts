/**
 * Generates dynamic CSS from a FormattingTemplate.
 *
 * When a custom template is active, this CSS is injected into the <head>
 * to override the static rules in screenplay.css.
 */

import type { FormattingTemplate, FormattingElementRule } from '../stores/formattingTypes';
import { ELEMENT_CSS_CLASS } from '../stores/formattingTypes';
import type { PageLayout } from '../stores/editorStore';

const STYLE_ELEMENT_ID = 'opendraft-template-css';

/**
 * Generate a complete CSS string from a template and page layout.
 */
export function generateTemplateCss(
  template: FormattingTemplate,
  pageLayout: PageLayout,
): string {
  const lines: string[] = [];

  for (const [elementId, rule] of Object.entries(template.rules)) {
    if (!rule.enabled) continue;

    const selector = getSelector(elementId, rule);
    const props = generateRuleProperties(rule, pageLayout);
    if (props.length > 0) {
      lines.push(`${selector} {`);
      for (const prop of props) {
        lines.push(`  ${prop}`);
      }
      lines.push('}');
      lines.push('');
    }

    // First-child override: remove margin-top
    if (rule.marginTop > 0) {
      lines.push(`${selector}:first-child { margin-top: 0; }`);
      lines.push('');
    }

    // Placeholder
    if (rule.placeholder) {
      const placeholderSelector = getPlaceholderSelector(elementId, rule);
      const pStyles: string[] = [];
      pStyles.push(`content: '${escapeCssString(rule.placeholder)}';`);
      pStyles.push('color: #ccc;');
      pStyles.push('pointer-events: none;');
      pStyles.push('float: left;');
      pStyles.push('height: 0;');
      if (rule.textTransform === 'uppercase') pStyles.push('text-transform: uppercase;');
      if (rule.italic) pStyles.push('font-style: italic;');
      lines.push(`${placeholderSelector} {`);
      for (const s of pStyles) {
        lines.push(`  ${s}`);
      }
      lines.push('}');
      lines.push('');
    }
  }

  return lines.join('\n');
}

function getSelector(elementId: string, rule: FormattingElementRule): string {
  if (rule.isBuiltIn) {
    const cssClass = ELEMENT_CSS_CLASS[elementId];
    if (cssClass) {
      return `.page .screenplay-element.${cssClass}`;
    }
  }
  // Custom element
  return `.page .screenplay-element.custom-element[data-custom-type="${elementId}"]`;
}

function getPlaceholderSelector(elementId: string, rule: FormattingElementRule): string {
  if (rule.isBuiltIn) {
    const cssClass = ELEMENT_CSS_CLASS[elementId];
    // The data-type uses the CSS class name (hyphenated)
    return `div[data-type="${cssClass}"].is-empty::before`;
  }
  return `div[data-type="custom-element"][data-custom-type="${elementId}"].is-empty::before`;
}

function generateRuleProperties(
  rule: FormattingElementRule,
  pageLayout: PageLayout,
): string[] {
  const props: string[] = [];
  const pl = pageLayout.leftMargin;
  const pw = pageLayout.pageWidth;
  const prMargin = pageLayout.rightMargin;

  // Font family & size (null = use document default)
  if (rule.fontFamily) {
    props.push(`font-family: '${rule.fontFamily}', 'Courier Prime', 'Courier New', monospace;`);
  }
  if (rule.fontSize != null) {
    props.push(`font-size: ${rule.fontSize}pt;`);
  }

  // Text style
  props.push(`font-weight: ${rule.bold ? 'bold' : 'normal'};`);
  props.push(`font-style: ${rule.italic ? 'italic' : 'normal'};`);

  // Text decoration (combine underline and strikethrough)
  const decorations: string[] = [];
  if (rule.underline) decorations.push('underline');
  if (rule.strikethrough) decorations.push('line-through');
  props.push(`text-decoration: ${decorations.length > 0 ? decorations.join(' ') : 'none'};`);

  // Text transform
  props.push(`text-transform: ${rule.textTransform};`);

  // Alignment
  props.push(`text-align: ${rule.textAlign};`);

  // Margin
  if (rule.marginTop > 0) {
    props.push(`margin-top: ${rule.marginTop}pt;`);
  } else {
    props.push('margin-top: 0;');
  }

  // Indents — use calc() with CSS variables for responsive layout
  const leftPad = rule.leftIndent - pl;
  if (leftPad > 0.01) {
    props.push(`padding-left: calc(${rule.leftIndent}in - var(--pl, ${pl}in));`);
  } else {
    props.push('padding-left: 0;');
  }

  const rightPad = pw - rule.rightIndent - prMargin;
  if (rightPad > 0.01) {
    props.push(`padding-right: calc(var(--pw, ${pw}in) - ${rule.rightIndent}in - var(--pr, ${prMargin}in));`);
  } else {
    props.push('padding-right: 0;');
  }

  // Colors
  if (rule.textColor) {
    props.push(`color: ${rule.textColor};`);
  }
  if (rule.backgroundColor) {
    props.push(`background-color: ${rule.backgroundColor};`);
  }

  return props;
}

function escapeCssString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\A ');
}

/**
 * Inject or update the dynamic template CSS in the document head.
 * Call with null to remove the injected styles.
 */
export function injectTemplateCss(css: string | null): void {
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;

  if (css === null) {
    if (el) el.remove();
    return;
  }

  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }

  el.textContent = css;
}

/**
 * Utilities for resolving effective formatting state.
 *
 * In override mode, the toolbar needs to show the correct active state
 * by combining the template's CSS-level formatting with inline marks.
 */

import type { Editor } from '@tiptap/core';
import type { FormattingTemplate, FormattingElementRule } from '../stores/formattingTypes';

export interface EffectiveFormatting {
  isBold: boolean;
  isItalic: boolean;
  isUnderline: boolean;
  isStrikethrough: boolean;
  textAlign: string;
}

/**
 * Get the formatting rule for the current element under the cursor.
 */
export function getCurrentElementRule(
  editor: Editor,
  template: FormattingTemplate,
): FormattingElementRule | null {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  const nodeType = node.type.name;

  // For custom elements, look up by customTypeId attribute
  if (nodeType === 'customElement') {
    const customTypeId = node.attrs?.customTypeId;
    if (customTypeId && template.rules[customTypeId]) {
      return template.rules[customTypeId];
    }
    return null;
  }

  // For built-in elements
  if (template.rules[nodeType]) {
    return template.rules[nodeType];
  }

  return null;
}

/**
 * Get the effective bold/italic/underline/strike state considering both
 * the template rule (CSS-level) and inline marks.
 *
 * In enforce mode, the template rule IS the effective state.
 * In override mode, inline marks can toggle the template defaults.
 */
export function getEffectiveFormatting(
  editor: Editor,
  template: FormattingTemplate,
): EffectiveFormatting {
  const rule = getCurrentElementRule(editor, template);
  const isOverride = template.mode === 'override';

  // Base from template
  const templateBold = rule?.bold ?? false;
  const templateItalic = rule?.italic ?? false;
  const templateUnderline = rule?.underline ?? false;
  const templateStrike = rule?.strikethrough ?? false;
  const templateAlign = rule?.textAlign ?? 'left';

  if (!isOverride) {
    // Enforce mode: template + additive marks
    return {
      isBold: templateBold || editor.isActive('bold'),
      isItalic: templateItalic || editor.isActive('italic'),
      isUnderline: templateUnderline || editor.isActive('underline'),
      isStrikethrough: templateStrike || editor.isActive('strike'),
      textAlign: templateAlign,
    };
  }

  // Override mode: check for FormatOverride marks that negate template rules
  const overrideAttrs = editor.getAttributes('formatOverride');
  const hasBoldOverride = overrideAttrs?.fontWeight === 'normal';
  const hasItalicOverride = overrideAttrs?.fontStyle === 'normal';
  const hasUnderlineOverride = overrideAttrs?.textDecoration === 'none';

  // Effective = template XOR override
  let effectiveBold = templateBold;
  if (hasBoldOverride) effectiveBold = false;
  else if (editor.isActive('bold')) effectiveBold = true;

  let effectiveItalic = templateItalic;
  if (hasItalicOverride) effectiveItalic = false;
  else if (editor.isActive('italic')) effectiveItalic = true;

  let effectiveUnderline = templateUnderline;
  if (hasUnderlineOverride) effectiveUnderline = false;
  else if (editor.isActive('underline')) effectiveUnderline = true;

  let effectiveStrike = templateStrike;
  if (editor.isActive('strike')) effectiveStrike = !templateStrike;

  // Check node-level alignment override
  const nodeAlign = editor.getAttributes('textAlign')?.textAlign;
  const effectiveAlign = nodeAlign || templateAlign;

  return {
    isBold: effectiveBold,
    isItalic: effectiveItalic,
    isUnderline: effectiveUnderline,
    isStrikethrough: effectiveStrike,
    textAlign: effectiveAlign,
  };
}

/**
 * Toggle bold in override mode: if the template makes it bold, apply
 * FormatOverride to un-bold. If the template doesn't, use standard Bold mark.
 */
export function toggleBoldOverride(editor: Editor, rule: FormattingElementRule | null): void {
  if (rule?.bold) {
    // Template is bold — toggle override to remove it
    const attrs = editor.getAttributes('formatOverride');
    if (attrs?.fontWeight === 'normal') {
      editor.chain().focus().unsetMark('formatOverride').run();
    } else {
      editor.chain().focus().setMark('formatOverride', { fontWeight: 'normal' }).run();
    }
  } else {
    editor.chain().focus().toggleBold().run();
  }
}

export function toggleItalicOverride(editor: Editor, rule: FormattingElementRule | null): void {
  if (rule?.italic) {
    const attrs = editor.getAttributes('formatOverride');
    if (attrs?.fontStyle === 'normal') {
      editor.chain().focus().unsetMark('formatOverride').run();
    } else {
      editor.chain().focus().setMark('formatOverride', { fontStyle: 'normal' }).run();
    }
  } else {
    editor.chain().focus().toggleItalic().run();
  }
}

export function toggleUnderlineOverride(editor: Editor, rule: FormattingElementRule | null): void {
  if (rule?.underline) {
    const attrs = editor.getAttributes('formatOverride');
    if (attrs?.textDecoration === 'none') {
      editor.chain().focus().unsetMark('formatOverride').run();
    } else {
      editor.chain().focus().setMark('formatOverride', { textDecoration: 'none' }).run();
    }
  } else {
    editor.chain().focus().toggleUnderline().run();
  }
}

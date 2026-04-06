/**
 * FormatOverride mark — allows overriding CSS-applied formatting on selected text.
 *
 * Used in "override" mode templates to negate element-level CSS rules.
 * For example, if a scene heading is CSS-bold, applying FormatOverride with
 * fontWeight='normal' makes the selected text non-bold.
 */

import { Mark, mergeAttributes } from '@tiptap/core';

export interface FormatOverrideOptions {}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formatOverride: {
      setFormatOverride: (attrs: Record<string, string | null>) => ReturnType;
      unsetFormatOverride: () => ReturnType;
    };
  }
}

export const FormatOverride = Mark.create<FormatOverrideOptions>({
  name: 'formatOverride',

  addAttributes() {
    return {
      fontWeight: { default: null },
      fontStyle: { default: null },
      textDecoration: { default: null },
      textTransform: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-format-override]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const styles: string[] = [];
    if (HTMLAttributes.fontWeight) styles.push(`font-weight: ${HTMLAttributes.fontWeight}`);
    if (HTMLAttributes.fontStyle) styles.push(`font-style: ${HTMLAttributes.fontStyle}`);
    if (HTMLAttributes.textDecoration) styles.push(`text-decoration: ${HTMLAttributes.textDecoration}`);
    if (HTMLAttributes.textTransform) styles.push(`text-transform: ${HTMLAttributes.textTransform}`);

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-format-override': '',
        style: styles.join('; ') || undefined,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setFormatOverride:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetFormatOverride:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

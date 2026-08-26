import { Node, mergeAttributes } from '@tiptap/core';

/**
 * `section` — Fountain's outlining marker (`#`, `##`, `###`, …).
 *
 * A Section is structure, not script: it names a part of the story so it can be
 * found in an outline, and it never appears on the printed page. That is what
 * separates it from New Act and End of Act, which are act markers a reader is
 * meant to see. Both exist because Fountain has both, and conflating them was
 * how `# ACT ONE` ended up printed as a line of Action (issue #82).
 *
 * `level` is the number of hashes — 1 is the outermost. The hierarchy is
 * carried by the level alone, exactly as it is in the file, rather than by
 * nesting nodes: a Fountain document is free to jump from `#` straight to
 * `###`, and a tree would have to invent the missing rung to hold it.
 */
export const MAX_SECTION_LEVEL = 6;

/** Clamp any incoming depth to a level the schema and stylesheet can hold. */
export function clampSectionLevel(level: unknown): number {
  const n = typeof level === 'number' ? level : parseInt(String(level ?? ''), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SECTION_LEVEL, Math.max(1, Math.round(n)));
}

export const Section = Node.create({
  name: 'section',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (element) => clampSectionLevel(element.getAttribute('data-level')),
        renderHTML: (attributes) => ({ 'data-level': String(clampSectionLevel(attributes.level)) }),
      },
      /** Fountain synopsis (`=`) written under this section. Not printed. */
      synopsis: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="section"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const level = clampSectionLevel(node.attrs.level);
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'section',
        class: `screenplay-element section section-level-${level}`,
      }),
      0,
    ];
  },
});

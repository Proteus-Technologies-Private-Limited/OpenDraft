/**
 * TipTap's Color, plus a `data-ink="dark"` hint on text whose colour is
 * (near) black.
 *
 * Pasted text and the colour picker both leave explicit `color: #000000` on
 * runs. On white paper that is the same as no colour; on a dark page (View →
 * Theme → Dark Pages) it is black on near-black. The hint lets screenplay.css
 * hand such runs the page's ink instead. Only the rendered DOM changes — the
 * stored colour, and so every export, is exactly what the writer chose.
 */
import { Color } from '@tiptap/extension-color';
import { isNearBlack } from '../../utils/inkColor';

type AttrSpec = {
  renderHTML?: (attributes: Record<string, unknown>) => Record<string, unknown> | null;
  [k: string]: unknown;
};
type GlobalAttrs = Array<{ types: string[]; attributes: Record<string, AttrSpec> }>;

export const InkAwareColor = Color.extend({
  addGlobalAttributes() {
    const parent = (this.parent?.() ?? []) as GlobalAttrs;
    return parent.map((group) => {
      const spec = group.attributes.color;
      if (!spec?.renderHTML) return group;
      const base = spec.renderHTML;
      return {
        ...group,
        attributes: {
          ...group.attributes,
          color: {
            ...spec,
            renderHTML: (attributes: Record<string, unknown>) => {
              const out = base(attributes) ?? {};
              return typeof attributes.color === 'string' && isNearBlack(attributes.color)
                ? { ...out, 'data-ink': 'dark' }
                : out;
            },
          },
        },
      };
    });
  },
});

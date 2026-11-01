import type { Node as PmNode } from '@tiptap/pm/model';
export interface ParagraphLayout {
  leftIndentPt?: number | null;
  rightIndentPt?: number | null;
  spaceBeforePt?: number | null;
  spaceAfterPt?: number | null;
  lineSpacing?: number | null;
}
export const PARAGRAPH_LAYOUT_KEYS = [
  'leftIndentPt',
  'rightIndentPt',
  'spaceBeforePt',
  'spaceAfterPt',
  'lineSpacing',
] as const;
export function validParagraphLayout(value: unknown): value is ParagraphLayout | null {
  return (
    value === null ||
    (!!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, v]) =>
          PARAGRAPH_LAYOUT_KEYS.includes(key as (typeof PARAGRAPH_LAYOUT_KEYS)[number]) &&
          (v === null ||
            (typeof v === 'number' &&
              Number.isFinite(v) &&
              v >= 0 &&
              v <= (key === 'lineSpacing' ? 3 : 360) &&
              (key !== 'lineSpacing' || v >= 0.5))),
      ))
  );
}
export function paragraphLayoutOf(node: { attrs?: Record<string, unknown> }): ParagraphLayout {
  return validParagraphLayout(node.attrs?.paragraphLayout)
    ? ((node.attrs?.paragraphLayout as ParagraphLayout) ?? {})
    : {};
}

export function paragraphBounds(
  node: { attrs?: Record<string, unknown> },
  layout: { leftMargin: number; rightMargin: number; pageWidth: number },
  fallback: readonly number[],
): [number, number] {
  const p = paragraphLayoutOf(node);
  return [
    p.leftIndentPt == null ? fallback[0] * 72 : layout.leftMargin * 72 + p.leftIndentPt,
    p.rightIndentPt == null
      ? fallback[1] * 72
      : layout.pageWidth * 72 - layout.rightMargin * 72 - p.rightIndentPt,
  ];
}
export function paragraphColumns(
  node: { attrs?: Record<string, unknown> },
  layout: { leftMargin: number; rightMargin: number; pageWidth: number },
  fallback: readonly number[],
): number {
  const [l, r] = paragraphBounds(node, layout, fallback);
  return Math.max(1, Math.round(((r - l) * 10.33) / 72 / fontScaleOf(node)));
}

/** Conservative grid scale for enlarged inline text; unchanged 12pt scripts keep their grid. */
export function fontScaleOf(value: unknown): number {
  const node = value as {
    fontScale?: number;
    runs?: Array<{ fontSize?: number }>;
    descendants?: (fn: (n: PmNode) => boolean | void) => void;
    content?: unknown[];
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  };
  if (typeof node?.fontScale === 'number') return node.fontScale;
  let size = 12;
  if (node?.runs) for (const run of node.runs) size = Math.max(size, run.fontSize ?? 12);
  const read = (
    marks:
      | readonly { type: string | { name: string }; attrs?: Record<string, unknown> }[]
      | undefined,
  ) => {
    for (const mark of marks ?? []) {
      if ((typeof mark.type === 'string' ? mark.type : mark.type.name) !== 'textStyle') continue;
      const raw = String(mark.attrs?.fontSize ?? '');
      const n = parseFloat(raw) * (raw.endsWith('px') ? 0.75 : 1);
      if (Number.isFinite(n)) size = Math.max(size, n);
    }
  };
  if (node?.descendants)
    node.descendants((n) => {
      if (n.isText) read(n.marks);
    });
  else {
    read(node?.marks);
    for (const child of node?.content ?? []) size = Math.max(size, fontScaleOf(child) * 12);
  }
  return size / 12;
}

export function paragraphLineScale(node: unknown, requested = 1): number {
  const font = fontScaleOf(node);
  return Math.max(requested, font > 1 ? font : 0);
}

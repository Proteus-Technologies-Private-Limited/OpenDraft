/** Shared by character-sensitive features, including legacy WebViews. */
export const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Use the runtime's grapheme boundaries, or preserve Unicode code points. */
export function takeCharacters(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (!graphemeSegmenter) return Array.from(text).slice(0, limit).join('');
  let end = 0, count = 0;
  for (const { segment, index } of graphemeSegmenter.segment(text)) {
    end = index + segment.length;
    if (++count === limit) break;
  }
  return text.slice(0, end);
}

/**
 * A highlight pasted from anywhere but another ProseMirror.
 *
 * Tiptap's Highlight parses `<mark>` and nothing else, while Docs, Word Online
 * and every browser copy write `<span style="background-color: …">`. The mark
 * matched no rule, so a highlighted sentence arrived stripped of the one piece
 * of formatting the writer would notice missing.
 */
import { describe, it, expect } from 'vitest';
import { isHighlightColor } from './extensions/PastedHighlight';

describe('isHighlightColor', () => {
  it.each(['#ffe599', 'rgb(255, 229, 153)', 'yellow', 'rgba(255, 229, 153, 0.5)'])(
    'treats %s as a highlight',
    (color) => expect(isHighlightColor(color)).toBe(true),
  );

  it.each(['transparent', 'none', '#fff', '#FFFFFF', 'white', 'rgb(255, 255, 255)'])(
    'does not take %s for a highlight',
    // Web pages set a white or transparent background on layout wrappers
    // constantly; taking those would highlight whole pasted paragraphs.
    (color) => expect(isHighlightColor(color)).toBe(false),
  );

  it('does not take a fully transparent colour for a highlight', () => {
    expect(isHighlightColor('rgba(255, 229, 153, 0)')).toBe(false);
    expect(isHighlightColor('rgba(0,0,0,0)')).toBe(false);
  });

  it('ignores surrounding whitespace and case', () => {
    expect(isHighlightColor('  TRANSPARENT ')).toBe(false);
    expect(isHighlightColor('  #FFE599 ')).toBe(true);
  });

  it('does not take an empty declaration for a highlight', () => {
    expect(isHighlightColor('')).toBe(false);
    expect(isHighlightColor('   ')).toBe(false);
  });
});

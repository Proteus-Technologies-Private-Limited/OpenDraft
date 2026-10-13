/**
 * Black and white Final Draft files.
 *
 * Works on the finished FDX text, after the settings kept from the original
 * file have been merged back in, so no path that carries a colour can be
 * missed: the text itself, each element's font settings, the page, and the
 * character highlighting. Only the paint changes. Fonts, sizes, styles and the
 * script's own words are left exactly as they were.
 */

const BLACK = '#000000000000';
const WHITE = '#FFFFFFFFFFFF';

/** Set one attribute on one tag, only where the tag already has it. */
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(String.raw`(\s${name}=")[^"]*(")`);
  return re.test(tag) ? tag.replace(re, `$1${value}$2`) : tag;
}

export function toBlackAndWhiteFdx(xml: string): string {
  // Text runs and each element's font settings: ink black, paper white.
  let out = xml.replace(/<(?:FontSpec|Text)\b[^>]*>/g, (tag) =>
    setAttr(setAttr(tag, 'Color', BLACK), 'Background', WHITE));

  // The page itself.
  out = out.replace(/<PageLayout\b[^>]*>/g, (tag) =>
    setAttr(setAttr(tag, 'ForegroundColor', BLACK), 'BackgroundColor', WHITE));

  // Character highlighting paints names in colour, so it is switched off.
  out = out.replace(/<CharacterHighlighting>[\s\S]*?<\/CharacterHighlighting>/g, (block) =>
    block.replace(/<Character\b[^>]*>/g, (tag) =>
      setAttr(setAttr(tag, 'Color', BLACK), 'Visible', 'No')));

  return out;
}

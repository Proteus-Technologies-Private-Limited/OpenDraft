/**
 * Pasting from another app used to bring that app's font with it — the report
 * was an iPad paste landing in a font that matched neither the source nor the
 * screenplay. These pin the HTML transform that drops it.
 */
import { describe, it, expect } from 'vitest';
import { stripPastedFonts } from './extensions/PasteFormatting';

describe('stripPastedFonts', () => {
  it('drops font-family and font-size from external HTML', () => {
    const html = '<span style="font-family: -apple-system; font-size: 17px;">Hello</span>';
    expect(stripPastedFonts(html)).toBe('<span>Hello</span>');
  });

  it('keeps the declarations that carry meaning', () => {
    const html = '<span style="font-family: Helvetica; font-weight: bold; color: rgb(255, 0, 0)">Hi</span>';
    expect(stripPastedFonts(html)).toBe('<span style="font-weight: bold; color: rgb(255, 0, 0)">Hi</span>');
  });

  it('keeps the emphasis inside a font shorthand it removes', () => {
    const html = "<p style=\"font: bold italic 12.0px '.SFUI-Regular'\">Hi</p>";
    expect(stripPastedFonts(html)).toBe('<p style="font-weight: bold;font-style: italic">Hi</p>');
  });

  it('drops face and size from a legacy font element', () => {
    const html = '<font face="Arial" size="4" color="#333">Hi</font>';
    expect(stripPastedFonts(html)).toBe('<font color="#333">Hi</font>');
  });

  it('leaves single-quoted style attributes valid', () => {
    const html = "<span style='font-size: 17px; color: red'>Hi</span>";
    expect(stripPastedFonts(html)).toBe("<span style='color: red'>Hi</span>");
  });

  it('leaves a copy made inside the editor untouched', () => {
    const html = '<div data-pm-slice="1 1 []"><p style="font-family: Courier Prime">Hi</p></div>';
    expect(stripPastedFonts(html)).toBe(html);
  });

  it('leaves HTML with no styling alone', () => {
    const html = '<p>Plain <strong>and bold</strong></p>';
    expect(stripPastedFonts(html)).toBe(html);
  });
});

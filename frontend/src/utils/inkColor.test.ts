import { describe, it, expect } from 'vitest';
import { isNearBlack, isNearWhite, pageInk, pagePaper, parseCssColor } from './inkColor';

describe('parseCssColor', () => {
  it.each([
    ['#000', [0, 0, 0]],
    ['#000000', [0, 0, 0]],
    ['#000000ff', [0, 0, 0]],
    ['#FfF', [255, 255, 255]],
    ['rgb(0, 0, 0)', [0, 0, 0]],
    ['rgba(10,20,30,0.5)', [10, 20, 30]],
    ['rgb(10 20 30 / 50%)', [10, 20, 30]],
    ['black', [0, 0, 0]],
    [' white ', [255, 255, 255]],
  ])('%s', (css, rgb) => {
    expect(parseCssColor(css)).toEqual(rgb);
  });

  it('gives up on what it does not understand', () => {
    expect(parseCssColor('var(--x)')).toBeNull();
    expect(parseCssColor('hsl(0 0% 0%)')).toBeNull();
    expect(parseCssColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseCssColor('#12')).toBeNull();
  });
});

describe('near-black / near-white', () => {
  it('treats plain blacks and dark greys as ink', () => {
    for (const c of ['#000000', '#111', '#222222', '#333', 'rgb(0, 0, 0)', 'black']) {
      expect(isNearBlack(c)).toBe(true);
    }
  });

  it('leaves real colours alone, even dark ones', () => {
    for (const c of ['#1d4ed8', '#7c2d12', '#c00000', '#555555', '#ffffff', '#10104a']) {
      expect(isNearBlack(c)).toBe(false);
    }
  });

  it('treats white and near-white as paper', () => {
    expect(isNearWhite('#fff')).toBe(true);
    expect(isNearWhite('#f2f2f2')).toBe(true);
    expect(isNearWhite('#fde68a')).toBe(false); // a highlight, not paper
    expect(isNearWhite('#fff3c4')).toBe(false); // a pale tint is still a choice
  });

  it('handles empty input', () => {
    expect(isNearBlack(null)).toBe(false);
    expect(isNearWhite('')).toBe(false);
  });
});

describe('pageInk / pagePaper', () => {
  it('maps plain black/white to the page tokens and keeps everything else', () => {
    expect(pageInk('#000000')).toBe('var(--page-ink)');
    expect(pageInk('#c00000')).toBe('#c00000');
    expect(pagePaper('#ffffff')).toBe('var(--page-paper)');
    expect(pagePaper('#fff3c4')).toBe('#fff3c4');
  });
});

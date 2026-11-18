import { describe, expect, it } from 'vitest';
import {
  canShowNoHeading,
  defaultToolbarLayout,
  effectiveLabel,
  effectiveSide,
  normaliseSavedToolbarLayouts,
  normaliseToolbarLayout,
  placeToolbarItem,
  removeToolbarItem,
  setToolbarItemOptions,
  shiftToolbarItem,
  splitBySide,
} from './toolbarLayout';
import './workspaceLayout'; // registers the panel ids `panel:` items may name

describe('toolbar layout', () => {
  it('keeps today’s bars as the default: zoom at the end of both', () => {
    const layout = defaultToolbarLayout();
    expect(layout.bars.top).toEqual(['undo-redo', 'element', 'font', 'font-size', 'format', 'align', 'search', 'notes', 'zoom']);
    expect(layout.bars.bottom).toEqual(['status-zoom']);
    expect(splitBySide(layout.bars.bottom, layout.options).end).toEqual(['status-zoom']);
    expect(splitBySide(layout.bars.top, layout.options).end).toEqual(['zoom']);
  });

  it('offers No heading only to drop-downs that show their value', () => {
    expect(canShowNoHeading('font')).toBe(true);
    expect(canShowNoHeading('font-size')).toBe(true);
    expect(canShowNoHeading('element')).toBe(true);
    expect(canShowNoHeading('layout')).toBe(true);
    expect(canShowNoHeading('layout', { layoutStyle: 'buttons' })).toBe(false);
    for (const id of ['undo-redo', 'format', 'align', 'zoom', 'status-zoom', 'views', 'navigator', 'panel:scenes']) {
      expect(canShowNoHeading(id)).toBe(false);
    }
  });

  it('gives Font and Font Size no heading by default, and buttons the bar’s default', () => {
    const layout = defaultToolbarLayout();
    expect(effectiveLabel('font', 'top', layout)).toBe('none');
    expect(effectiveLabel('font-size', 'top', layout)).toBe('none');
    expect(effectiveLabel('search', 'top', layout)).toBe('icon');
    expect(effectiveLabel('search', 'bottom', layout)).toBe('text');
  });

  it('falls back to the bar default when No heading is saved for a button', () => {
    const layout = setToolbarItemOptions(defaultToolbarLayout(), 'zoom', { label: 'none' });
    expect(effectiveLabel('zoom', 'top', layout)).toBe('icon');
  });

  it('moves a control to the footer, keeping it on one bar only', () => {
    const next = placeToolbarItem(defaultToolbarLayout(), 'zoom', 'bottom');
    expect(next.bars.top).not.toContain('zoom');
    expect(next.bars.bottom).toEqual(['status-zoom', 'zoom']);
  });

  it('drops a control before another and takes that control’s side', () => {
    const layout = placeToolbarItem(defaultToolbarLayout(), 'theme', 'top', { before: 'zoom' });
    expect(effectiveSide('theme', layout.options)).toBe('end');
    expect(splitBySide(layout.bars.top, layout.options).end).toEqual(['theme', 'zoom']);
    const toStart = placeToolbarItem(layout, 'zoom', 'top', { before: 'search' });
    expect(effectiveSide('zoom', toStart.options)).toBe('start');
    const start = splitBySide(toStart.bars.top, toStart.options).start;
    expect(start.indexOf('zoom')).toBe(start.indexOf('search') - 1);
  });

  it('adds a control at the end of the side it is dropped on', () => {
    const layout = placeToolbarItem(defaultToolbarLayout(), 'navigator', 'top', { side: 'start' });
    const { start } = splitBySide(layout.bars.top, layout.options);
    expect(start[start.length - 1]).toBe('navigator');
    const end = placeToolbarItem(layout, 'layout', 'top');
    expect(splitBySide(end.bars.top, end.options).end).toEqual(['zoom', 'layout']);
  });

  it('shifts a control within its own side only', () => {
    const layout = defaultToolbarLayout();
    const moved = shiftToolbarItem(layout, 'notes', -1);
    expect(moved.bars.top.indexOf('notes')).toBe(layout.bars.top.indexOf('search'));
    // zoom is alone on the end side: nowhere to go.
    expect(shiftToolbarItem(layout, 'zoom', -1)).toBe(layout);
  });

  it('never empties the toolbar', () => {
    let layout = defaultToolbarLayout();
    for (const id of [...layout.bars.top]) layout = removeToolbarItem(layout, id);
    expect(layout.bars.top.length).toBe(1);
  });

  it('reads PR #217’s saved single list and drops unknown ids', () => {
    const layout = normaliseToolbarLayout(undefined, ['undo-redo', 'nope', 'views', 'views', 'plugin:acme']);
    expect(layout.bars.top).toEqual(['undo-redo', 'views', 'plugin:acme']);
  });

  it('falls back to the default for garbage', () => {
    expect(normaliseToolbarLayout('x')).toEqual(defaultToolbarLayout());
    expect(normaliseToolbarLayout({ bars: { top: ['nope'] } })).toEqual(defaultToolbarLayout());
  });

  it('keeps a control on one bar when a saved layout lists it on both', () => {
    const layout = normaliseToolbarLayout({ bars: { top: ['zoom', 'search'], bottom: ['zoom', 'layout'] } });
    expect(layout.bars).toEqual({ top: ['zoom', 'search'], bottom: ['layout'] });
  });

  it('cleans saved options and named layouts', () => {
    const layout = normaliseToolbarLayout({
      bars: { top: ['zoom'] },
      options: { zoom: { zoomStyle: 'slider', label: 'bad', side: 'end' }, nope: { side: 'start' } },
      labels: { top: 'both', bottom: 'none' },
    });
    expect(layout.options).toEqual({ zoom: { zoomStyle: 'slider', side: 'end' } });
    expect(layout.labels).toEqual({ top: 'both', bottom: 'text' });
    const saved = normaliseSavedToolbarLayouts([
      { id: 'a', label: '  Mine ', bars: { top: ['search'], bottom: ['zoom'] } },
      { id: 'a', label: 'dup', bars: { top: ['search'] } },
      { id: 'b', label: 'Old', items: ['notes'] },
      { id: 'c', label: '' },
    ]);
    expect(saved.map((s) => [s.id, s.label, s.bars.top])).toEqual([['a', 'Mine', ['search']], ['b', 'Old', ['notes']]]);
  });

  it('accepts panel buttons only for panels the workspace knows', () => {
    const layout = normaliseToolbarLayout({ bars: { top: ['panel:scenes', 'panel:nope'] } });
    expect(layout.bars.top).toEqual(['panel:scenes']);
  });
});

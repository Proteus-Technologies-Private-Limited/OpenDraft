import { describe, expect, it } from 'vitest';
import {
  canShowNoHeading,
  defaultToolbarLayout,
  effectiveLabel,
  effectiveSide,
  effectiveZoomStyle,
  normaliseSavedToolbarLayouts,
  normaliseToolbarLayout,
  placeToolbarItem,
  removeToolbarItem,
  setToolbarItemOptions,
  shiftToolbarItem,
  splitBySide,
  STATUS_ITEM_IDS,
  TOOLBAR_LAYOUT_VERSION,
} from './toolbarLayout';
import './workspaceLayout'; // registers the panel ids `panel:` items may name

/** The default layout with the one zoom moved up to the toolbar's end. */
const withZoomOnTop = () => placeToolbarItem(defaultToolbarLayout(), 'zoom', 'top');

describe('toolbar layout', () => {
  it('keeps today’s bars as the default: the status lines where they were, the one zoom at the footer’s end', () => {
    const layout = defaultToolbarLayout();
    expect(layout.bars.top).toEqual(['undo-redo', 'element', 'font', 'font-size', 'format', 'align', 'search', 'notes']);
    expect(layout.bars.bottom).toEqual([...STATUS_ITEM_IDS, 'zoom']);
    expect(splitBySide(layout.bars.bottom, layout.options)).toEqual({
      start: ['status-title', 'status-save'],
      center: ['status-element'],
      end: ['status-acts', 'status-runtime', 'status-words', 'status-revision', 'status-progress', 'status-page', 'zoom'],
    });
    expect(splitBySide(layout.bars.top, layout.options).end).toEqual([]);
  });

  it('merges the two zoom controls of an older layout into one, keeping the footer’s', () => {
    const layout = normaliseToolbarLayout({
      version: 2,
      bars: { top: ['undo-redo', 'zoom'], bottom: ['status-page', 'status-zoom'] },
      options: { zoom: { zoomStyle: 'slider' }, 'status-zoom': { label: 'text' } },
    });
    expect(layout.bars.top).toEqual(['undo-redo']);
    expect(layout.bars.bottom).toEqual(['status-page', 'zoom']);
    // The footer zoom's settings come with it; the toolbar's go.
    expect(layout.options).toEqual({ zoom: { label: 'text' } });
    // One zoom only: nothing to merge.
    const toolbarOnly = normaliseToolbarLayout({ version: 2, bars: { top: ['zoom'], bottom: ['status-page'] }, options: { zoom: { zoomStyle: 'slider' } } });
    expect(toolbarOnly.bars).toEqual({ top: ['zoom'], bottom: ['status-page'] });
    expect(toolbarOnly.options).toEqual({ zoom: { zoomStyle: 'slider' } });
    const footerOnly = normaliseToolbarLayout({ version: 2, bars: { top: ['search'], bottom: ['status-zoom'] } });
    expect(footerOnly.bars).toEqual({ top: ['search'], bottom: ['zoom'] });
  });

  it('draws the zoom as the writer chose, or as each bar always had it', () => {
    expect(effectiveZoomStyle('top')).toBe('buttons');
    expect(effectiveZoomStyle('bottom')).toBe('both');
    expect(effectiveZoomStyle('bottom', { zoomStyle: 'buttons' })).toBe('buttons');
    expect(effectiveZoomStyle('top', { zoomStyle: 'slider' })).toBe('slider');
  });

  it('gives a footer saved before the status lines were items the lines where they always were', () => {
    const layout = normaliseToolbarLayout({
      bars: { top: ['undo-redo'], bottom: ['navigator', 'status-zoom', 'theme'] },
      options: { navigator: { side: 'start' } },
    });
    expect(layout.version).toBe(TOOLBAR_LAYOUT_VERSION);
    const sides = splitBySide(layout.bars.bottom, layout.options);
    // The writer's start-side controls came before the title; end-side ones after the page.
    expect(sides.start).toEqual(['navigator', 'status-title', 'status-save']);
    expect(sides.center).toEqual(['status-element']);
    expect(sides.end.slice(-3)).toEqual(['status-page', 'zoom', 'theme']);
  });

  it('leaves status lines the writer took off the footer off', () => {
    const layout = normaliseToolbarLayout({
      version: TOOLBAR_LAYOUT_VERSION,
      bars: { top: ['undo-redo'], bottom: ['status-page'] },
    });
    expect(layout.bars.bottom).toEqual(['status-page']);
    expect(normaliseToolbarLayout(layout)).toEqual(layout);
  });

  it('keeps status lines off the toolbar', () => {
    const layout = defaultToolbarLayout();
    expect(placeToolbarItem(layout, 'status-words', 'top')).toBe(layout);
    const saved = normaliseToolbarLayout({ version: TOOLBAR_LAYOUT_VERSION, bars: { top: ['search', 'status-page'], bottom: [] } });
    expect(saved.bars.top).toEqual(['search']);
  });

  it('moves a control to the centre of either bar', () => {
    const footer = placeToolbarItem(defaultToolbarLayout(), 'status-words', 'bottom', { side: 'center' });
    expect(splitBySide(footer.bars.bottom, footer.options).center).toEqual(['status-element', 'status-words']);
    const toolbar = placeToolbarItem(footer, 'theme', 'top', { side: 'center' });
    expect(splitBySide(toolbar.bars.top, toolbar.options).center).toEqual(['theme']);
    expect(normaliseToolbarLayout(toolbar).options.theme).toEqual({ side: 'center' });
  });

  it('shows status lines as their text', () => {
    expect(effectiveLabel('status-page', 'bottom', { options: { 'status-page': { label: 'icon' } }, labels: { top: 'icon', bottom: 'icon' } })).toBe('text');
  });

  it('offers No heading only to drop-downs that show their value', () => {
    expect(canShowNoHeading('font')).toBe(true);
    expect(canShowNoHeading('font-size')).toBe(true);
    expect(canShowNoHeading('element')).toBe(true);
    expect(canShowNoHeading('layout')).toBe(true);
    expect(canShowNoHeading('layout', { layoutStyle: 'buttons' })).toBe(false);
    for (const id of ['undo-redo', 'format', 'align', 'zoom', 'views', 'navigator', 'panel:scenes']) {
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
    const next = placeToolbarItem(withZoomOnTop(), 'zoom', 'bottom');
    expect(next.bars.top).not.toContain('zoom');
    expect(next.bars.bottom).toEqual([...STATUS_ITEM_IDS, 'zoom']);
    const up = withZoomOnTop();
    expect(up.bars.bottom).not.toContain('zoom');
    expect(splitBySide(up.bars.top, up.options).end).toEqual(['zoom']);
  });

  it('drops a control before another and takes that control’s side', () => {
    const layout = placeToolbarItem(withZoomOnTop(), 'theme', 'top', { before: 'zoom' });
    expect(effectiveSide('theme', layout.options)).toBe('end');
    expect(splitBySide(layout.bars.top, layout.options).end).toEqual(['theme', 'zoom']);
    const toStart = placeToolbarItem(layout, 'zoom', 'top', { before: 'search' });
    expect(effectiveSide('zoom', toStart.options)).toBe('start');
    const start = splitBySide(toStart.bars.top, toStart.options).start;
    expect(start.indexOf('zoom')).toBe(start.indexOf('search') - 1);
  });

  it('adds a control at the end of the side it is dropped on', () => {
    const layout = placeToolbarItem(withZoomOnTop(), 'navigator', 'top', { side: 'start' });
    const { start } = splitBySide(layout.bars.top, layout.options);
    expect(start[start.length - 1]).toBe('navigator');
    const end = placeToolbarItem(layout, 'layout', 'top');
    expect(splitBySide(end.bars.top, end.options).end).toEqual(['zoom', 'layout']);
  });

  it('shifts a control within its own side only', () => {
    const layout = withZoomOnTop();
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
    const layout = normaliseToolbarLayout({ version: TOOLBAR_LAYOUT_VERSION, bars: { top: ['zoom', 'search'], bottom: ['zoom', 'layout'] } });
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

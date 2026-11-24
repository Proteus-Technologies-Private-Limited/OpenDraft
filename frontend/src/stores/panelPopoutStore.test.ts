import { describe, expect, it } from 'vitest';
import { withPanelIn, withoutPanel, type PanelWindowEntry } from './panelPopoutStore';

/** The grouping rules. Opening and closing the real windows is covered by the
 * browser test (test-script/panel-popout/regressions.py). */
const entry = (panels: string[], active = panels[0]): PanelWindowEntry => ({
  window: {} as Window, root: {} as HTMLElement, panels, active, boundsKey: panels[0],
});

describe('grouping panels into windows', () => {
  it('adds a panel to a window as its last tab, showing', () => {
    const r = withPanelIn({ a: entry(['scenes']) }, { scenes: 'a' }, 'notes', 'a');
    expect(r.windows.a).toMatchObject({ panels: ['scenes', 'notes'], active: 'notes' });
    expect(r.placed).toEqual({ scenes: 'a', notes: 'a' });
    expect(r.emptied).toBeNull();
  });

  it('moving a panel already there only shows it', () => {
    const r = withPanelIn({ a: entry(['scenes', 'notes'], 'notes') }, { scenes: 'a', notes: 'a' }, 'scenes', 'a');
    expect(r.windows.a).toMatchObject({ panels: ['scenes', 'notes'], active: 'scenes' });
  });

  it('a window left empty by a move is reported, to be closed', () => {
    const windows = { a: entry(['scenes']), b: entry(['notes']) };
    const r = withPanelIn(windows, { scenes: 'a', notes: 'b' }, 'notes', 'a');
    expect(r.emptied).toBe('b');
    expect(r.windows.a.panels).toEqual(['scenes', 'notes']);
    expect(r.placed).toEqual({ scenes: 'a', notes: 'a' });
  });

  it('a panel taken out of a shared window leaves the rest, showing its neighbour', () => {
    const windows = { a: entry(['scenes', 'notes', 'tags'], 'notes') };
    const placed = { scenes: 'a', notes: 'a', tags: 'a' };
    const r = withoutPanel(windows, placed, 'notes');
    expect(r.windows.a).toMatchObject({ panels: ['scenes', 'tags'], active: 'scenes' });
    expect(r.placed).toEqual({ scenes: 'a', tags: 'a' });
    expect(r.emptied).toBeNull();
    // A tab not showing leaves the one showing alone.
    expect(withoutPanel(windows, placed, 'tags').windows.a.active).toBe('notes');
    // The first tab passes the window to the next.
    expect(withoutPanel({ a: entry(['scenes', 'notes']) }, { scenes: 'a', notes: 'a' }, 'scenes').windows.a.active).toBe('notes');
  });

  it('the last panel out empties its window', () => {
    const r = withoutPanel({ a: entry(['scenes']) }, { scenes: 'a' }, 'scenes');
    expect(r.emptied).toBe('a');
    expect(r.placed).toEqual({});
  });

  it('a panel in no window changes nothing', () => {
    const windows = { a: entry(['scenes']) };
    const placed = { scenes: 'a' };
    const r = withoutPanel(windows, placed, 'notes');
    expect(r.windows).toBe(windows);
    expect(r.placed).toBe(placed);
    expect(withPanelIn(windows, placed, 'notes', 'missing').windows).toBe(windows);
  });
});

/**
 * Which plugin panel a `plugin-panel:close` request closes: the sidebar's or
 * the bottom panel's, by id, or — without one — by where focus is.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { pluginRegistry } from '../plugins/registry';
import { BOTTOM_PANEL_CONTENT_SELECTOR, isCloseRequestFor } from '../plugins/panelClose';

/** A focused element, as far as `closest` is concerned. */
const focusedIn = (...containers: string[]) => ({
  closest: (selector: string) => (containers.includes(selector) ? {} : null),
});
const Panel = () => createElement('div');

afterEach(() => {
  pluginRegistry.unregister('close-test');
});

describe('plugin panel close requests', () => {
  it('without an id, from inside a bottom panel, closes only the bottom panel', () => {
    const focused = focusedIn(BOTTOM_PANEL_CONTENT_SELECTOR);
    expect(isCloseRequestFor('bottom-panel', undefined, focused)).toBe(true);
    expect(isCloseRequestFor('right-sidebar', undefined, focused)).toBe(false);
  });

  it('without an id, from inside the sidebar, closes only the sidebar', () => {
    const focused = focusedIn('.plugin-panel-tabs__content');
    expect(isCloseRequestFor('right-sidebar', undefined, focused)).toBe(true);
    expect(isCloseRequestFor('bottom-panel', undefined, focused)).toBe(false);
  });

  it('without an id and with focus elsewhere, closes the sidebar as it always has', () => {
    expect(isCloseRequestFor('right-sidebar', undefined, null)).toBe(true);
    expect(isCloseRequestFor('bottom-panel', undefined, null)).toBe(false);
  });

  it('with an id, closes the panel of the slot that owns it, wherever focus is', () => {
    pluginRegistry.register({
      id: 'close-test', name: 'Close test', version: '1.0.0',
      panels: [
        { id: 'log', slot: 'bottom-panel', label: 'Log', component: Panel },
        { id: 'side', slot: 'right-sidebar', label: 'Side', component: Panel },
      ],
    });
    const focused = focusedIn(BOTTOM_PANEL_CONTENT_SELECTOR);
    expect(isCloseRequestFor('right-sidebar', 'side', focused)).toBe(true);
    expect(isCloseRequestFor('bottom-panel', 'side', focused)).toBe(false);
    expect(isCloseRequestFor('bottom-panel', 'log', null)).toBe(true);
    expect(isCloseRequestFor('right-sidebar', 'log', null)).toBe(false);
  });
});

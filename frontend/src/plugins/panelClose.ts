/**
 * Which plugin panel slot a `plugin-panel:close` request is meant for. Kept
 * out of the panel components so they export only components.
 */

import { pluginRegistry } from './registry';

/** The open bottom panel's content; see PluginBottomPanels. */
export const BOTTOM_PANEL_CONTENT_SELECTOR = '.plugin-bottom-panels__content';

/**
 * Whether a `plugin-panel:close` request is meant for `slot`'s open panel.
 *
 * With a `panelId`, it is when that id is one of the slot's panels. Without
 * one, the request is a panel closing itself, so focus says whose it is: a
 * bottom panel closes only when focus is inside it, and the sidebar closes
 * unless focus is inside a bottom panel (an id-less close from a sidebar panel
 * after focus has moved on still closes it, as it always has).
 */
export function isCloseRequestFor(
  slot: 'right-sidebar' | 'bottom-panel',
  panelId: string | undefined,
  focused: { closest(selector: string): unknown } | null | undefined,
): boolean {
  if (panelId) {
    try {
      return pluginRegistry.getPanels(slot).some((p) => p.id === panelId);
    } catch (err) {
      console.error(`[plugins] could not read the ${slot} panels`, err);
      return false;
    }
  }
  const inBottomPanel = !!focused?.closest(BOTTOM_PANEL_CONTENT_SELECTOR);
  return slot === 'bottom-panel' ? inBottomPanel : !inBottomPanel;
}

import { createContext } from 'react';

/** Where a panel is drawn: in a dock (it can pop out), in a panel window (it
 * can go back, or move to another window), or anywhere else — phones, the
 * fold layout, history — where it has no pop-out button. See PanelPopout.tsx. */
export type PanelPlace = { where: 'none' } | { where: 'dock' } | { where: 'window'; windowId: string };

export const PanelPlaceContext = createContext<PanelPlace>({ where: 'none' });

export function panelWindowTitle(panel: string, script: string): string {
  return script.trim() ? `${panel} — ${script}` : panel;
}

/** A window named by its panels, for "Add to the … window". */
export function panelWindowName(panels: string[], label: (panel: string) => string): string {
  return panels.map(label).join(', ');
}

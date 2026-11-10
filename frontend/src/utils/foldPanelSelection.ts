export interface PanelActivation {
  id: string;
  open: boolean;
  activationKey?: string | number;
}
export interface FoldPanelSelection {
  selected: string;
  opened: ReadonlyMap<string, string | number | null>;
}

/** A fresh open request wins; otherwise retain the writer's selected tab. */
export function reconcileFoldPanels(previous: FoldPanelSelection, panels: readonly PanelActivation[]): FoldPanelSelection {
  const open = panels.filter(panel => panel.open);
  const opened = new Map(open.map(panel => [panel.id, panel.activationKey ?? null]));
  if (opened.size === previous.opened.size && open.every(panel => previous.opened.has(panel.id)
    && previous.opened.get(panel.id) === (panel.activationKey ?? null))) return previous;
  const activated = open.filter(panel => !previous.opened.has(panel.id)
    || previous.opened.get(panel.id) !== (panel.activationKey ?? null));
  return {
    opened,
    selected: activated.at(-1)?.id ?? (opened.has(previous.selected) ? previous.selected : open.at(-1)?.id ?? ''),
  };
}

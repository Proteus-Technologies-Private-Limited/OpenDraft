/**
 * What a toolbar panel button does on a click.
 *
 * The Notes and Tags buttons do two jobs: they toggle their panel, and they
 * act on the script (add a note or tag on the selection, or focus the one under
 * the caret). Closing must only win when the panel is open, nothing is
 * selected, and the caret is not on a mark — otherwise a second click would
 * swallow the add/focus action the writer clicked for.
 */
export type PanelButtonAction = 'close' | 'act';

export function panelButtonAction(
  panelOpen: boolean,
  selectionEmpty: boolean,
  onMark: boolean,
): PanelButtonAction {
  return panelOpen && selectionEmpty && !onMark ? 'close' : 'act';
}

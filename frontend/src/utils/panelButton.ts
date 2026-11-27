/**
 * What a toolbar panel button does on a click.
 *
 * The Tags button does two jobs: it toggles its panel, and it
 * acts on the script (adds a tag on the selection, or focuses the one under
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

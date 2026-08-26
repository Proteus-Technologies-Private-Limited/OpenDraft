/**
 * Asking for the handwriting sheet, from anywhere.
 *
 * A window event rather than a prop, because the two places that offer it — the
 * Edit menu and the touch context menu — are neither of them parents of the
 * editor that owns the sheet. It follows the pattern `opendraft:auth-required`
 * already set.
 *
 * Its own module rather than a second export from `ScribbleInput`: a file that
 * exports both a component and a constant loses fast refresh.
 */
export const HANDWRITING_EVENT = 'opendraft:handwriting';

/** Ask the editor to open the handwriting sheet at the current selection. */
export function requestHandwriting(): void {
  window.dispatchEvent(new CustomEvent(HANDWRITING_EVENT));
}

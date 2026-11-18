/**
 * Commands a bar sends to the menu bar (from PR #217).
 *
 * File actions and dialogs belong to MenuBar: it knows about unsaved changes,
 * file origins, the library, the export options and whether this window is a
 * collaboration guest. A toolbar button only sends a named request, and MenuBar
 * runs the same handler, with the same checks, as its menu item.
 */

export const APP_COMMAND_EVENT = 'opendraft:app-command';

export type AppCommand =
  | 'new-script'
  | 'import-script'
  | 'save-script'
  | 'export-pdf'
  | 'reports'
  | 'title-page';

export function requestAppCommand(command: AppCommand): void {
  window.dispatchEvent(new CustomEvent<AppCommand>(APP_COMMAND_EVENT, { detail: command }));
}

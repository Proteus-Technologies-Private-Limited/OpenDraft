/**
 * Commands the toolbar sends to the menu bar.
 *
 * File actions and dialogs are owned by MenuBar: it knows about unsaved
 * changes, file origins, the library and the export options. The toolbar only
 * sends a named request, and MenuBar runs the same handler as its menu item,
 * so there is one implementation of Save, Open, Export and Reports.
 */

export const APP_COMMAND_EVENT = 'opendraft:app-command';

export type AppCommand =
  | 'new-script'
  | 'open-script'
  | 'import-script'
  | 'save-script'
  | 'export-pdf'
  | 'reports';

export function requestAppCommand(command: AppCommand): void {
  window.dispatchEvent(new CustomEvent<AppCommand>(APP_COMMAND_EVENT, { detail: command }));
}

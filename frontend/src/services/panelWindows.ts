import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktopTauri } from './platform';
import { currentWindowLabel } from './openDocuments';
import type { NavigatorSnapshot, PanelMessage } from './panelProtocol';

export const canPopOutNavigator = (): boolean => isDesktopTauri() && !!currentWindowLabel()?.match(/^main(?:-\d+)?$/);
export const isPanelWindow = (): boolean => !!currentWindowLabel()?.startsWith('panel-');

/** Async listener setup must also clean up if its component unmounts first. */
export function subscribePanel<T>(event: string, receive: (payload: T) => void): () => void {
  let stopped = false;
  let unlisten: (() => void) | undefined;
  void listen<T>(event, e => { if (!stopped) receive(e.payload); }).then(stop => {
    if (stopped) stop(); else unlisten = stop;
  }).catch(error => console.warn('[panels] listener unavailable:', error));
  return () => { stopped = true; unlisten?.(); };
}

export const openNavigatorPanel = (session: string): Promise<string> => invoke('open_panel_window', { session });
export const closeNavigatorPanels = (session: string): Promise<void> => invoke('close_panel_windows', { session });
export const publishNavigator = (snapshot: NavigatorSnapshot): Promise<void> => invoke('publish_panel_snapshot', { session: snapshot.session, snapshot });
export const sendPanelAction = (action: PanelMessage['action'] | { kind: 'return' }): Promise<void> => invoke('panel_command', { action });
export const getPanelContext = (): Promise<{ owner: string; session: string }> => invoke('panel_context');

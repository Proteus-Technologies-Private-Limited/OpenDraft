import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktopTauri } from './platform';
import { currentWindowLabel } from './openDocuments';
import type { NavigatorSnapshot, PanelMessage } from './panelProtocol';

export const canPopOutNavigator = (): boolean => isDesktopTauri() && !!currentWindowLabel()?.match(/^main(?:-\d+)?$/);
export const isPanelWindow = (): boolean => !!currentWindowLabel()?.startsWith('panel-');

export type PanelSubscription = (() => void) & { ready: Promise<boolean> };

/** Await registration before the ready handshake; clean up even after unmount. */
export function subscribePanel<T>(event: string, receive: (payload: T) => void): PanelSubscription {
  let stopped = false;
  let unlisten: (() => void) | undefined;
  const ready = listen<T>(event, e => { if (!stopped) receive(e.payload); }).then(stop => {
    if (stopped) { stop(); return false; }
    unlisten = stop;
    return true;
  }).catch(error => { console.warn('[panels] listener unavailable:', error); return false; });
  return Object.assign(() => { stopped = true; unlisten?.(); }, { ready });
}

export const openNavigatorPanel = (session: string): Promise<string> => invoke('open_panel_window', { session });
export const closeNavigatorPanels = (session: string): Promise<void> => invoke('close_panel_windows', { session });
export const publishNavigator = (snapshot: NavigatorSnapshot): Promise<void> => invoke('publish_panel_snapshot', { session: snapshot.session, snapshot });
export const sendPanelAction = (action: PanelMessage['action'] | { kind: 'return' }): Promise<void> => invoke('panel_command', { action });
export const getPanelContext = (): Promise<{ owner: string; session: string }> => invoke('panel_context');

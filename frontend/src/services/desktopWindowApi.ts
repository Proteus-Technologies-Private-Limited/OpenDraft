/**
 * Tauri window queries that only work in the desktop app.
 *
 * On iOS, tao's MonitorHandle asserts that it is used on the main thread, but
 * Tauri answers `availableMonitors()` and its siblings on a worker thread. The
 * assert panics, the panic while dropping the handle aborts the process, and
 * the app closes. 2.16.0 shipped that to TestFlight: the panel windows asked
 * for the displays as soon as the editor opened, on every platform.
 *
 * So every monitor query goes through this module, which answers without
 * asking on phones and tablets (desktopWindowApi.test.ts fails the build if a
 * file calls one directly). The phone and tablet apps are also not granted
 * those commands (src-tauri/capabilities/desktop.json), so a call that slips
 * past this is refused with an error rather than taking the app down.
 */
import type { Monitor } from '@tauri-apps/api/window';
import { isMobileTauri, isTauri } from './platform';

/** True only in the desktop app, where monitor queries are safe. */
export function canQueryMonitors(): boolean {
  return isTauri() && !isMobileTauri();
}

/** The displays, in the desktop app; none anywhere else. */
export async function availableMonitorsOnDesktop(): Promise<Monitor[]> {
  if (!canQueryMonitors()) return [];
  const { availableMonitors } = await import('@tauri-apps/api/window');
  return availableMonitors();
}

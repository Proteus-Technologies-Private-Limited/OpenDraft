/**
 * Demo-mode flag. WriTea Draft has no hosted backend, so this never touches
 * the network: it is always "not demo". Kept as a module so the dialogs and
 * settings page that read it keep working unchanged.
 */

import type { DemoInfo } from './api';

const OFFLINE: DemoInfo = { demo: false, message: null };

export async function initDemoInfo(): Promise<DemoInfo> {
  return OFFLINE;
}

export function isDemoMode(): boolean {
  return false;
}

export function demoMessage(): string | null {
  return null;
}

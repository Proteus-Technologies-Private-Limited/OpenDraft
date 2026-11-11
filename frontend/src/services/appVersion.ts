import { version as buildVersion } from '../../../src-tauri/tauri.conf.json';
import { isTauri } from './platform';

let installedVersion: string | null = null;
let pending: Promise<string> | null = null;

/** Synchronous callers use the release config until the native version arrives. */
export function getAppVersion(): string {
  return installedVersion ?? buildVersion;
}

/** Respect native packaging overrides; browsers use the version bundled by Vite. */
export async function readAppVersion(): Promise<string> {
  if (!isTauri()) return buildVersion;
  if (installedVersion) return installedVersion;
  if (!pending) {
    pending = import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((version) => {
        if (typeof version === 'string' && version.trim()) installedVersion = version.trim();
        return getAppVersion();
      })
      .catch(() => getAppVersion())
      .finally(() => { pending = null; });
  }
  return pending;
}

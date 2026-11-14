/**
 * Diagnostics — collect runtime info that's useful when triaging bug reports.
 *
 * Surfaces storage backend, DB path, last storage error, OS, app version,
 * and OneDrive interference detection (Windows). Rendered by the Help →
 * Diagnostics dialog.
 */

import { getCompatEntries } from './compat';
import { useStorageStatusStore } from '../stores/storageStatusStore';
import { isDesktopTauri } from './platform';
import { readAppVersion } from './appVersion';
import { getLastFileFailure, formatFileFailure, type FileFailure } from './fileDiagnostics';
import { collectFoldDiagnostics, type FoldDiagnostics } from './foldDiagnostics';
export { getAppVersion } from './appVersion';

export interface DiagnosticsReport {
  appVersion: string;
  os: string;
  userAgent: string;
  storageMode: string;
  storageError: string | null;
  fileFailure: FileFailure | null;
  appDataDir: string | null;
  sqliteDbPath: string | null;
  oneDriveSuspect: boolean;
  compat: Array<{ label: string; mode: string; using: string; errorReason?: string }>;
  collectedAt: string;
  display: FoldDiagnostics | null;
}

/**
 * Best-effort OS string from the user-agent.
 *
 * iOS is checked before macOS: every iPhone and iPad user agent says
 * "like Mac OS X", so testing for macOS first reported every iOS device as
 * a Mac. iPadOS 13+ goes further and sends a desktop "Macintosh" user agent;
 * a real Mac has no touch points, which is how the two are told apart (the
 * same rule as getOS() in platform.ts). No version is given for iOS: WebKit
 * freezes the one in the user agent, so it would name the wrong release.
 */
export function detectOs(
  ua: string = (typeof navigator !== 'undefined' && navigator.userAgent) || '',
  maxTouchPoints: number = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0,
): string {
  if (/Windows NT 10\.0; Win64; x64/.test(ua)) return 'Windows 10/11 (x64)';
  if (/Windows NT 10\.0/.test(ua)) return 'Windows 10/11';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/iPhone|iPod/.test(ua)) return 'iOS';
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'iPadOS';
  if (/Mac OS X/.test(ua)) {
    const m = ua.match(/Mac OS X ([0-9_]+)/);
    return m ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
  }
  if (/Linux/.test(ua)) return 'Linux';
  return ua.slice(0, 200) || 'unknown';
}

/**
 * Heuristic check for OneDrive interference on Windows. Returns true if the
 * app data directory path suggests it's under a OneDrive-synced folder.
 *
 * SQLite WAL/journal files don't survive cloud sync — OneDrive can grab
 * the .db-wal mid-write, causing silent save failures. Worth flagging.
 */
export function isUnderOneDrive(path: string | null): boolean {
  if (!path) return false;
  // Common OneDrive path patterns on Windows:
  //   C:\Users\<name>\OneDrive\...
  //   C:\Users\<name>\OneDrive - <Org>\...
  return /[\\/]OneDrive([\\/ ]|$)/i.test(path);
}

/** Collect a snapshot of diagnostic info. Safe to call from web (returns reduced data). */
export async function collectDiagnostics(): Promise<DiagnosticsReport> {
  const status = useStorageStatusStore.getState();
  const os = detectOs();

  let appDataDir: string | null = null;
  let sqliteDbPath: string | null = null;
  if (isDesktopTauri()) {
    try {
      const path = await import('@tauri-apps/api/path');
      appDataDir = await path.appDataDir();
      sqliteDbPath = appDataDir ? `${appDataDir.replace(/[\\/]+$/, '')}/opendraft.db` : null;
    } catch (err) {
      appDataDir = `(unavailable: ${(err as Error).message || err})`;
    }
  }

  const oneDriveSuspect = /Windows/i.test(os) && isUnderOneDrive(appDataDir);

  return {
    appVersion: await readAppVersion(),
    os,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
    storageMode: status.mode,
    storageError: status.errorReason,
    fileFailure: getLastFileFailure(),
    appDataDir,
    sqliteDbPath,
    oneDriveSuspect,
    compat: getCompatEntries().map((e) => ({
      label: e.label,
      mode: e.mode,
      using: e.using,
      errorReason: e.errorReason,
    })),
    collectedAt: new Date().toISOString(),
    display: collectFoldDiagnostics(),
  };
}

/** Format a report as plain text suitable for pasting into a GitHub issue. */
export function formatReport(r: DiagnosticsReport): string {
  const lines: string[] = [];
  lines.push(`OpenDraft Diagnostics — ${r.collectedAt}`);
  lines.push(`Version: ${r.appVersion}`);
  lines.push(`OS: ${r.os}`);
  lines.push(`Storage backend: ${r.storageMode}`);
  if (r.storageError) lines.push(`Storage error: ${r.storageError}`);
  if (r.appDataDir) lines.push(`App data dir: ${r.appDataDir}`);
  if (r.sqliteDbPath) lines.push(`SQLite DB path: ${r.sqliteDbPath}`);
  if (r.fileFailure) {
    lines.push('', 'Last file failure (this session):', formatFileFailure(r.fileFailure));
  }
  if (r.oneDriveSuspect) {
    lines.push('');
    lines.push('⚠ OneDrive interference suspected — the app data directory appears to');
    lines.push('  be under a OneDrive-synced folder. OneDrive can corrupt SQLite WAL');
    lines.push('  files mid-write, causing silent save failures. Consider moving');
    lines.push('  C:\\Users\\<you>\\AppData out of OneDrive sync, or excluding the');
    lines.push('  OpenDraft data folder from OneDrive.');
  }
  lines.push('');
  lines.push('Compatibility:');
  for (const c of r.compat) {
    lines.push(`  - ${c.label}: ${c.mode} (${c.using})${c.errorReason ? ` — ${c.errorReason}` : ''}`);
  }
  lines.push('');
  if (r.display) {
    lines.push('Display and posture (browser snapshot):', JSON.stringify(r.display, null, 2), '');
  }
  lines.push(`User-Agent: ${r.userAgent}`);
  return lines.join('\n');
}

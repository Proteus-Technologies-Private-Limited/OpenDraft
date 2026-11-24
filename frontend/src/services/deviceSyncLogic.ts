/** The decisions in device-to-cloud sync that need no network or database, so
 * they can be tested on their own. See deviceProjectSync.ts for the I/O. */
import type { ScriptBase } from './deviceSyncStore';

/** A base that records a cloud acknowledgement. A row may instead be only a note
 * that an upload was started, or a tombstone. */
export function isRealBase(base: ScriptBase | undefined): base is ScriptBase {
  return !!base && !base.deleted && !!base.cloud_revision;
}

export type Presence =
  /** Carry on with this base (possibly none). `forget` also drops a stale row. */
  | { action: 'continue'; base: ScriptBase | undefined; forget?: boolean }
  /** Deleted on one side earlier and not propagated: nothing left to do. */
  | { action: 'settled' }
  /** Gone from both sides: drop what was remembered. */
  | { action: 'forget' }
  /** Newly deleted on one side. Remember it, and do not copy the deletion. */
  | { action: 'tombstone'; side: 'device' | 'cloud' };

/** What a screenplay's presence on each side means, given what was last synced. */
export function classifyPresence(base: ScriptBase | undefined, hasDevice: boolean, hasCloud: boolean): Presence {
  if (!base) return { action: 'continue', base };
  if (!hasDevice && !hasCloud) return { action: 'forget' };
  if (base.deleted) {
    // Back on both sides: treat it as new, so differing copies surface as a conflict.
    if (hasDevice && hasCloud) return { action: 'continue', base: undefined, forget: true };
    return { action: 'settled' };
  }
  if (hasDevice && hasCloud) return { action: 'continue', base };
  if (!isRealBase(base)) return { action: 'continue', base: undefined };
  return { action: 'tombstone', side: hasDevice ? 'cloud' : 'device' };
}

export interface RemoteSnapshot {
  hash: string;
  revision: string;
  updated: string;
}

/** The base to compare against. When the cloud holds exactly the text an earlier
 * upload was sending, that upload was applied and only its reply was lost, so
 * the cloud copy is this device's own earlier text and not another device's. */
export function effectiveBase(
  base: ScriptBase | undefined, remote: RemoteSnapshot, deviceUpdated: string,
): ScriptBase | undefined {
  const real = isRealBase(base) ? base : undefined;
  if (base?.sending_hash && base.sending_hash === remote.hash && real?.content_hash !== remote.hash) {
    return {
      script_id: base.script_id, content_hash: remote.hash, cloud_revision: remote.revision,
      device_updated: real?.device_updated ?? deviceUpdated, cloud_updated: remote.updated,
      deleted: '', sending_hash: '',
    };
  }
  return real;
}

export type IssueKind = 'conflict' | 'quota' | 'problem';

export interface DeviceSyncIssue {
  id: string;
  title: string;
  kind: IssueKind;
}

export type Verdict = 'synced' | 'pending' | 'syncing' | 'conflict' | 'problem' | 'quota' | 'open';

/** The project-level state is the most serious of its screenplays'. A
 * screenplay that only waits to be opened is in step as far as syncing goes. */
export function projectState(verdicts: Iterable<Verdict>): 'synced' | 'pending' | 'conflict' | 'problem' {
  const all = new Set(verdicts);
  if (all.has('conflict')) return 'conflict';
  if (all.has('problem') || all.has('quota')) return 'problem';
  if (all.has('pending')) return 'pending';
  return 'synced';
}

/** The remembered answer for a screenplay is still valid while neither side has changed. */
export interface Remembered { device: string; cloud: string; verdict: Verdict; until: number }

export function reusable(
  remembered: Remembered | undefined, device: string | undefined, cloud: string | undefined, now: number,
): Verdict | null {
  if (!remembered || remembered.device !== (device ?? '') || remembered.cloud !== (cloud ?? '')) return null;
  return now < remembered.until ? remembered.verdict : null;
}

/** A conflict or an unread newer cloud copy stays true until a side changes. A
 * refused quota may clear when the writer upgrades or frees space, so it is asked again. */
export function rememberFor(verdict: Verdict, now: number): number | null {
  if (verdict === 'conflict' || verdict === 'open') return Infinity;
  if (verdict === 'quota') return now + 10 * 60_000;
  return null;
}

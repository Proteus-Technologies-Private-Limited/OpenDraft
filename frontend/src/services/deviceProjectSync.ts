/** Syncs screenplay content between a native library project and its cloud
 * counterpart. SQLite remains the writer's local authority. No device save
 * waits for the network, and a pull never writes into an open editor. */
import { t } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import { useStorageStatusStore } from '../stores/storageStatusStore';
import { normalizeFormat } from '../utils/scriptFormat';
import { prepareReviewSave } from '../utils/reviewSave';
import { sha256Hex } from '../utils/sha256';
import { uuid } from '../utils/uuid';
import { ApiError, api, type ScriptMeta, type ScriptResponse } from './api';
import { cloudApi } from './cloudApi';
import { scopeForCloud } from './offlineCloud';
import { documentKey, findWindowWithDocument } from './openDocuments';
import { isTauri } from './platform';
import {
  activeBindings, disableBinding, enableBinding, forgetScriptBase, noteUploadHash, projectHasLinkedScripts,
  pullDeviceContent, readBinding, readDeviceContent, readScriptBases, rememberScriptBase, restartBinding,
  tombstoneScript, updateBinding, type DeviceBinding, type ScriptBase,
} from './deviceSyncStore';
import {
  classifyPresence, effectiveBase, isRealBase, projectState, rememberFor, reusable,
  type DeviceSyncIssue, type Remembered, type Verdict,
} from './deviceSyncLogic';

type Scope = NonNullable<ReturnType<typeof scopeForCloud>>;
type State = 'off' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'problem';
/** A project-level matter the writer has to act on: the project syncs with another
 * account, its cloud counterpart is gone, or it has linked files, which cannot sync. */
export type DeviceSyncAttention = 'account' | 'missing' | 'linked' | null;
export type DeviceSyncStatus = {
  state: State; lastSynced: number; enabled: boolean;
  /** The screenplays that did not sync, and why. */
  issues: DeviceSyncIssue[];
  /** Some screenplays hold a newer cloud copy that arrives when they are opened. */
  onOpen: boolean;
  attention: DeviceSyncAttention;
};
export type { DeviceSyncIssue } from './deviceSyncLogic';
const statuses = new Map<string, DeviceSyncStatus>();
const listeners = new Set<() => void>();
const locks = new Map<string, Promise<unknown>>();
// What the last pass concluded about a screenplay, so one that has not changed
// on either side is not downloaded again every 30 seconds.
const remembered = new Map<string, Remembered>();
const blank = () => ({ issues: [] as DeviceSyncIssue[], onOpen: false, attention: null as DeviceSyncAttention });

/** A failure whose text is meant for the writer, unlike a network or server error. */
export class DeviceSyncMessage extends Error {}

export const supportsDeviceSync = () => isTauri() && useStorageStatusStore.getState().mode === 'sqlite';
const cloudProject = (binding: DeviceBinding) => `sync-${binding.binding_id}`;

function publish(projectId: string, status: DeviceSyncStatus) {
  const prev = statuses.get(projectId);
  if (prev && prev.state === status.state && prev.enabled === status.enabled && prev.lastSynced === status.lastSynced
    && prev.onOpen === status.onOpen && prev.attention === status.attention
    && JSON.stringify(prev.issues) === JSON.stringify(status.issues)) return;
  statuses.set(projectId, status);
  for (const notify of listeners) notify();
}

export function subscribeDeviceSync(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export function deviceSyncStatus(projectId: string) {
  return statuses.get(projectId) ?? null;
}

export async function readDeviceSyncStatus(projectId: string) {
  if (!supportsDeviceSync()) return;
  const binding = await readBinding(projectId);
  if (!binding?.enabled) {
    publish(projectId, { enabled: false, state: 'off', lastSynced: 0, ...blank() });
    return;
  }
  const scope = scopeForCloud();
  const other = !!scope && binding.scope !== scope.key;
  if (other || !scope || !navigator.onLine || !statuses.has(projectId) || statuses.get(projectId)?.attention === 'account') {
    publish(projectId, {
      ...(statuses.get(projectId) ?? blank()), enabled: true, state: 'pending', lastSynced: binding.last_synced,
      attention: other ? 'account' : null,
    });
  }
}

async function serialize<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(projectId);
  const relay = async () => {
    if (navigator.locks?.request) return navigator.locks.request(`opendraft:device-project:${projectId}`, task);
    return task();
  };
  const next = (previous ?? Promise.resolve()).then(relay, relay);
  locks.set(projectId, next);
  try {
    return await next;
  } finally {
    if (locks.get(projectId) === next) locks.delete(projectId);
  }
}

export async function setDeviceProjectSync(projectId: string, enabled: boolean): Promise<'ok' | 'account' | 'linked' | 'problem'> {
  if (!supportsDeviceSync()) return 'problem';
  if (!enabled) {
    await disableBinding(projectId, uuid());
    await readDeviceSyncStatus(projectId);
    return 'ok';
  }
  return serialize(projectId, async () => {
    const scope = scopeForCloud();
    if (!scope) return 'account';
    const project = await api.getProject(projectId);
    if (project.properties.folder_path || await projectHasLinkedScripts(projectId)) return 'linked';
    if (!scope.isCurrent() || !await enableBinding(projectId, scope.key, uuid(), uuid())) return 'account';
    publish(projectId, { enabled: true, state: 'pending', lastSynced: 0, ...blank() });
    wakeDeviceProjectSync();
    return 'ok';
  });
}

/** Linked files cannot sync, so linking is refused while a project does. */
export async function deviceSyncEnabled(projectId: string): Promise<boolean> {
  if (!supportsDeviceSync()) return false;
  return !!(await readBinding(projectId))?.enabled;
}

export async function activeCloudCounterparts(): Promise<Set<string>> {
  const scope = scopeForCloud();
  if (!scope || !supportsDeviceSync()) return new Set();
  return new Set((await activeBindings(scope.key)).map(cloudProject));
}

function digest(content: ScriptResponse['content']): string {
  const stored = prepareReviewSave(content ?? {});
  return sha256Hex(JSON.stringify(stored, (_key, value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  }));
}

async function bindingStillActive(binding: DeviceBinding, scope: Scope) {
  const current = await readBinding(binding.project_id);
  return scope.isCurrent() && current?.enabled && current.generation === binding.generation;
}

async function reconcileScript(
  binding: DeviceBinding, scope: Scope, device: ScriptMeta | undefined, cloud: ScriptMeta | undefined,
  recorded: ScriptBase | undefined, canPull: boolean, stillOpening = () => true, knownRemote?: ScriptResponse,
): Promise<Verdict> {
  const id = device?.id ?? cloud?.id;
  if (!id) return 'pending';
  // A screenplay deleted on one side is not deleted on the other. Remember that,
  // so what is left is settled and not a permanent conflict.
  const presence = classifyPresence(recorded, !!device, !!cloud);
  if (presence.action === 'settled') return 'synced';
  if (presence.action === 'forget') {
    await forgetScriptBase(binding, id);
    return 'synced';
  }
  if (presence.action === 'tombstone') {
    await tombstoneScript(binding, id, presence.side);
    return 'synced';
  }
  if (presence.forget) await forgetScriptBase(binding, id);
  const known = presence.base;
  const real = isRealBase(known) ? known : undefined;
  if (real && device?.updated_at === real.device_updated && cloud?.updated_at === real.cloud_updated && !canPull) return 'synced';
  if (!await bindingStillActive(binding, scope)) return 'pending';
  const local = await readDeviceContent(binding.project_id, id);
  // A script that disappeared after listing must not be recreated.
  if (device && !local) return 'conflict';
  const remoteId = cloudProject(binding);
  const localHash = local && digest(local.content);
  let remote: ScriptResponse;
  if (cloud) {
    remote = knownRemote ?? await cloudApi.getScript(remoteId, id, scope);
  } else if (device && local) {
    if (!await bindingStillActive(binding, scope)) return 'pending';
    // Note what is being sent first: if the reply is lost, the cloud's copy is
    // recognised as this device's own text and not as another device's change.
    await noteUploadHash(binding, id, localHash!);
    remote = await cloudApi.ensureDeviceScript(remoteId, id, {
      title: device.title, format: device.format, content: prepareReviewSave(local.content ?? {}),
    }, scope);
  } else {
    return 'pending';
  }
  if (!remote.content_revision) return 'problem';
  const remoteHash = digest(remote.content);
  const base = effectiveBase(known, {
    hash: remoteHash, revision: remote.content_revision, updated: remote.meta.updated_at,
  }, local?.updated_at ?? '');
  if (local && localHash !== remoteHash) {
    if (!base) return 'conflict';
    if (localHash === base.content_hash) {
      // Read-only during background reconciliation. Pull a newer cloud copy
      // only before an editor mounts it, so a running editor cannot undo it.
      if (!canPull) return 'open';
      if (!stillOpening()) return 'pending';
    } else {
      if (remote.content_revision !== base.cloud_revision) return 'conflict';
      if (!await bindingStillActive(binding, scope)) return 'pending';
      await noteUploadHash(binding, id, localHash!);
      remote = await cloudApi.uploadOfflineScript(remoteId, id, prepareReviewSave(local.content ?? {}), base.cloud_revision, scope);
      if (!remote.content_revision) return 'problem';
    }
  }
  return acknowledge(binding, scope, id, local, localHash, base, remote, canPull, stillOpening);
}

/** Record what the cloud now holds, first bringing it onto the device when this
 * device has not changed the screenplay and the cloud has. */
async function acknowledge(
  binding: DeviceBinding, scope: Scope, id: string, local: Awaited<ReturnType<typeof readDeviceContent>>,
  localHash: string | undefined, base: ScriptBase | undefined, remote: ScriptResponse, canPull: boolean,
  stillOpening: () => boolean,
): Promise<Verdict> {
  const sentHash = digest(remote.content);
  let deviceUpdated = local?.updated_at;
  if (!local || (localHash !== sentHash && canPull && localHash === base?.content_hash)) {
    if (!scope.isCurrent() || !await pullDeviceContent(binding, remote.meta, remote.content, local, stillOpening)) return 'conflict';
    const pulled = await readDeviceContent(binding.project_id, id);
    if (!pulled || digest(pulled.content) !== sentHash) return 'pending';
    deviceUpdated = pulled.updated_at;
  }
  if (!deviceUpdated || !remote.content_revision || !scope.isCurrent()) return 'pending';
  await rememberScriptBase(binding, {
    script_id: id, content_hash: sentHash, cloud_revision: remote.content_revision,
    device_updated: deviceUpdated, cloud_updated: remote.meta.updated_at,
  });
  return 'synced';
}

function failureState(error: unknown): Verdict {
  if (error instanceof ApiError && error.status === 402) return 'quota';
  if (!(error instanceof ApiError) || error.status >= 500 || [401, 408, 429].includes(error.status)) return 'pending';
  return error.status === 412 ? 'conflict' : 'problem';
}

async function syncProject(binding: DeviceBinding, scope: Scope): Promise<void> {
  const projectId = binding.project_id;
  if (!await bindingStillActive(binding, scope)) return;
  const before = statuses.get(projectId) ?? { ...blank(), enabled: true, state: 'pending' as const, lastSynced: binding.last_synced };
  const set = (state: State, lastSynced = binding.last_synced, extra: Partial<DeviceSyncStatus> = {}) =>
    publish(projectId, { ...before, state, enabled: true, lastSynced, ...extra });
  set('syncing');
  try {
    const project = await api.getProject(projectId);
    if (project.properties.folder_path || await projectHasLinkedScripts(projectId)) {
      set('problem', binding.last_synced, { issues: [], onOpen: false, attention: 'linked' });
      return;
    }
    const remoteId = cloudProject(binding);
    if (!binding.published) {
      if (!await bindingStillActive(binding, scope)) return;
      await cloudApi.ensureDeviceProject(binding.binding_id, project.name, scope);
      await updateBinding(binding);
    }
    const [deviceScripts, cloudScripts, bases] = await Promise.all([
      api.listScripts(projectId), cloudApi.listScripts(remoteId, false, scope), readScriptBases(projectId),
    ]);
    const device = new Map(deviceScripts.map(meta => [meta.id, meta]));
    const cloud = new Map(cloudScripts.map(meta => [meta.id, meta]));
    const last = new Map(bases.map(base => [base.script_id, base]));
    const verdicts: Verdict[] = [];
    const issues: DeviceSyncIssue[] = [];
    for (const id of new Set([...device.keys(), ...cloud.keys(), ...last.keys()])) {
      if (!await bindingStillActive(binding, scope)) return;
      const format = device.get(id)?.format ?? cloud.get(id)?.format;
      if (format && normalizeFormat(format) !== 'screenplay') continue;
      const key = `${projectId}:${id}`;
      const deviceStamp = device.get(id)?.updated_at;
      const cloudStamp = cloud.get(id)?.updated_at;
      let verdict = reusable(remembered.get(key), deviceStamp, cloudStamp, Date.now());
      if (verdict === null) {
        try {
          verdict = await reconcileScript(binding, scope, device.get(id), cloud.get(id), last.get(id), false);
        } catch (error) {
          verdict = failureState(error);
        }
        const until = rememberFor(verdict, Date.now());
        if (until === null) remembered.delete(key);
        else remembered.set(key, { device: deviceStamp ?? '', cloud: cloudStamp ?? '', verdict, until });
      }
      verdicts.push(verdict);
      if (verdict === 'conflict' || verdict === 'problem' || verdict === 'quota') {
        issues.push({ id, title: device.get(id)?.title ?? cloud.get(id)?.title ?? '', kind: verdict });
      }
    }
    if (!await bindingStillActive(binding, scope)) return;
    const state = projectState(verdicts);
    const lastSynced = state === 'synced' ? Date.now() : binding.last_synced;
    if (state === 'synced') await updateBinding(binding, lastSynced);
    if (await bindingStillActive(binding, scope)) {
      set(state, lastSynced, { issues, onOpen: verdicts.includes('open'), attention: null });
    }
  } catch (error) {
    if (!await bindingStillActive(binding, scope)) return;
    // The cloud counterpart is gone, for instance deleted from another device.
    if (error instanceof ApiError && error.status === 404 && binding.published) {
      set('problem', binding.last_synced, { issues: [], onOpen: false, attention: 'missing' });
    } else {
      set(projectState([failureState(error)]));
    }
  }
}

/** Attempt to pull a clean device script immediately before it is loaded. */
export async function refreshDeviceScript(projectId: string, scriptId: string): Promise<void> {
  const scope = scopeForCloud();
  if (!scope || !supportsDeviceSync() || !navigator.onLine) return;
  const binding = await readBinding(projectId);
  if (!binding?.enabled || !binding.published || binding.scope !== scope.key) return;
  let opening = true;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>(resolve => { deadline = setTimeout(() => { opening = false; resolve(); }, 3500); });
  const work = serialize(projectId, async () => {
    try {
      if (!opening) return;
      const base = (await readScriptBases(projectId)).find(value => value.script_id === scriptId);
      if (!base || !await bindingStillActive(binding, scope) || await projectHasLinkedScripts(projectId)) return;
      if ((await api.getProject(projectId)).properties.folder_path) return;
      const device = (await api.listScripts(projectId)).find(value => value.id === scriptId);
      if (!device) return;
      // Another window already has this script open and may be editing it.
      // Replacing its text underneath that editor would be undone by its next
      // autosave, which would then upload the older text over the cloud's.
      const elsewhere = await findWindowWithDocument(documentKey(projectId, scriptId, null) ?? '').catch(() => null);
      const remote = await cloudApi.getScript(cloudProject(binding), scriptId, scope);
      await reconcileScript(binding, scope, device, remote.meta, base, !elsewhere, () => {
        if (opening) clearTimeout(deadline);
        return opening;
      }, remote);
      remembered.delete(`${projectId}:${scriptId}`);
      wakeDeviceProjectSync();
    } catch {
      // Opening the existing local script must work if the network is down.
      wakeDeviceProjectSync();
    }
  });
  try {
    await Promise.race([work, limit]);
  } finally {
    clearTimeout(deadline);
  }
}

/** A way out of a conflict or a refused screenplay. Whichever side loses is first
 * saved as a new screenplay, so no text is discarded. */
export async function resolveDeviceSyncIssue(
  projectId: string, scriptId: string, keep: 'device' | 'cloud',
): Promise<void> {
  const scope = scopeForCloud();
  if (!scope || !supportsDeviceSync()) throw new DeviceSyncMessage(t('toolbar:status.save.cloudSignIn'));
  await serialize(projectId, async () => {
    const binding = await readBinding(projectId);
    if (!binding?.enabled || binding.scope !== scope.key || !await bindingStillActive(binding, scope)) {
      throw new DeviceSyncMessage(t('projects:sync.account'));
    }
    const remoteId = cloudProject(binding);
    const device = (await api.listScripts(projectId)).find(value => value.id === scriptId);
    const local = device && await readDeviceContent(projectId, scriptId);
    let remote: ScriptResponse | undefined;
    try {
      remote = await cloudApi.getScript(remoteId, scriptId, scope);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    const sameText = !!local && !!remote && digest(local.content) === digest(remote.content);
    const saveCopy = async (title: string, content: ScriptResponse['content'], format: string) => {
      await api.createScript(projectId, { title, content: prepareReviewSave(content ?? {}), format });
    };

    if (keep === 'device') {
      if (!device || !local) throw new DeviceSyncMessage(t('toolbar:status.save.cloudProblem'));
      if (remote && !sameText) {
        // i18n-ignore: stored as the new screenplay's title.
        await saveCopy(`${remote.meta.title} (cloud copy)`, remote.content, remote.meta.format);
      }
      const body = prepareReviewSave(local.content ?? {});
      await noteUploadHash(binding, scriptId, digest(local.content));
      const sent = remote
        ? await cloudApi.uploadOfflineScript(remoteId, scriptId, body, remote.content_revision ?? '', scope)
        : await cloudApi.ensureDeviceScript(remoteId, scriptId, { title: device.title, format: device.format, content: body }, scope);
      if (!sent.content_revision) throw new DeviceSyncMessage(t('toolbar:status.save.cloudProblem'));
      await rememberScriptBase(binding, {
        script_id: scriptId, content_hash: digest(sent.content), cloud_revision: sent.content_revision,
        device_updated: local.updated_at, cloud_updated: sent.meta.updated_at,
      });
    } else {
      if (!remote?.content_revision) throw new DeviceSyncMessage(t('toolbar:status.save.cloudProblem'));
      if (device && local) {
        // Pulling replaces the text; an editor holding the old text would undo it.
        if (await findWindowWithDocument(documentKey(projectId, scriptId, null) ?? '').catch(() => null)) {
          throw new DeviceSyncMessage(t('projects:sync.openElsewhere'));
        }
        // i18n-ignore: stored as the new screenplay's title.
        if (!sameText) await saveCopy(`${device.title} (device copy)`, local.content, device.format);
      }
      if (!await pullDeviceContent(binding, remote.meta, remote.content, local || undefined)) {
        throw new DeviceSyncMessage(t('toolbar:status.save.cloudProblem'));
      }
      const pulled = await readDeviceContent(projectId, scriptId);
      if (!pulled) throw new DeviceSyncMessage(t('toolbar:status.save.cloudProblem'));
      await rememberScriptBase(binding, {
        script_id: scriptId, content_hash: digest(remote.content), cloud_revision: remote.content_revision,
        device_updated: pulled.updated_at, cloud_updated: remote.meta.updated_at,
      });
    }
    remembered.delete(`${projectId}:${scriptId}`);
  });
  wakeDeviceProjectSync();
}

/** Sync with the account that is signed in now: a new cloud counterpart, with
 * every screenplay on this device uploaded to it. Used when the project was
 * syncing with another account, or its cloud copy was deleted. */
export async function restartDeviceProjectSync(projectId: string): Promise<'ok' | 'account' | 'linked' | 'problem'> {
  if (!supportsDeviceSync()) return 'problem';
  return serialize(projectId, async () => {
    const scope = scopeForCloud();
    if (!scope) return 'account';
    const project = await api.getProject(projectId);
    if (project.properties.folder_path || await projectHasLinkedScripts(projectId)) return 'linked';
    if (!scope.isCurrent() || !await restartBinding(projectId, scope.key, uuid(), uuid())) return 'problem';
    for (const key of [...remembered.keys()]) if (key.startsWith(`${projectId}:`)) remembered.delete(key);
    publish(projectId, { ...blank(), enabled: true, state: 'pending', lastSynced: 0 });
    wakeDeviceProjectSync();
    return 'ok';
  });
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let requested = false;

export function wakeDeviceProjectSync(projectId?: string) {
  if (!supportsDeviceSync() || (projectId && !statuses.get(projectId)?.enabled)) return;
  if (running) { requested = true; return; }
  clearTimeout(timer);
  timer = setTimeout(() => { void drain(); }, 750);
}

async function drain() {
  const scope = scopeForCloud();
  if (!scope || !navigator.onLine) return;
  running = true;
  requested = false;
  let repeat = false;
  try {
    const bindings = await activeBindings(scope.key);
    repeat = bindings.length > 0;
    for (const binding of bindings) {
      if (!scope.isCurrent()) break;
      await serialize(binding.project_id, () => syncProject(binding, scope));
    }
  } catch (error) {
    console.warn('[cloud] could not check device project sync:', error);
    repeat = true;
  } finally {
    running = false;
    if (requested) wakeDeviceProjectSync();
    else if (repeat && scope.isCurrent()) timer = setTimeout(() => { void drain(); }, 30_000);
  }
}

export function startDeviceProjectSync() {
  if (!supportsDeviceSync()) return;
  const wake = () => wakeDeviceProjectSync();
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('offline', () => {
    for (const [id, status] of statuses) if (status.enabled) publish(id, { ...status, state: 'pending' });
  });
  useSettingsStore.subscribe((state, previous) => {
    if (state.collabAuth !== previous.collabAuth) wake();
  });
  wake();
}

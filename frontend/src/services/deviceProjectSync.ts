/** Syncs screenplay content between a native library project and its cloud
 * counterpart. SQLite remains the writer's local authority. No device save
 * waits for the network, and a pull never writes into an open editor. */
import { useSettingsStore } from '../stores/settingsStore';
import { useStorageStatusStore } from '../stores/storageStatusStore';
import { normalizeFormat } from '../utils/scriptFormat';
import { prepareReviewSave } from '../utils/reviewSave';
import { sha256Hex } from '../utils/sha256';
import { uuid } from '../utils/uuid';
import { ApiError, api, type ScriptMeta, type ScriptResponse } from './api';
import { cloudApi } from './cloudApi';
import { scopeForCloud } from './offlineCloud';
import { isTauri } from './platform';
import {
  activeBindings, disableBinding, enableBinding, projectHasLinkedScripts, pullDeviceContent,
  readBinding, readDeviceContent, readScriptBases, rememberScriptBase, updateBinding,
  type DeviceBinding, type ScriptBase,
} from './deviceSyncStore';

type Scope = NonNullable<ReturnType<typeof scopeForCloud>>;
type State = 'off' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'problem';
export type DeviceSyncStatus = { state: State; lastSynced: number; enabled: boolean };
const statuses = new Map<string, DeviceSyncStatus>();
const listeners = new Set<() => void>();
const locks = new Map<string, Promise<unknown>>();

export const supportsDeviceSync = () => isTauri() && useStorageStatusStore.getState().mode === 'sqlite';
const cloudProject = (binding: DeviceBinding) => `sync-${binding.binding_id}`;

function publish(projectId: string, status: DeviceSyncStatus) {
  const prev = statuses.get(projectId);
  if (prev?.state === status.state && prev.enabled === status.enabled && prev.lastSynced === status.lastSynced) return;
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
    publish(projectId, { enabled: false, state: 'off', lastSynced: 0 });
  } else if (binding.scope !== scopeForCloud()?.key || !navigator.onLine || !statuses.has(projectId)) {
    publish(projectId, { enabled: true, state: 'pending', lastSynced: binding.last_synced });
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
    publish(projectId, { enabled: true, state: 'pending', lastSynced: 0 });
    wakeDeviceProjectSync();
    return 'ok';
  });
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
  base: ScriptBase | undefined, canPull: boolean, stillOpening = () => true, knownRemote?: ScriptResponse,
): Promise<State> {
  if (base && (!device || !cloud)) return 'problem';
  if (base && device?.updated_at === base.device_updated && cloud?.updated_at === base.cloud_updated && !canPull) return 'synced';
  const id = device?.id ?? cloud?.id;
  if (!id || !await bindingStillActive(binding, scope)) return 'pending';
  const local = await readDeviceContent(binding.project_id, id);
  // A script that disappeared after listing must not be recreated.
  if (device && !local) return 'conflict';
  const remoteId = cloudProject(binding);
  let remote: ScriptResponse;
  if (cloud) {
    remote = knownRemote ?? await cloudApi.getScript(remoteId, id, scope);
  } else if (device && local) {
    if (!await bindingStillActive(binding, scope)) return 'pending';
    remote = await cloudApi.ensureDeviceScript(remoteId, id, {
      title: device.title, format: device.format, content: prepareReviewSave(local.content ?? {}),
    }, scope);
  } else {
    return 'pending';
  }
  if (!remote.content_revision) return 'problem';
  const localHash = local && digest(local.content);
  const remoteHash = digest(remote.content);
  if (local && localHash !== remoteHash) {
    if (!base) return 'conflict';
    if (localHash === base.content_hash) {
      // Read-only during background reconciliation. Pull a newer cloud copy
      // only before an editor mounts it, so a running editor cannot undo it.
      if (!canPull || !stillOpening()) return 'pending';
    } else {
      if (remote.content_revision !== base.cloud_revision) return 'conflict';
      if (!await bindingStillActive(binding, scope)) return 'pending';
      remote = await cloudApi.uploadOfflineScript(remoteId, id, prepareReviewSave(local.content ?? {}), base.cloud_revision, scope);
      if (!remote.content_revision) return 'problem';
    }
  }
  const sentHash = digest(remote.content);
  let deviceUpdated = local?.updated_at;
  if (!local || (localHash !== sentHash && canPull && localHash === base?.content_hash)) {
    if (!scope.isCurrent() || !await pullDeviceContent(binding, remote.meta, remote.content, local, stillOpening)) return 'conflict';
    const pulled = await readDeviceContent(binding.project_id, id);
    if (!pulled || digest(pulled.content) !== sentHash) return 'pending';
    deviceUpdated = pulled.updated_at;
  }
  if (!deviceUpdated || !scope.isCurrent()) return 'pending';
  await rememberScriptBase(binding, {
    script_id: id, content_hash: sentHash, cloud_revision: remote.content_revision,
    device_updated: deviceUpdated, cloud_updated: remote.meta.updated_at,
  });
  return 'synced';
}

function failureState(error: unknown): State {
  if (!(error instanceof ApiError) || error.status >= 500 || [401, 408, 429].includes(error.status)) return 'pending';
  return error.status === 412 ? 'conflict' : 'problem';
}

async function syncProject(binding: DeviceBinding, scope: Scope): Promise<void> {
  const projectId = binding.project_id;
  if (!await bindingStillActive(binding, scope)) return;
  const set = (state: State, lastSynced = binding.last_synced) =>
    publish(projectId, { state, enabled: true, lastSynced });
  set('syncing');
  try {
    const project = await api.getProject(projectId);
    if (project.properties.folder_path || await projectHasLinkedScripts(projectId)) {
      set('problem');
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
    const states = new Set<State>();
    for (const id of new Set([...device.keys(), ...cloud.keys(), ...last.keys()])) {
      if (!await bindingStillActive(binding, scope)) return;
      const format = device.get(id)?.format ?? cloud.get(id)?.format;
      if (format && normalizeFormat(format) !== 'screenplay') continue;
      try {
        states.add(await reconcileScript(binding, scope, device.get(id), cloud.get(id), last.get(id), false));
      } catch (error) {
        states.add(failureState(error));
      }
    }
    if (!await bindingStillActive(binding, scope)) return;
    const state = states.has('conflict') ? 'conflict' : states.has('problem') ? 'problem'
      : states.has('pending') ? 'pending' : 'synced';
    const lastSynced = state === 'synced' ? Date.now() : binding.last_synced;
    if (state === 'synced') await updateBinding(binding, lastSynced);
    if (await bindingStillActive(binding, scope)) set(state, lastSynced);
  } catch (error) {
    if (await bindingStillActive(binding, scope)) set(failureState(error));
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
      const remote = await cloudApi.getScript(cloudProject(binding), scriptId, scope);
      await reconcileScript(binding, scope, device, remote.meta, base, true, () => {
        if (opening) clearTimeout(deadline);
        return opening;
      }, remote);
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

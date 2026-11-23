/** Device copies of cloud scripts. The local script and its outbox entry are
 * committed together. A conditional upload never replaces a different cloud
 * revision, and acknowledging it never clears a newer local edit. */
import { getApiBase } from '../config';
import { showToast } from '../components/Toast';
import { t } from '../i18n';
import { useSettingsStore, type CollabAuth } from '../stores/settingsStore';
import { docHasAnyText } from '../utils/docText';
import { prepareScriptWrite } from '../utils/reviewSave';
import { uuid } from '../utils/uuid';
import { ApiError, type ProjectInfo, type ScriptMeta, type ScriptResponse } from './api';
import { cloudApi, type CloudRequestScope } from './cloudApi';
import { isTauri } from './platform';
import {
  cacheOfflineCatalog, clearSyncedOfflineData, editOfflineScript, pendingOfflineScripts, readOfflineCatalog,
  readOfflineScript, removeOfflineScripts, unresolvedOfflineScripts, type OfflineScript,
} from './offlineCloudStore';

interface Scope extends CloudRequestScope { key: string }

export interface OfflineCloudStatus {
  state: OfflineScript['state'] | 'syncing';
  lastSynced: number;
}

const statuses = new Map<string, OfflineCloudStatus>();
const listeners = new Set<() => void>();
// Online-only documents keep their last known revision when the server has one.
const onlineOnly = new Map<string, string | null>();
let generation = 0;
let observedScope: string | null | undefined;

function scopeKey(auth: CollabAuth = useSettingsStore.getState().collabAuth): string | null {
  if (!isTauri()) return null;
  return auth.user?.id && auth.accessToken ? JSON.stringify([getApiBase(), auth.user.id]) : null;
}

function scopeForCloud(): Scope | null {
  const key = observeScope();
  const epoch = generation;
  return key ? { key, base: getApiBase(), isCurrent: () => observeScope() === key && generation === epoch } : null;
}

function observeScope(): string | null {
  const key = scopeKey();
  if (key !== observedScope) {
    observedScope = key;
    generation++;
  }
  return key;
}

function statusKey(scope: string, projectId: string, scriptId: string): string {
  return JSON.stringify([scope, projectId, scriptId]);
}

export function subscribeOfflineCloud(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

export function offlineCloudStatus(projectId: string | null | undefined, scriptId: string | null | undefined) {
  if (!projectId || !scriptId) return null;
  const scope = scopeKey();
  return scope ? statuses.get(statusKey(scope, projectId, scriptId)) ?? null : null;
}

function showStatus(row: OfflineScript, state: OfflineCloudStatus['state'] = row.state) {
  const key = statusKey(row.scope, row.projectId, row.scriptId);
  const previous = statuses.get(key);
  if (previous?.state === state && previous.lastSynced === row.lastSynced) return;
  statuses.set(key, { state, lastSynced: row.lastSynced });
  for (const notify of listeners) notify();
}

function assertCurrent(scope: Scope): void {
  if (!scope.isCurrent()) throw new Error(t('toolbar:status.save.cloudProblem'));
}

function requireScope(): Scope {
  const scope = scopeForCloud();
  if (!scope) throw new Error(t('toolbar:status.save.cloudSignIn'));
  return scope;
}

function forgetStatus(scope: string, projectId?: string, scriptId?: string) {
  const prefix = JSON.stringify([scope, projectId, scriptId].filter(value => value !== undefined)).slice(0, -1);
  for (const key of new Set([...statuses.keys(), ...onlineOnly.keys()])) {
    if (!key.startsWith(`${prefix},`) && key !== `${prefix}]`) continue;
    statuses.delete(key);
    onlineOnly.delete(key);
  }
  for (const notify of listeners) notify();
}

let persistenceRequested = false;
function requestPersistence() {
  if (persistenceRequested || !navigator.storage?.persist) return;
  persistenceRequested = true;
  void navigator.storage.persist().catch(error => console.warn('[cloud] persistent storage:', error));
}

function canUseOfflineCopy(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 429;
}

async function readCatalog<T>(key: string, fetchRemote: (scope?: Scope) => Promise<T>, scope = scopeForCloud()): Promise<T> {
  if (!scope) return fetchRemote();
  try {
    if (!navigator.onLine) throw new Error(t('toolbar:status.save.cloudUnavailable'));
    const fresh = await fetchRemote(scope);
    assertCurrent(scope);
    await cacheOfflineCatalog(scope.key, key, fresh, scope.isCurrent).catch(error => console.warn('[cloud] catalogue cache:', error));
    assertCurrent(scope);
    return fresh;
  } catch (error) {
    assertCurrent(scope);
    if (!canUseOfflineCopy(error)) throw error;
    const cached = await readOfflineCatalog<T>(scope.key, key);
    assertCurrent(scope);
    if (cached !== undefined) return cached;
    throw error;
  }
}

// Preserve a way to reopen local edits even when the project or script was
// removed on another device. Clean, deleted copies stay out of the browser.
async function unresolved(scope: Scope) {
  return unresolvedOfflineScripts(scope.key).catch(() => []);
}

async function retainedProject(key: [string, string, string], cached?: ProjectInfo): Promise<ProjectInfo | undefined> {
  if (cached) return cached;
  const row = await readOfflineScript(key).catch(() => undefined);
  if (!row) return undefined;
  const { title, created_at, updated_at } = row.script.meta;
  return row.project ?? { id: row.projectId, name: title, created_at, updated_at,
    properties: {
      genre: '', logline: '', synopsis: '', author: '', contact: '', copyright: '', draft: '', language: '', format: '',
      production_company: '', director: '', producer: '', status: '', target_length: '', notes: '',
      wga_registration: '', wga_registration_date: '', copyright_registration: '', copyright_year: '',
      agent_name: '', agent_contact: '', manager_name: '', manager_contact: '', submissions: [],
    }, color: '', pinned: false, sort_order: 0 };
}

export const offlineCloud = {
  listProjects: () => readCatalog('projects', async scope => {
    const fresh = await cloudApi.listProjects(scope);
    if (!scope) return fresh;
    const present = new Set(fresh.map(project => project.id));
    const cached = await readOfflineCatalog<ProjectInfo[]>(scope.key, 'projects').catch(() => undefined);
    const retained: ProjectInfo[] = [];
    for (const key of await unresolved(scope)) {
      const id = key[1];
      if (present.has(id)) continue;
      const project = await retainedProject(key, cached?.find(item => item.id === id));
      if (project) {
        retained.push(project);
        present.add(id);
      }
    }
    return [...fresh, ...retained];
  }),

  getProject: (projectId: string) => readCatalog(`project:${projectId}`, async scope => {
    try {
      return await cloudApi.getProject(projectId, scope);
    } catch (error) {
      if (!scope || !(error instanceof ApiError) || error.status !== 404) throw error;
      const key = (await unresolved(scope)).find(([, id]) => id === projectId);
      if (key) {
        const cached = await readOfflineCatalog<ProjectInfo>(scope.key, `project:${projectId}`).catch(() => undefined);
        const copied = await retainedProject(key, cached);
        if (copied) return copied;
      }
      throw error;
    }
  }),

  listScripts: (projectId: string, includePreview = false) =>
    readCatalog(`scripts:${projectId}:${includePreview}`, async scope => {
      if (!scope) return cloudApi.listScripts(projectId, includePreview);
      const local = (await unresolved(scope)).filter(([, id]) => id === projectId);
      let remote: ScriptMeta[];
      try {
        remote = await cloudApi.listScripts(projectId, includePreview, scope);
      } catch (error) {
        if (!local.length || !(error instanceof ApiError) || error.status !== 404) throw error;
        remote = [];
      }
      const present = new Set(remote.map(script => script.id));
      const retained = await Promise.all(local.filter(([, , id]) => !present.has(id)).map(readOfflineScript));
      return [...remote, ...retained.flatMap(row => row ? [row.script.meta] : [])];
    }),

  getScript: async (projectId: string, scriptId: string): Promise<ScriptResponse> => {
    const scope = scopeForCloud();
    if (!scope) return cloudApi.getScript(projectId, scriptId);
    const key = [scope.key, projectId, scriptId] as const;
    const cached = await readOfflineScript([...key]).catch(error => {
      console.warn('[cloud] script cache:', error);
      return undefined;
    });
    assertCurrent(scope);
    if (cached && (cached.state !== 'synced' || !navigator.onLine)) {
      showStatus(cached);
      if (cached.state === 'pending') wakeOfflineSync();
      return cached.script;
    }
    try {
      if (!navigator.onLine) throw new Error(t('toolbar:status.save.cloudUnavailable'));
      const script = await cloudApi.getScript(projectId, scriptId, scope);
      assertCurrent(scope);
      const revision = script.content_revision;
      const id = statusKey(...key);
      if (!revision) {
        if (!cached) onlineOnly.set(id, null);
        return script;
      }
      const project = await readOfflineCatalog<ProjectInfo>(scope.key, `project:${projectId}`).catch(() => undefined);
      const row = await editOfflineScript([...key], current => {
        assertCurrent(scope);
        if (current && (current.state !== 'synced' || current.revision !== cached?.revision)) return current;
        return { scope: scope.key, projectId, scriptId, revision, script, project, state: 'synced', lastSynced: Date.now() };
      }).catch(error => {
        if (cached) throw error;
        assertCurrent(scope);
        console.warn('[cloud] script cache:', error);
        onlineOnly.set(id, revision);
        return undefined;
      });
      assertCurrent(scope);
      if (!row) return script;
      onlineOnly.delete(id);
      showStatus(row);
      return row.script;
    } catch (error) {
      assertCurrent(scope);
      if (!cached || !canUseOfflineCopy(error)) throw error;
      showStatus(cached);
      return cached.script;
    }
  },

  saveScript: async (projectId: string, scriptId: string, content: Record<string, unknown>): Promise<ScriptResponse> => {
    if (!isTauri()) return cloudApi.saveScript(projectId, scriptId, { content });
    const scope = requireScope();
    const id = statusKey(scope.key, projectId, scriptId);
    const prepared = prepareScriptWrite({ content }).content;
    let hasDeviceRow = false;
    const row = await editOfflineScript([scope.key, projectId, scriptId], current => {
      assertCurrent(scope);
      if (!current) return undefined;
      hasDeviceRow = true;
      if (!docHasAnyText(prepared) && docHasAnyText(current.script.content)) {
        throw new Error(t('toolbar:status.save.cloudProblem'));
      }
      return {
        ...current,
        script: { ...current.script, content: prepared },
        operation: uuid(),
        state: current.state === 'conflict' ? 'conflict' : 'pending',
      };
    }).catch(error => {
      if (hasDeviceRow || !onlineOnly.has(id)) throw error;
      return undefined;
    });
    assertCurrent(scope);
    if (!row) {
      const revision = onlineOnly.get(id);
      if (!navigator.onLine || revision === undefined) throw new Error(t('toolbar:status.save.cloudUnavailable'));
      const saved = revision === null
        ? await cloudApi.saveScript(projectId, scriptId, { content }, scope)
        : await cloudApi.uploadOfflineScript(projectId, scriptId, prepared, revision, scope);
      assertCurrent(scope);
      onlineOnly.set(id, saved.content_revision ?? revision);
      return saved;
    }
    onlineOnly.delete(id);
    requestPersistence();
    showStatus(row);
    if (row.state === 'pending') wakeOfflineSync();
    return row.script;
  },

  deleteScript: (projectId: string, scriptId: string) => deleteCloudItem(projectId, scriptId),
  deleteProject: (projectId: string) => deleteCloudItem(projectId),
  duplicateScript: async (projectId: string, scriptId: string): Promise<ScriptResponse> => {
    const scope = isTauri() ? requireScope() : undefined;
    const original = await offlineCloud.getScript(projectId, scriptId);
    if (scope) assertCurrent(scope);
    return cloudApi.createScript(projectId, {
      title: `${original.meta.title} (copy)`, // i18n-ignore: stored as the new script's title.
      content: original.content,
      format: original.meta.format,
    }, scope);
  },
};

async function deleteCloudItem(projectId: string, scriptId?: string) {
  const removeRemote = (scope?: Scope) => scriptId
    ? cloudApi.deleteScript(projectId, scriptId, scope)
    : cloudApi.deleteProject(projectId, scope);
  if (!isTauri()) return removeRemote();
  const scope = requireScope();
  let response;
  try {
    response = await removeRemote(scope);
  } catch (error) {
    assertCurrent(scope);
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    const retained = await unresolved(scope);
    if (!retained.some(([, project, script]) => project === projectId && (!scriptId || script === scriptId))) throw error;
    response = { message: 'ok' }; // i18n-ignore: synthetic API response, callers supply the UI message.
  }
  await removeOfflineScripts(scope.key, projectId, scriptId);
  assertCurrent(scope);
  forgetStatus(scope.key, projectId, scriptId);
  return response;
}

/** Use the cloud copy or explicitly put the device copy back in the queue. */
export async function resolveOfflineCloudConflict(projectId: string, scriptId: string,
  choice: 'cloud' | 'device', content?: Record<string, unknown>): Promise<'resolved' | 'removed'> {
  const scope = requireScope();
  const key: [string, string, string] = [scope.key, projectId, scriptId];
  const local = await readOfflineScript(key);
  if (local?.state !== 'conflict') throw new Error(t('toolbar:status.save.cloudProblem'));
  let cloud: ScriptResponse | undefined;
  try {
    cloud = await cloudApi.getScript(projectId, scriptId, scope);
  } catch (error) {
    if (choice !== 'cloud' || !(error instanceof ApiError) || error.status !== 404) throw error;
  }
  assertCurrent(scope);
  const revision = cloud?.content_revision;
  if (choice === 'device' && !revision) throw new Error(t('toolbar:status.save.cloudProblem'));
  const prepared = content && prepareScriptWrite({ content }).content;
  const row = await editOfflineScript(key, current => {
    assertCurrent(scope);
    if (!current || current.state !== 'conflict' || current.operation !== local.operation) {
      throw new Error(t('toolbar:status.save.cloudProblem'));
    }
    if (choice === 'device' && revision) {
      if (prepared && !docHasAnyText(prepared) && docHasAnyText(current.script.content)) {
        throw new Error(t('toolbar:status.save.cloudProblem'));
      }
      return { ...current, script: prepared ? { ...current.script, content: prepared } : current.script,
        revision, state: 'pending', operation: uuid(), inFlight: undefined };
    }
    if (!cloud || !revision) return undefined;
    return { scope: scope.key, projectId, scriptId, revision, script: cloud, state: 'synced', lastSynced: Date.now() };
  });
  assertCurrent(scope);
  if (row) {
    showStatus(row);
    if (row.state === 'pending') wakeOfflineSync();
  } else {
    forgetStatus(scope.key, projectId, scriptId);
    if (cloud) onlineOnly.set(statusKey(...key), null);
  }
  return cloud ? 'resolved' : 'removed';
}

async function missingCloudScript(error: unknown, scope: Scope, row: OfflineScript): Promise<boolean> {
  if (!(error instanceof ApiError) || error.status !== 404) return false;
  if ((error.body as { detail?: { code?: string } } | null)?.detail?.code === 'offline_script_missing') return true;
  // An older or rolled-back server can return 404 for the route itself.
  try {
    await cloudApi.getScript(row.projectId, row.scriptId, scope);
    return false;
  } catch (probeError) {
    return probeError instanceof ApiError && probeError.status === 404;
  }
}

async function upload(scope: Scope, queued: OfflineScript): Promise<boolean> {
  const key: [string, string, string] = [scope.key, queued.projectId, queued.scriptId];
  const row = await editOfflineScript(key, current => {
    if (!scope.isCurrent() || current?.state !== 'pending' || current.inFlight
      || !current.script.content || !current.operation) return current;
    return { ...current, inFlight: { operation: current.operation, content: current.script.content } };
  });
  const sent = row?.inFlight;
  if (!row || row.state !== 'pending' || !sent || !scope.isCurrent()) return false;
  showStatus(row, 'syncing');
  try {
    const script = await cloudApi.uploadOfflineScript(row.projectId, row.scriptId, sent.content, row.revision, scope);
    if (!scope.isCurrent()) return false;
    const revision = script.content_revision;
    if (!revision) throw new Error('Conditional upload returned no revision');
    const lastSynced = Date.now();
    const next = await editOfflineScript(key, current => {
      if (!scope.isCurrent() || current?.revision !== row.revision || current.state !== 'pending'
        || current.inFlight?.operation !== sent.operation) return current;
      // A newer edit keeps its body and uses the revision of the acknowledged upload.
      if (current.operation !== sent.operation) return { ...current, revision, lastSynced, inFlight: undefined };
      return { ...current, script, revision, lastSynced, state: 'synced', operation: undefined, inFlight: undefined };
    });
    if (next && scope.isCurrent()) {
      showStatus(next);
      if (next.state === 'pending') wakeOfflineSync();
    }
    return false;
  } catch (error) {
    if (!scope.isCurrent()) return false;
    const status = error instanceof ApiError ? error.status : undefined;
    const state = status === 412 || await missingCloudScript(error, scope, row) ? 'conflict'
      : status !== undefined && status >= 400 && status < 500
        && status !== 401 && status !== 403 && status !== 404 && status !== 408 && status !== 429 ? 'problem' : 'pending';
    const next = await editOfflineScript(key, current =>
      scope.isCurrent() && current?.revision === row.revision && current.state === 'pending'
        && current.inFlight?.operation === sent.operation
        ? { ...current, state, inFlight: state === 'pending' ? current.inFlight : undefined } : current);
    if (next && scope.isCurrent()) showStatus(next);
    return scope.isCurrent() && next?.state === 'pending';
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let requested = false;

function wakeOfflineSync(delay = 0) {
  if (running) {
    requested = true;
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(() => { void flushOfflineScripts(); }, delay);
}

async function flushOfflineScripts() {
  const scope = scopeForCloud();
  if (!scope || !navigator.onLine) return;
  running = true;
  requested = false;
  let retry = false;
  const run = async () => {
    for (const row of await pendingOfflineScripts(scope.key)) {
      if (!scope.isCurrent()) break;
      if (await upload(scope, row)) retry = true;
    }
  };
  try {
    // Serialize drainers on the same device when Web Locks are available.
    // The server precondition and IndexedDB's CAS still protect older views.
    if (navigator.locks?.request) {
      await navigator.locks.request(`opendraft:offline-cloud:${scope.key}`, run);
    } else {
      await run();
    }
  } catch (error) {
    console.warn('[cloud] could not process offline saves:', error);
    retry = true;
  } finally {
    running = false;
    if (requested) wakeOfflineSync();
    else if (retry && scope.isCurrent()) wakeOfflineSync(30_000);
  }
}

/** Start once in the native editor app, after storage and settings are ready. */
export function startOfflineCloudSync() {
  if (!isTauri()) return;
  const wake = () => wakeOfflineSync();
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  observeScope();
  useSettingsStore.subscribe((state, previous) => {
    if (state.collabAuth === previous.collabAuth) return;
    const previousScope = scopeKey(previous.collabAuth);
    const current = observeScope();
    if (previousScope && previousScope !== current) {
      forgetStatus(previousScope);
      void clearSyncedOfflineData(previousScope).then(retained => {
        if (retained) showToast(t('toolbar:status.save.cloudSignOutPending'), 'info');
      }).catch(error => console.warn('[cloud] sign-out cleanup:', error));
    } else if (current) {
      for (const notify of listeners) notify();
    }
    wake();
  });
  wake();
}

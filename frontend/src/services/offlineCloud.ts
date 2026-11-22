/** Device copies of cloud scripts. The local script and its outbox entry are
 * committed together. A conditional upload never replaces a different cloud
 * revision, and acknowledging it never clears a newer local edit. */
import { getApiBase } from '../config';
import { t } from '../i18n';
import { useSettingsStore } from '../stores/settingsStore';
import { docHasAnyText } from '../utils/docText';
import { prepareScriptWrite } from '../utils/reviewSave';
import { uuid } from '../utils/uuid';
import { ApiError, type ProjectInfo, type ScriptMeta, type ScriptResponse } from './api';
import { cloudApi, type CloudRequestScope } from './cloudApi';
import { isTauri } from './platform';
import {
  cacheOfflineCatalog, editOfflineScript, pendingOfflineScripts, readOfflineCatalog,
  readOfflineScript, unresolvedOfflineScripts, type OfflineScript,
} from './offlineCloudStore';

interface Scope extends CloudRequestScope { key: string }

export interface OfflineCloudStatus {
  state: OfflineScript['state'] | 'syncing';
  lastSynced: number;
}

const statuses = new Map<string, OfflineCloudStatus>();
const listeners = new Set<() => void>();
const legacyOnline = new Set<string>();

function scopeKey(): string | null {
  if (!isTauri()) return null;
  const auth = useSettingsStore.getState().collabAuth;
  return auth.user?.id && auth.accessToken ? JSON.stringify([getApiBase(), auth.user.id]) : null;
}

function scopeForCloud(): Scope | null {
  const key = scopeKey();
  return key ? { key, base: getApiBase(), isCurrent: () => scopeKey() === key } : null;
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

function canUseOfflineCopy(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 408 || error.status === 429;
}

async function readCatalog<T>(key: string, fetchRemote: (scope?: Scope) => Promise<T>, scope = scopeForCloud()): Promise<T> {
  if (!scope) return fetchRemote();
  try {
    if (!navigator.onLine) throw new Error(t('toolbar:status.save.cloudUnavailable'));
    const fresh = await fetchRemote(scope);
    assertCurrent(scope);
    await cacheOfflineCatalog(scope.key, key, fresh).catch(error => console.warn('[cloud] catalogue cache:', error));
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

export const offlineCloud = {
  listProjects: () => readCatalog('projects', async scope => {
    const fresh = await cloudApi.listProjects(scope);
    if (!scope) return fresh;
    const present = new Set(fresh.map(project => project.id));
    const retained = new Set((await unresolved(scope)).map(([, projectId]) => projectId));
    const cached = await readOfflineCatalog<ProjectInfo[]>(scope.key, 'projects').catch(() => undefined);
    return [...fresh, ...(cached ?? []).filter(project => retained.has(project.id) && !present.has(project.id))];
  }),

  getProject: (projectId: string) => readCatalog(`project:${projectId}`, async scope => {
    try {
      return await cloudApi.getProject(projectId, scope);
    } catch (error) {
      if (!scope || !(error instanceof ApiError) || error.status !== 404) throw error;
      if ((await unresolved(scope)).some(([, id]) => id === projectId)) {
        const copied = await readOfflineCatalog<ProjectInfo>(scope.key, `project:${projectId}`);
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
      if (!revision) {
        if (!cached) legacyOnline.add(statusKey(...key));
        return script;
      }
      legacyOnline.delete(statusKey(...key));
      const row = await editOfflineScript([...key], current => {
        if (current && (current.state !== 'synced' || current.revision !== cached?.revision)) return current;
        return { scope: scope.key, projectId, scriptId, revision, script, state: 'synced', lastSynced: Date.now() };
      });
      assertCurrent(scope);
      if (!row) return script;
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
    const scope = scopeForCloud();
    if (!isTauri()) return cloudApi.saveScript(projectId, scriptId, { content });
    if (!scope) throw new Error(t('toolbar:status.save.cloudUnavailable'));
    if (legacyOnline.has(statusKey(scope.key, projectId, scriptId))) {
      return cloudApi.saveScript(projectId, scriptId, { content }, scope);
    }
    const prepared = prepareScriptWrite({ content }).content;
    const row = await editOfflineScript([scope.key, projectId, scriptId], current => {
      if (!current) throw new Error(t('toolbar:status.save.cloudUnavailable'));
      if (!docHasAnyText(prepared) && docHasAnyText(current.script.content)) {
        throw new Error(t('toolbar:status.save.cloudProblem'));
      }
      return {
        ...current,
        script: { ...current.script, content: prepared },
        operation: uuid(),
        state: current.state === 'conflict' ? 'conflict' : 'pending',
      };
    });
    assertCurrent(scope);
    if (!row) throw new Error(t('toolbar:status.save.cloudUnavailable'));
    showStatus(row);
    if (row.state === 'pending') wakeOfflineSync();
    return row.script;
  },
};

async function upload(scope: Scope, row: OfflineScript): Promise<boolean> {
  if (!row.script.content || !scope.isCurrent()) return false;
  showStatus(row, 'syncing');
  const key: [string, string, string] = [scope.key, row.projectId, row.scriptId];
  try {
    const script = await cloudApi.uploadOfflineScript(row.projectId, row.scriptId, row.script.content, row.revision, scope);
    const revision = script.content_revision;
    if (!revision) throw new Error('Conditional upload returned no revision');
    const lastSynced = Date.now();
    const next = await editOfflineScript(key, current => {
      if (!current || current.revision !== row.revision || current.state !== 'pending') return current;
      // Another local save may have replaced the one we sent. Keep its body
      // and advance the base to the cloud revision we just wrote.
      if (current.operation !== row.operation) return { ...current, revision, lastSynced };
      return { ...current, script, revision, lastSynced, state: 'synced', operation: undefined };
    });
    if (next) showStatus(next);
    return next?.state === 'pending';
  } catch (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    const state = status === 412 || status === 404 ? 'conflict'
      : status !== undefined && status >= 400 && status < 500
        && status !== 401 && status !== 403 && status !== 408 && status !== 429 ? 'problem' : 'pending';
    const next = await editOfflineScript(key, current =>
      current?.operation === row.operation && current?.revision === row.revision && current?.state === 'pending'
        ? { ...current, state } : current);
    if (next) showStatus(next);
    return next?.state === 'pending';
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
  useSettingsStore.subscribe((state, previous) => {
    if (state.collabAuth !== previous.collabAuth) wake();
  });
  wake();
}

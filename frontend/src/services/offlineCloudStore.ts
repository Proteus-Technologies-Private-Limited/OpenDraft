import type { ProjectInfo, ScriptResponse } from './api';

export type OfflineScript = {
  scope: string;
  projectId: string;
  scriptId: string;
  revision: string;
  script: ScriptResponse;
  project?: ProjectInfo;
  state: 'synced' | 'pending' | 'conflict' | 'problem';
  operation?: string;
  inFlight?: { operation: string; content: Record<string, unknown> };
  /** The cloud's content at `revision`: the common ancestor for a three-way
   * merge when the cloud copy changed too. Absent on rows saved before merging
   * existed, which then fall back to asking about every difference. */
  base?: Record<string, unknown>;
  /** Settling a conflict by keeping one whole version first saves the other as
   * a new cloud screenplay. Recorded once that copy exists, so a retry after a
   * later step failed does not save it a second time. */
  keptCopy?: { choice: 'cloud' | 'device'; digest: string };
  lastSynced: number;
};

type ScriptKey = [scope: string, projectId: string, scriptId: string];
let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('opendraft-offline-cloud', 1);
    request.onupgradeneeded = () => {
      const scripts = request.result.createObjectStore('scripts', { keyPath: ['scope', 'projectId', 'scriptId'] });
      scripts.createIndex('queue', ['scope', 'state']);
      request.result.createObjectStore('catalog');
    };
    request.onsuccess = () => {
      const connection = request.result;
      const opened = database;
      const reset = () => { if (database === opened) database = undefined; };
      connection.onclose = reset;
      connection.onversionchange = () => {
        connection.close();
        reset();
      };
      resolve(connection);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage transaction aborted'));
  });
}

export async function readOfflineScript(key: ScriptKey): Promise<OfflineScript | undefined> {
  const db = await openDatabase();
  return result(db.transaction('scripts').objectStore('scripts').get(key));
}

export async function editOfflineScript(
  key: ScriptKey,
  change: (row: OfflineScript | undefined) => OfflineScript | undefined,
): Promise<OfflineScript | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction('scripts', 'readwrite', { durability: 'strict' });
  const done = completed(transaction);
  const table = transaction.objectStore('scripts');
  const request = table.get(key);
  let row: OfflineScript | undefined;
  let error: unknown;
  request.onsuccess = () => {
    // Keep the write in the original transaction's callback. Safari can
    // close the transaction as soon as the callback returns.
    try {
      row = change(request.result);
      if (row === undefined && request.result !== undefined) table.delete(key);
      if (row !== undefined && row !== request.result) table.put(row);
    } catch (cause) {
      error = cause;
      transaction.abort();
    }
  };
  await done.catch(cause => { throw error ?? cause; });
  return row;
}

export async function pendingOfflineScripts(scope: string): Promise<OfflineScript[]> {
  const db = await openDatabase();
  return result(db.transaction('scripts').objectStore('scripts').index('queue').getAll([scope, 'pending']));
}

export async function unresolvedOfflineScripts(scope: string): Promise<ScriptKey[]> {
  const db = await openDatabase();
  const index = db.transaction('scripts').objectStore('scripts').index('queue');
  const keys = await Promise.all(['pending', 'conflict', 'problem'].map(state => result(index.getAllKeys([scope, state]))));
  return keys.flat() as ScriptKey[];
}

export async function readOfflineCatalog<T>(scope: string, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return result(db.transaction('catalog').objectStore('catalog').get([scope, key]));
}

export async function cacheOfflineCatalog<T>(scope: string, key: string, value: T, isCurrent: () => boolean): Promise<void> {
  const db = await openDatabase();
  if (!isCurrent()) return;
  const transaction = db.transaction('catalog', 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('catalog').put(value, [scope, key]);
  return done;
}

function scopeRange(prefix: string[]): IDBKeyRange {
  return IDBKeyRange.bound(prefix, [...prefix, []]);
}

export async function removeOfflineScripts(scope: string, projectId: string, scriptId?: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(['scripts', 'catalog'], 'readwrite', { durability: 'strict' });
  const done = completed(transaction);
  transaction.objectStore('scripts').delete(scriptId ? [scope, projectId, scriptId] : scopeRange([scope, projectId]));
  const catalog = transaction.objectStore('catalog');
  const removeFromList = (key: string, id: string) => {
    const request = catalog.get([scope, key]);
    request.onsuccess = () => {
      if (Array.isArray(request.result)) catalog.put(request.result.filter(item => item.id !== id), [scope, key]);
    };
  };
  if (scriptId) {
    removeFromList(`scripts:${projectId}:false`, scriptId);
    removeFromList(`scripts:${projectId}:true`, scriptId);
  } else {
    removeFromList('projects', projectId);
    catalog.delete([scope, `project:${projectId}`]);
    catalog.delete([scope, `scripts:${projectId}:false`]);
    catalog.delete([scope, `scripts:${projectId}:true`]);
  }
  return done;
}

/** Drop downloads and the catalogue on sign-out. Keep the upload queue. */
export async function clearSyncedOfflineData(scope: string): Promise<boolean> {
  const db = await openDatabase();
  const transaction = db.transaction(['scripts', 'catalog'], 'readwrite', { durability: 'strict' });
  const done = completed(transaction);
  transaction.objectStore('catalog').delete(scopeRange([scope]));
  const request = transaction.objectStore('scripts').openCursor(scopeRange([scope]));
  let retained = false;
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    if (cursor.value.state === 'synced') cursor.delete();
    else retained = true;
    cursor.continue();
  };
  await done;
  return retained;
}

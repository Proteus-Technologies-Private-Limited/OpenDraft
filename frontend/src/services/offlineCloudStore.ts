import type { ScriptResponse } from './api';

export type OfflineScript = {
  scope: string;
  projectId: string;
  scriptId: string;
  revision: string;
  script: ScriptResponse;
  state: 'synced' | 'pending' | 'conflict' | 'problem';
  operation?: string;
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
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
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

export async function cacheOfflineCatalog<T>(scope: string, key: string, value: T): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction('catalog', 'readwrite');
  const done = completed(transaction);
  transaction.objectStore('catalog').put(value, [scope, key]);
  return done;
}

/**
 * Deleting a version from the app's SQLite store (discussion #183).
 *
 * The store keeps versions as deltas: a script unchanged since the previous
 * checkpoint is an `inherited` row with no content. These tests run the real
 * `createLocalStorage()` against Node's built-in SQLite, so the schema is the
 * one `db.ts` migrates and the SQL is the SQL the app runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

let sqlite: DatabaseSync;

/** The slice of @tauri-apps/plugin-sql the store uses, over node:sqlite. */
function adapter(conn: DatabaseSync) {
  // node:sqlite binds plain `?` by position; Tauri's `$n` may repeat or come
  // out of order, so each `$n` becomes a `?` with its value at that place.
  const bind = (sql: string, params: unknown[]) => {
    const values: unknown[] = [];
    const text = sql.replace(/\$(\d+)/g, (_m, n: string) => { values.push(params[Number(n) - 1]); return '?'; });
    return { stmt: conn.prepare(text), values: values as never[] };
  };
  return {
    execute: async (sql: string, params: unknown[] = []) => {
      const { stmt, values } = bind(sql, params);
      const r = stmt.run(...values);
      return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    select: async <T,>(sql: string, params: unknown[] = []) => {
      const { stmt, values } = bind(sql, params);
      return stmt.all(...values) as T;
    },
  };
}

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => adapter(sqlite) },
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: async () => {}, writeFile: async () => {}, readFile: async () => new Uint8Array(),
  remove: async () => {}, exists: async () => true, BaseDirectory: { AppData: 0 },
}));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: async () => null }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => '/tmp/opendraft-test' }));

const PROJECT = 'p1';
let clock = Date.parse('2026-01-01T00:00:00Z');

async function setup() {
  vi.resetModules();
  sqlite = new DatabaseSync(':memory:');
  const { createLocalStorage } = await import('./local-storage');
  const storage = await createLocalStorage();
  const db = adapter(sqlite);
  const ts = new Date(clock).toISOString();
  await db.execute(
    'INSERT INTO projects (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)',
    [PROJECT, 'Test', ts, ts],
  );
  for (const id of ['a', 'b']) {
    await db.execute(
      'INSERT INTO scripts (id, project_id, title, size_bytes, created_at, updated_at) VALUES ($1, $2, $3, 0, $4, $4)',
      [id, PROJECT, id.toUpperCase(), ts],
    );
    await db.execute('INSERT INTO script_content (script_id, content) VALUES ($1, $2)', [id, '']);
  }
  const write = (id: string, text: string) =>
    db.execute('UPDATE script_content SET content = $1 WHERE script_id = $2', [JSON.stringify({ text }), id]);
  /** Each checkpoint a minute apart, so their order never rests on a tie. */
  const checkin = async (msg: string) => {
    clock += 60_000;
    vi.setSystemTime(clock);
    return storage.checkin(PROJECT, msg);
  };
  const textAt = async (hash: string, id: string) =>
    ((await storage.getScriptAtVersion(PROJECT, hash, id)).content as { text: string }).text;
  return { storage, write, checkin, textAt };
}

describe('local storage deleteVersion', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });

  it('keeps later versions that inherited content from the deleted one', async () => {
    const { storage, write, checkin, textAt } = await setup();
    await write('a', 'a1'); await write('b', 'b1');
    const v1 = await checkin('one');
    await write('a', 'a2'); // b unchanged → inherited from v1
    const v2 = await checkin('two');
    const v3 = await checkin('three'); // both inherited

    await storage.deleteVersion(PROJECT, v1.hash);

    const left = (await storage.getVersions(PROJECT)).map((v) => v.message);
    expect(left).toEqual(['three', 'two']);
    expect(await textAt(v2.hash, 'b')).toBe('b1');
    expect(await textAt(v3.hash, 'b')).toBe('b1');
    expect(await textAt(v3.hash, 'a')).toBe('a2');
  });

  it('deleting a middle version does not change its neighbours', async () => {
    const { storage, write, checkin, textAt } = await setup();
    await write('a', 'x1'); const v1 = await checkin('one');
    await write('a', 'x2'); const v2 = await checkin('two');
    const v3 = await checkin('three'); // inherits x2 from v2

    await storage.deleteVersion(PROJECT, v2.hash);

    expect(await textAt(v1.hash, 'a')).toBe('x1');
    expect(await textAt(v3.hash, 'a')).toBe('x2');
    await expect(storage.getScriptAtVersion(PROJECT, v2.hash, 'a')).rejects.toThrow();
  });

  it('refuses an unknown version', async () => {
    const { storage } = await setup();
    await expect(storage.deleteVersion(PROJECT, 'nope')).rejects.toThrow(/not found/i);
  });
});

/**
 * CPU and memory used by each OpenDraft component on this machine.
 *
 * The collab server measures itself exactly. The other components (the Python
 * backend, the Vite dev server, PostgreSQL when it is the collab database) are
 * separate processes, found by scanning the process table. A component that is
 * not running on this host — a separate container, say — is reported as not
 * found rather than as zero.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../config';
import { getDB } from '../db';
import * as liveStats from './liveStats';

const execFileAsync = promisify(execFile);
const CACHE_MS = 5_000;
const DIR_CACHE_MS = 30_000;
const CLOCK_TICKS_PER_SEC = 100; // USER_HZ; 100 on every mainstream Linux

export interface ComponentUsage {
  key: string;
  label: string;
  found: boolean;
  processes: number;
  /** Share of the whole machine's CPU, 0-100. */
  cpuPct: number;
  rssMb: number;
  note: string;
}

interface PsRow { pid: number; ppid: number; pcpu: number; rssKb: number; command: string }

const MATCHERS: { key: string; label: string; test: (cmd: string) => boolean; enabled: boolean }[] = [
  {
    key: 'backend',
    label: 'Python backend (API)',
    test: c => /uvicorn|gunicorn|app\.main|opendraft-api|desktop_entry/i.test(c),
    enabled: true,
  },
  {
    key: 'frontend',
    label: 'Frontend dev server (Vite)',
    test: c => /node_modules\/\.bin\/vite|\bvite\b.*(dev|serve|--)|\/vite\.js/i.test(c),
    enabled: true,
  },
  {
    key: 'postgres',
    label: 'PostgreSQL (collab database)',
    test: c => /\bpostgres\b/i.test(c),
    enabled: config.dbType === 'postgresql',
  },
];

let psCache: { at: number; rows: PsRow[] | null } = { at: 0, rows: null };
let prevTicks = new Map<number, { ticks: number; at: number }>();

/** Linux: read /proc directly. Slim container images ship without `ps`. */
async function readProcTable(): Promise<PsRow[]> {
  const page = 4096;
  const rows: PsRow[] = [];
  for (const name of await fs.promises.readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const [cmdline, statm, stat] = await Promise.all([
        fs.promises.readFile(`/proc/${name}/cmdline`, 'utf8'),
        fs.promises.readFile(`/proc/${name}/statm`, 'utf8'),
        fs.promises.readFile(`/proc/${name}/stat`, 'utf8'),
      ]);
      const command = cmdline.replace(/\0+/g, ' ').trim();
      if (!command) continue; // kernel thread
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      rows.push({ pid: +name, ppid: +f[1], pcpu: 0, rssKb: (Number(statm.split(' ')[1]) * page) / 1024, command });
    } catch { /* process exited while we read it, or not ours to read */ }
  }
  return rows;
}

async function readProcessTable(): Promise<PsRow[] | null> {
  if (Date.now() - psCache.at < CACHE_MS) return psCache.rows;
  let rows: PsRow[] | null = null;
  if (process.platform === 'linux') {
    try {
      rows = await readProcTable();
    } catch (err) {
      console.warn('[componentStats] could not read /proc:', (err as Error).message);
    }
    psCache = { at: Date.now(), rows };
    return rows;
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,command='], {
      timeout: 3000,
      maxBuffer: 8 * 1024 * 1024,
    });
    rows = [];
    for (const line of stdout.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+([\d.,]+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m) rows.push({ pid: +m[1], ppid: +m[2], pcpu: parseFloat(m[3].replace(',', '.')), rssKb: +m[4], command: m[5] });
    }
  } catch (err) {
    console.warn('[componentStats] could not read the process table:', (err as Error).message);
  }
  psCache = { at: Date.now(), rows };
  return rows;
}

/** CPU % of ONE core for a pid. Linux: delta of /proc ticks (ps only gives a
 *  lifetime average there). Elsewhere: ps's own recent-usage figure. */
function cpuOfCore(row: PsRow): number {
  if (process.platform !== 'linux') return row.pcpu;
  try {
    const stat = fs.readFileSync(`/proc/${row.pid}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = parseInt(f[11], 10) + parseInt(f[12], 10); // utime + stime
    const now = Date.now();
    const prev = prevTicks.get(row.pid);
    prevTicks.set(row.pid, { ticks, at: now });
    if (!prev || now <= prev.at) return 0;
    return ((ticks - prev.ticks) / CLOCK_TICKS_PER_SEC / ((now - prev.at) / 1000)) * 100;
  } catch {
    return row.pcpu;
  }
}

async function dirStats(dir: string, filter: (name: string) => boolean): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  try {
    for (const name of await fs.promises.readdir(dir)) {
      if (!filter(name)) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, name));
        if (st.isFile()) { files++; bytes += st.size; }
      } catch { /* file vanished between readdir and stat */ }
    }
  } catch (err) {
    console.warn('[componentStats] could not read', dir, (err as Error).message);
  }
  return { files, bytes };
}

/** Tables we count rows in. Fixed names, so nothing user-supplied reaches SQL. */
const COUNTED_TABLES = ['users', 'refresh_tokens', 'user_devices', 'audit_log', 'collab_sessions',
  'email_verifications', 'device_challenges', 'password_resets'];

let dbCache: { at: number; value: any } | null = null;

/** Size of the configured collab database, in total and per table. */
async function databaseUsage() {
  if (dbCache && Date.now() - dbCache.at < DIR_CACHE_MS) return dbCache.value;
  const mb = (bytes: number) => Math.round((bytes / 1048576) * 100) / 100;
  const sizes = new Map<string, number>();
  let totalBytes = 0;
  let name = '';
  const notes: string[] = [];

  try {
    const db = getDB();
    if (config.dbType === 'postgresql') {
      const t = await db.get<{ bytes: string | number; name: string }>(
        'SELECT pg_database_size(current_database()) AS bytes, current_database() AS name');
      totalBytes = Number(t?.bytes ?? 0);
      name = t?.name ?? config.dbName;
      const rows = await db.all<{ name: string; bytes: string | number }>(
        `SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'`);
      rows.forEach(r => sizes.set(r.name, Number(r.bytes)));
    } else {
      name = 'collab.sqlite3';
      // File size, WAL and shared-memory file included: that is what is on disk.
      totalBytes = (await dirStats(config.dataDir, n => /^collab\.sqlite3(-wal|-shm)?$/.test(n))).bytes;
      try {
        const rows = await getDB().all<{ name: string; bytes: number }>(
          `SELECT m.tbl_name AS name, SUM(d.pgsize) AS bytes
             FROM dbstat d JOIN sqlite_master m ON m.name = d.name GROUP BY m.tbl_name`);
        rows.forEach(r => sizes.set(r.name, Number(r.bytes)));
      } catch {
        notes.push('per-table sizes unavailable: this SQLite build has no dbstat');
      }
    }
  } catch (err) {
    console.warn('[componentStats] could not read database size:', (err as Error).message);
    notes.push('could not read the database size: ' + (err as Error).message);
  }

  const tables: { name: string; sizeMb: number | null; rows: number | null }[] = [];
  for (const table of COUNTED_TABLES) {
    let rows: number | null = null;
    try {
      const r = await getDB().get<{ c: string | number }>(`SELECT COUNT(*) AS c FROM ${table}`);
      rows = Number(r?.c ?? 0);
    } catch { /* table missing on an older schema */ }
    tables.push({ name: table, sizeMb: sizes.has(table) ? mb(sizes.get(table)!) : null, rows });
  }
  tables.sort((a, b) => (b.sizeMb ?? -1) - (a.sizeMb ?? -1) || (b.rows ?? 0) - (a.rows ?? 0));

  const value = {
    type: config.dbType,
    name,
    host: config.dbType === 'postgresql' ? `${config.dbHost}:${config.dbPort}` : null,
    totalMb: mb(totalBytes),
    tables,
    notes,
  };
  dbCache = { at: Date.now(), value };
  return value;
}

let diskCache: { at: number; value: any } | null = null;

async function storage() {
  if (diskCache && Date.now() - diskCache.at < DIR_CACHE_MS) return diskCache.value;
  const docs = await dirStats(config.dataDir, n => n.endsWith('.yjs'));
  let disk: { totalGb: number; freeGb: number } | null = null;
  try {
    const s = await fs.promises.statfs(config.dataDir);
    disk = { totalGb: (s.blocks * s.bsize) / 1e9, freeGb: (s.bavail * s.bsize) / 1e9 };
  } catch { /* statfs unavailable */ }
  const value = {
    documentFiles: docs.files,
    documentsMb: Math.round((docs.bytes / 1048576) * 10) / 10,
    diskTotalGb: disk ? Math.round(disk.totalGb * 10) / 10 : null,
    diskFreeGb: disk ? Math.round(disk.freeGb * 10) / 10 : null,
  };
  diskCache = { at: Date.now(), value };
  return value;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function collectComponents(loadedDocuments: number) {
  const sys = liveStats.systemSnapshot();
  const cores = Math.max(0.01, sys.cpuCount);
  const mem = process.memoryUsage();

  const components: ComponentUsage[] = [{
    key: 'collab',
    label: 'Collab server (this process)',
    found: true,
    processes: 1,
    cpuPct: sys.procCpuPct,
    rssMb: Math.round(mem.rss / 1048576),
    note: `pid ${process.pid}`,
  }];

  const table = await readProcessTable();
  const claimed = new Set<number>([process.pid]);
  for (const m of MATCHERS) {
    if (!m.enabled) continue;
    if (!table) {
      components.push({ key: m.key, label: m.label, found: false, processes: 0, cpuPct: 0, rssMb: 0, note: 'process table unavailable on this host' });
      continue;
    }
    const rows = table.filter(r => !claimed.has(r.pid) && !/\bps -axo\b/.test(r.command) && m.test(r.command));
    rows.forEach(r => claimed.add(r.pid));
    const cpuCore = rows.reduce((a, r) => a + cpuOfCore(r), 0);
    components.push({
      key: m.key,
      label: m.label,
      found: rows.length > 0,
      processes: rows.length,
      cpuPct: r1(cpuCore / cores),
      rssMb: Math.round(rows.reduce((a, r) => a + r.rssKb, 0) / 1024),
      note: rows.length ? `pid ${rows.slice(0, 3).map(r => r.pid).join(', ')}${rows.length > 3 ? '…' : ''}` : 'not running on this host',
    });
  }
  // Forget pids that have gone so the Linux tick table cannot grow forever.
  if (table && prevTicks.size > 500) prevTicks = new Map();

  const store = await storage();
  const database = await databaseUsage();
  return {
    database,
    components,
    collabInternals: {
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
      externalMb: Math.round(mem.external / 1048576),
      arrayBuffersMb: Math.round(mem.arrayBuffers / 1048576),
      loadedDocuments,
      ...store,
    },
  };
}

/**
 * In-process runtime statistics for the admin console.
 *
 * Everything here is held in memory and starts empty on every restart — it is
 * a window onto the running process, not a record. Durable history (logins,
 * refreshes, failures) lives in the audit_log table.
 */
import * as os from 'os';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { monitorEventLoopDelay } from 'perf_hooks';

const SAMPLE_INTERVAL_MS = 10_000;
/** 360 samples x 10 s = the last hour. */
const HISTORY_LENGTH = 360;
const MAX_REFRESH_FAILURES = 200;

export interface Sample {
  t: number;
  /** Whole-machine CPU busy, 0-100. */
  cpu: number;
  /** This process's CPU as a share of the whole machine, 0-100. */
  procCpu: number;
  /** Machine RAM in use, 0-100. */
  memPct: number;
  /** Resident memory of this process, MB. */
  rssMb: number;
  /** Event-loop delay (p99), ms. A loop that stalls makes every client hang. */
  loopLagMs: number;
  /** Live WebSocket connections. */
  ws: number;
  /** Requests per second over the sample window. */
  rps: number;
}

export interface LiveConnection {
  socketId: string;
  userId: string | null;
  name: string;
  email: string | null;
  role: string;
  document: string;
  projectId: string;
  scriptId: string;
  ip: string;
  since: number;
}

export interface RefreshFailure {
  at: number;
  reason: string;
  ip: string;
}

const history: Sample[] = [];
const connections = new Map<string, LiveConnection>();
const refreshFailures: RefreshFailure[] = [];
/** userId -> last time we saw an authenticated request or refresh from them. */
const lastSeen = new Map<string, number>();

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
let prevCpuTimes = cpuTotals();
let prevProcUsage = process.cpuUsage();
let prevSampleAt = Date.now();
let requestsInWindow = 0;
let timer: NodeJS.Timeout | null = null;

let documentCountProvider: () => number = () => 0;
export function setDocumentCountProvider(fn: () => number): void { documentCountProvider = fn; }
export function loadedDocumentCount(): number {
  try { return documentCountProvider(); } catch { return 0; }
}

const totals = { requests: 0, errors5xx: 0, errors4xx: 0, latencyMsSum: 0 };

/**
 * Memory the OS could hand out right now. os.freemem() leaves out reclaimable
 * cache, so a healthy machine reads as ~100% used: Linux has MemAvailable for
 * this, macOS needs vm_stat. Falls back to os.freemem() anywhere else.
 */
function availableMemBytes(): number {
  try {
    if (process.platform === 'linux') {
      const m = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
      if (m) return parseInt(m[1], 10) * 1024;
    } else if (process.platform === 'darwin') {
      const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
      const page = parseInt(/page size of (\d+) bytes/.exec(out)?.[1] || '16384', 10);
      const pages = (label: string) => parseInt(new RegExp(`${label}:\\s+(\\d+)`).exec(out)?.[1] || '0', 10);
      const avail = pages('Pages free') + pages('Pages inactive') + pages('Pages speculative') + pages('Pages purgeable');
      if (avail > 0) return avail * page;
    }
  } catch (err) {
    console.warn('[liveStats] could not read available memory, using os.freemem():', (err as Error).message);
  }
  return os.freemem();
}

/**
 * The container's own limits and usage, when the process runs under a cgroup
 * that is tighter than the host. Inside Docker or Cloud Run, os.totalmem() and
 * /proc/meminfo describe the host, so a container about to be killed for
 * memory can look nearly empty. cgroup v2 first, then v1.
 */
interface CgroupView { memLimit: number | null; memUsed: number | null; cpuCores: number | null; cpuUsageUsec: number | null }

function readNum(file: string): number | null {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw === 'max' || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function statField(file: string, key: string): number | null {
  try {
    const m = new RegExp('^' + key + ' (\\d+)$', 'm').exec(fs.readFileSync(file, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

function readCgroup(): CgroupView | null {
  if (process.platform !== 'linux') return null;
  try {
    const v2 = '/sys/fs/cgroup';
    if (fs.existsSync(v2 + '/cgroup.controllers')) {
      let cpuCores: number | null = null;
      try {
        const [quota, period] = fs.readFileSync(v2 + '/cpu.max', 'utf8').trim().split(/\s+/);
        if (quota !== 'max' && Number(period) > 0) cpuCores = Number(quota) / Number(period);
      } catch { /* no cpu controller */ }
      const current = readNum(v2 + '/memory.current');
      const inactive = statField(v2 + '/memory.stat', 'inactive_file') ?? 0;
      return {
        memLimit: readNum(v2 + '/memory.max'),
        // Same as `docker stats`: page cache the kernel can drop is not "used".
        memUsed: current === null ? null : Math.max(0, current - inactive),
        cpuCores,
        cpuUsageUsec: statField(v2 + '/cpu.stat', 'usage_usec'),
      };
    }
    const v1 = '/sys/fs/cgroup';
    const limit = readNum(v1 + '/memory/memory.limit_in_bytes');
    const usage = readNum(v1 + '/memory/memory.usage_in_bytes');
    const inactive = statField(v1 + '/memory/memory.stat', 'total_inactive_file') ?? 0;
    const quota = readNum(v1 + '/cpu/cpu.cfs_quota_us');
    const period = readNum(v1 + '/cpu/cpu.cfs_period_us');
    const usageNs = readNum(v1 + '/cpuacct/cpuacct.usage');
    return {
      // v1 reports "unlimited" as a huge number.
      memLimit: limit !== null && limit < 2 ** 60 ? limit : null,
      memUsed: usage === null ? null : Math.max(0, usage - inactive),
      cpuCores: quota !== null && quota > 0 && period ? quota / period : null,
      cpuUsageUsec: usageNs === null ? null : usageNs / 1000,
    };
  } catch (err) {
    console.warn('[liveStats] could not read cgroup limits:', (err as Error).message);
    return null;
  }
}

/** What the CPU and RAM figures describe: the container, when it is capped
 *  below the host, otherwise the whole machine. */
function scope() {
  const hostCores = Math.max(1, os.cpus().length);
  const hostMem = os.totalmem();
  const cg = readCgroup();
  const memCapped = !!(cg?.memLimit && cg.memLimit < hostMem && cg.memUsed !== null);
  const cpuCapped = !!(cg?.cpuCores && cg.cpuCores < hostCores && cg.cpuUsageUsec !== null);
  return {
    kind: (memCapped || cpuCapped ? 'container' : 'machine') as 'container' | 'machine',
    cores: cpuCapped ? cg!.cpuCores! : hostCores,
    memTotal: memCapped ? cg!.memLimit! : hostMem,
    memUsed: memCapped ? cg!.memUsed! : hostMem - availableMemBytes(),
    cgroupCpuUsec: cpuCapped ? cg!.cpuUsageUsec : null,
    hostCores,
    hostMem,
  };
}

let prevCgroupUsec: number | null = null;

function cpuTotals(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function takeSample(): void {
  try {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - prevSampleAt);

    const sc = scope();
    const cur = cpuTotals();
    const dTotal = cur.total - prevCpuTimes.total;
    const dIdle = cur.idle - prevCpuTimes.idle;
    let cpu = dTotal > 0 ? (1 - dIdle / dTotal) * 100 : 0;
    prevCpuTimes = cur;
    if (sc.cgroupCpuUsec !== null) {
      // Container capped below the host: busy share of the container's quota.
      cpu = prevCgroupUsec === null ? 0
        : Math.min(100, ((sc.cgroupCpuUsec - prevCgroupUsec) / (elapsedMs * 1000 * sc.cores)) * 100);
      prevCgroupUsec = sc.cgroupCpuUsec;
    }

    const usage = process.cpuUsage();
    const procMicros = usage.user - prevProcUsage.user + (usage.system - prevProcUsage.system);
    const capacityMicros = elapsedMs * 1000 * sc.cores;
    const procCpu = (procMicros / capacityMicros) * 100;
    prevProcUsage = usage;

    const memPct = sc.memTotal > 0 ? (sc.memUsed / sc.memTotal) * 100 : 0;
    const loopLagMs = loopDelay.percentile(99) / 1e6;
    loopDelay.reset();

    history.push({
      t: now,
      cpu: round1(cpu),
      procCpu: round1(procCpu),
      memPct: round1(memPct),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
      loopLagMs: round1(Number.isFinite(loopLagMs) ? loopLagMs : 0),
      ws: connections.size,
      rps: round1(requestsInWindow / (elapsedMs / 1000)),
    });
    if (history.length > HISTORY_LENGTH) history.shift();
    requestsInWindow = 0;
    prevSampleAt = now;
  } catch (err) {
    console.error('[liveStats] sampling failed:', err);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function startSampling(): void {
  if (timer) return;
  loopDelay.enable();
  takeSample();
  timer = setInterval(takeSample, SAMPLE_INTERVAL_MS);
  timer.unref();
}

export function getHistory(): Sample[] {
  return history.slice();
}

export function recordRequest(status: number, durationMs: number): void {
  requestsInWindow++;
  totals.requests++;
  totals.latencyMsSum += durationMs;
  if (status >= 500) totals.errors5xx++;
  else if (status >= 400) totals.errors4xx++;
}

export function requestTotals() {
  return {
    requests: totals.requests,
    errors4xx: totals.errors4xx,
    errors5xx: totals.errors5xx,
    avgLatencyMs: totals.requests ? round1(totals.latencyMsSum / totals.requests) : 0,
  };
}

export function addConnection(conn: LiveConnection): void {
  connections.set(conn.socketId, conn);
  if (conn.userId) lastSeen.set(conn.userId, Date.now());
}

export function removeConnection(socketId: string): void {
  connections.delete(socketId);
}

export function listConnections(): LiveConnection[] {
  return Array.from(connections.values());
}

export function touchUser(userId: string): void {
  lastSeen.set(userId, Date.now());
  // Keep the map bounded on a long-running server.
  if (lastSeen.size > 20_000) {
    const cutoff = Date.now() - 24 * 3600_000;
    for (const [id, at] of lastSeen) if (at < cutoff) lastSeen.delete(id);
  }
}

export function lastSeenAt(userId: string): number | null {
  return lastSeen.get(userId) ?? null;
}

export function recordRefreshFailure(reason: string, ip: string): void {
  refreshFailures.unshift({ at: Date.now(), reason, ip });
  if (refreshFailures.length > MAX_REFRESH_FAILURES) refreshFailures.pop();
}

export function recentRefreshFailures(): RefreshFailure[] {
  return refreshFailures.slice();
}

export function systemSnapshot() {
  const mem = process.memoryUsage();
  const sc = scope();
  const total = sc.memTotal;
  const free = Math.max(0, sc.memTotal - sc.memUsed);
  const latest = history[history.length - 1];
  return {
    scope: sc.kind,
    hostCores: sc.hostCores,
    hostMemMb: Math.round(sc.hostMem / 1048576),
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    cpuCount: Math.round(sc.cores * 100) / 100,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    loadAvg: os.loadavg().map(round1),
    cpuPct: latest?.cpu ?? 0,
    procCpuPct: latest?.procCpu ?? 0,
    loopLagMs: latest?.loopLagMs ?? 0,
    memTotalMb: Math.round(total / 1048576),
    memUsedMb: Math.round((total - free) / 1048576),
    memPct: total > 0 ? round1(((total - free) / total) * 100) : 0,
    process: {
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
    },
  };
}

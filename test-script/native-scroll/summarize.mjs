import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeTrace(events) {
  const byType = {};
  function visit(record) {
    if (Number.isFinite(record.endTime)) {
      const durationMs = (record.endTime - record.startTime) * 1000;
      const group = (byType[record.type] ??= { count: 0, inclusiveMs: 0, maxMs: 0 });
      group.count++;
      group.inclusiveMs += durationMs;
      group.maxMs = Math.max(group.maxMs, durationMs);
    }
    for (const child of record.children ?? []) visit(child);
  }
  for (const event of events) {
    if (event.method === 'Timeline.eventRecorded') visit(event.params.record);
  }
  const samples = events.find((e) => e.method === 'ScriptProfiler.trackingComplete');
  assert(samples?.params.timestamp > 0, 'WebKit native clock did not run (enable Page)');
  for (const group of Object.values(byType)) {
    group.inclusiveMs = Math.round(group.inclusiveMs * 100) / 100;
    group.maxMs = Math.round(group.maxMs * 100) / 100;
  }
  return { byType, scriptSamples: samples.params.samples?.stackTraces.length ?? 0 };
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeReport(report) {
  const groups = new Map();
  for (const phase of report.results.filter((r) => !r.profiling)) {
    const { navigator, spellcheck, shadow = 'default' } = phase.config;
    const key = JSON.stringify({ navigator, spellcheck, shadow, direction: phase.direction });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(phase);
  }
  return [...groups].map(([key, phases]) => ({
    ...JSON.parse(key),
    phases: phases.length,
    p95FrameMsRange: [
      Math.min(...phases.map((p) => p.frameMs.p95)),
      Math.max(...phases.map((p) => p.frameMs.p95)),
    ],
    webCpuMsMedian: median(
      phases.map((p) =>
        p.cpu.filter((c) => c.name.startsWith('WebKitWeb')).reduce((sum, c) => sum + c.cpuMs, 0),
      ),
    ),
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outputs = process.argv.slice(2).map((directory) => {
    const report = JSON.parse(readFileSync(join(directory, 'report.json')));
    const traces = readdirSync(directory)
      .filter((name) => /^trace-.*\.json$/.test(name))
      .sort()
      .map((name) => {
        const bytes = readFileSync(join(directory, name));
        return {
          file: name,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          ...summarizeTrace(JSON.parse(bytes)),
        };
      });
    return { run: basename(directory), groups: summarizeReport(report), traces };
  });
  console.log(JSON.stringify(outputs, null, 2));
}

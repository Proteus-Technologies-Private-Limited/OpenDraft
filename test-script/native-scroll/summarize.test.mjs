import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeTrace, summarizeReport } from './summarize.mjs';

test('native trace summary retains inclusive types without double-counting them as CPU', () => {
  const summary = summarizeTrace([
    {
      method: 'Timeline.eventRecorded',
      params: {
        record: {
          type: 'RenderingFrame',
          startTime: 1,
          endTime: 1.02,
          children: [
            { type: 'Paint', startTime: 1.002, endTime: 1.018 },
            { type: 'RequestAnimationFrame', startTime: 1.019 },
          ],
        },
      },
    },
    {
      method: 'ScriptProfiler.trackingComplete',
      params: { timestamp: 2, samples: { stackTraces: [{}, {}] } },
    },
  ]);
  assert.deepEqual(summary.byType.Paint, { count: 1, inclusiveMs: 16, maxMs: 16 });
  assert.equal(summary.byType.RenderingFrame.inclusiveMs, 20);
  assert.equal(summary.byType.RequestAnimationFrame, undefined);
  assert.equal(summary.scriptSamples, 2);
});

test('zero-clock profiles are rejected instead of being reported as no paint cost', () => {
  assert.throws(
    () => summarizeTrace([{ method: 'ScriptProfiler.trackingComplete', params: { timestamp: 0 } }]),
    /clock did not run/,
  );
});

test('profiled phases do not enter the timing comparison and directions stay separate', () => {
  const row = (direction, p95, cpuMs, profiling = false) => ({
    config: { navigator: true, spellcheck: true },
    direction,
    profiling,
    frameMs: { p95 },
    cpu: [{ name: 'WebKitWebProces', cpuMs }],
  });
  const groups = summarizeReport({
    results: [
      row('down', 20, 3000),
      row('up', 50, 3500),
      row('down', 30, 3200),
      row('down', 999, 99999, true),
    ],
  });
  assert.deepEqual(groups[0].p95FrameMsRange, [20, 30]);
  assert.equal(groups[0].phases, 2);
  assert.equal(groups[0].webCpuMsMedian, 3100);
  assert.equal(groups[1].direction, 'up');
  assert.equal(groups[1].webCpuMsMedian, 3500);
});

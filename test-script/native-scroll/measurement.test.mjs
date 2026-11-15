import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { startMeasurement, stopMeasurement } from './measurement.mjs';

function webview() {
  let id = 0;
  const callbacks = new Map();
  const listeners = new Map();
  const scroller = {
    scrollTop: 5000,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };
  const original = {};
  const benchmark = {
    editor: {
      state: {
        doc: { eq: (other) => other === original },
        selection: { from: 1, to: 1 },
      },
    },
    documentBefore: original,
    selection: { from: 1, to: 1 },
  };
  const context = {
    window: { __nativeBench: benchmark },
    document: {
      querySelector: () => scroller,
      querySelectorAll: () => [],
      visibilityState: 'visible',
      hasFocus: () => true,
    },
    performance: { now: () => 42 },
    requestAnimationFrame(fn) {
      callbacks.set(++id, fn);
      return id;
    },
    cancelAnimationFrame(key) {
      callbacks.delete(key);
    },
  };
  return {
    benchmark,
    listeners,
    callbacks,
    scroller,
    run: (fn) => runInNewContext(`(${fn.toString()})()`, context),
    tick(time) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const fn of pending) fn(time);
    },
  };
}

test('consecutive phases cannot accumulate rAF loops or contaminate frame intervals', () => {
  const page = webview();
  page.run(startMeasurement);
  page.tick(10);
  page.tick(26);
  page.tick(42);
  const first = page.run(stopMeasurement);
  assert.equal(first.frameCount, 2);
  assert.equal(first.frameMs.median, 16);
  assert.equal(page.callbacks.size, 0);
  assert.equal(page.listeners.get('wheel').size, 0);
  assert.equal(page.listeners.get('scroll').size, 0);
  page.run(startMeasurement);
  assert.equal(page.callbacks.size, 1);
  page.tick(100);
  page.tick(120);
  const second = page.run(stopMeasurement);
  assert.equal(second.frameCount, 1);
  assert.equal(second.frameMs.median, 20);
  assert.equal(page.callbacks.size, 0);
  assert(first.documentIntact && second.selectionIntact);
});

test('restarting an interrupted phase cancels callbacks and removes old listeners', () => {
  const page = webview();
  page.run(startMeasurement);
  const oldCallback = [...page.callbacks.values()][0];
  page.run(startMeasurement);
  assert.equal(page.callbacks.size, 1);
  assert.equal(page.listeners.get('wheel').size, 1);
  assert.equal(page.listeners.get('scroll').size, 1);
  oldCallback(0); // Even an already-dispatched callback must stop.
  assert.equal(page.callbacks.size, 1);
  assert.equal(page.benchmark.measure.frames.length, 0);
  page.run(stopMeasurement);
  assert.equal(page.callbacks.size, 0);
});

test('native event provenance and immutable document/selection checks survive stopping', () => {
  const page = webview();
  page.run(startMeasurement);
  const wheel = [...page.listeners.get('wheel')][0];
  const target = { closest: () => true };
  wheel({ target, isTrusted: true, deltaY: 93 });
  wheel({ target, isTrusted: false, deltaY: 10 });
  page.scroller.scrollTop += 93;
  page.benchmark.editor.state.selection.from = 2;
  const result = page.run(stopMeasurement);
  assert.equal(result.wheelEvents, 2);
  assert.equal(result.trustedWheels, 1);
  assert.equal(result.wheelDelta, 103);
  assert.equal(result.distance, 93);
  assert.equal(result.documentIntact, true);
  assert.equal(result.selectionIntact, false);
  page.run(stopMeasurement); // Cleanup is idempotent.
});

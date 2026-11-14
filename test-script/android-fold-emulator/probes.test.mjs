import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { finishKeyboardPreparation, stopWatchingPendingReflows, watchPendingReflows } from './probes.mjs';

const invoke = (fn, globals) => runInNewContext(`(${fn.toString()})()`, globals);

test('restore the append caret after a native tap places it inside wrapped text', () => {
  const text = 'Synthetic wrapped writing-pad paragraph. '.repeat(12);
  const area = { value: text, readOnly: false, selectionStart: 70, selectionEnd: 70,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  const state = { area, expectedPad: text, padFrom: text.length, padTo: text.length };
  const globals = { document: { querySelector: () => area, activeElement: area }, window: { __foldTest: state } };
  assert(invoke(finishKeyboardPreparation, globals));
  assert.equal(area.value, text);
  assert.equal(area.selectionStart, text.length);
  assert.equal(area.selectionEnd, text.length);
  assert.equal(state.padFrom, text.length);
  assert.equal(state.padTo, text.length);
  globals.document.activeElement = {};
  assert(!invoke(finishKeyboardPreparation, globals), 'A missed tap must not be hidden by forcing focus');
  globals.document.activeElement = area;
  area.value = 'Unexpected native key';
  assert(!invoke(finishKeyboardPreparation, globals), 'A tap must not silently change the expected draft');
});

test('lifecycle evidence records pending reflows and stops observing after resume', () => {
  let native = { active: true, status: 'available' };
  const win = Object.assign(new EventTarget(), { __foldTest: {},
    OpenDraftAndroidFold: { snapshot: () => JSON.stringify(native) } });
  const globals = { window: win };
  invoke(watchPendingReflows, globals);
  win.dispatchEvent(new Event('opendraft:beforefoldchange'));
  assert.equal(win.__foldTest.pendingReflows.length, 0);
  native = { active: false, status: 'pending' };
  win.dispatchEvent(new Event('opendraft:beforefoldchange'));
  assert.equal(win.__foldTest.pendingReflows.length, 1);
  assert.equal(win.__foldTest.pendingReflows[0].active, false);
  invoke(stopWatchingPendingReflows, globals);
  win.dispatchEvent(new Event('opendraft:beforefoldchange'));
  assert.equal(win.__foldTest.pendingReflows.length, 1);
});

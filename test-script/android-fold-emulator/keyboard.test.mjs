import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stableControlPoint } from './keyboard.mjs';

test('native taps wait for scroll and IME geometry to settle, including lost hit targets', async () => {
  const points = [{ x: 50, y: 90 }, { x: 50, y: 65 }, false, { x: 50, y: 60 }, { x: 50, y: 60 }];
  let reads = 0;
  assert.deepEqual(await stableControlPoint('toggle', () => points[reads++]), { x: 50, y: 60 });
  assert.equal(reads, 5);
});

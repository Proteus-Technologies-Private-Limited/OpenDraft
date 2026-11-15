import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tableReadChecks } from './tableRead.mjs';

test('startup failure leaves the app alive for the outer runner to capture diagnostics', async () => {
  const commands = [];
  await assert.rejects(tableReadChecks({
    client: { evaluate: async () => { throw new Error('synthetic startup failure'); } },
    shell: (...args) => { commands.push(args); return 'No active sessions'; },
    startMain() {}, capture() {},
  }), /synthetic startup failure[\s\S]*Table Read evidence/);
  assert(commands.some(args => args[0] === 'dumpsys' && args[1] === 'media_session'));
  assert(!commands.some(args => args[0] === 'am' && args[1] === 'force-stop'));
});

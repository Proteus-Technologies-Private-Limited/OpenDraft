import assert from 'node:assert/strict';
import { displayInputPoint, imeShown, waitFor, windowInputFrame } from './protocol.mjs';
import * as probes from './probes.mjs';

/** Actual IME and ADB taps, after the original fold/retention scenario. */
export async function keyboardPlacementChecks({ client, shell, capture, pkg }) {
  const evidence = { phases: [] };
  const record = (phase, data) => { evidence.phases.push({ phase, ...data }); console.log(`keyboard-placement ${phase}: ${JSON.stringify(data)}`); };
  const frame = () => windowInputFrame(shell('dumpsys', 'window', '-a', 'windows'), `${pkg}/${pkg}.MainActivity`);
  async function tap(control) {
    // scrollIntoView changes the DOM rect synchronously; Android's compositor
    // can still display/hit-test the preceding scroll frame. Require the same
    // reachable point on consecutive observations before sending an ADB tap.
    const point = await stableControlPoint(control, () => client.evaluate(probes.keyboardControlPoint, control));
    const p = displayInputPoint(point, frame());
    record(`tap-${control}`, { ...point, displayId: p.displayId });
    shell('input', '-d', String(p.displayId), 'tap', String(p.x), String(p.y));
    return point;
  }
  await waitFor('keyboard-enabled field', () => client.evaluate(probes.prepareKeyboard));
  if (!imeShown(shell('dumpsys', 'input_method'))) await tap('field');
  await waitFor('actual IME shown', () => imeShown(shell('dumpsys', 'input_method')));
  await waitFor('usable native keyboard geometry', () => client.evaluate(probes.keyboardPlacement));
  await waitFor('retained append caret', () => client.evaluate(probes.finishKeyboardPreparation));
  record('visible', await client.evaluate(probes.keyboardPlacement));
  evidence.screenshots = capture('keyboard-placement-visible');
  // The header toggle must remain tappable even when the native keyboard covers
  // the unresized viewport. A pointer event, not script click(), must change it.
  record('toggle-tap', await tap('toggle'));
  await waitFor('Keyboard toggle disables input', () => client.evaluate(() => document.querySelector('.scribble-area')?.getAttribute('inputmode') === 'none'));
  // Restore editing with another actual tap, then the actual field if required.
  await tap('toggle');
  await waitFor('Keyboard toggle enables input', () => client.evaluate(() => document.querySelector('.scribble-area')?.getAttribute('inputmode') === 'text'));
  if (!imeShown(shell('dumpsys', 'input_method'))) await tap('field');
  await waitFor('IME shown again', () => imeShown(shell('dumpsys', 'input_method')));
  await waitFor('restored placement', () => client.evaluate(probes.keyboardPlacement));
  const before = await client.evaluate(() => {
    const t = window.__foldTest;
    return { doc: t.editor.state.doc.toJSON(), draft: document.querySelector('.scribble-area').value };
  });
  record('insert-tap', await tap('insert'));
  await waitFor('native tap inserted draft', () => client.evaluate((draft) => {
    const t = window.__foldTest;
    return document.querySelector('.scribble-area')?.value === '' && t.editor.state.doc.textContent.includes(draft);
  }, before.draft));
  await client.evaluate(() => window.__foldTest.editor.commands.undo());
  assert.deepEqual(await client.evaluate(() => window.__foldTest.editor.state.doc.toJSON()), before.doc, 'Insert was not undoable');
  record('insert-undo', { passed: true });
  evidence.status = 'passed';
  return evidence;
}

export async function stableControlPoint(control, read) {
  let last;
  return waitFor(`stable reachable ${control}`, async () => {
    const point = await read();
    const key = point && JSON.stringify(point);
    const stable = key && key === last;
    last = key;
    return stable && point;
  });
}

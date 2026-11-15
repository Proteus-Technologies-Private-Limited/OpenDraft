import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { activeWakeLocks, tableReadMediaState, waitFor } from './protocol.mjs';

/** Real APK, real native media/TTS services. Only the disposable TTS provider
 * emits deterministic tones. No production state or playback signals are mocked. */
export async function tableReadChecks({ client, shell, startMain, capture }) {
  const evidence = { phases: [], speech: 'test-only synthetic TTS tones; no pronunciation claim' };
  let frozen = false;
  const native = () => tableReadMediaState(shell('dumpsys', 'media_session'));
  const record = (phase, data) => { evidence.phases.push({ phase, ...data }); console.log(`table-read ${phase}: ${JSON.stringify(data)}`); };
  try {
    shell('settings', 'put', 'secure', 'tts_default_synth', 'com.proteus.opendraft');
    await client.evaluate(() => {
      const editor = window.__foldTest.editor;
      editor.commands.setContent({ type: 'doc', content: Array.from({ length: 20 }, (_, i) => ({
        type: 'action', content: [{ type: 'text', text: `Synthetic background reading line ${i + 1}.` }],
      })) });
      window.__tableReadDoc = editor.state.doc;
      document.querySelector('.menu-fab')?.click();
      document.querySelector('[data-menu-top="Tools"]')?.click();
    });
    await waitFor('Table Read command', () => client.evaluate(() => {
      const command = [...document.querySelectorAll('[role=menuitemcheckbox], [role=menuitem]')]
        .find(el => el.textContent.trim() === 'Table Read');
      if (!command) return false;
      command.click(); return true;
    }));
    await waitFor('Table Read panel', () => client.evaluate(() => !!document.querySelector('.table-read-panel')));
    await client.evaluate(() => document.querySelector('.table-read-panel button[aria-label="Voices and reading options"]')?.click());
    await waitFor('Table Read voices ready', () => client.evaluate(() => {
      const panel = document.querySelector('.table-read-panel');
      if (!panel || !panel.textContent.includes('ci-test')) return false;
      panel.querySelector('.table-read-play')?.click(); return true;
    }));
    const initial = await waitFor('native playing session', () => { const s = native(); return s.state === 3 && s.total === 20 && s; });
    record('foreground-start', initial);
    shell('input', 'keyevent', 'KEYCODE_HOME');
    await client.call('Page.setWebLifecycleState', { state: 'frozen' }); frozen = true;
    const advanced = await waitFor('native queue advances while WebView is frozen', () => {
      const s = native(); return s.state === 3 && s.line >= initial.line + 2 && s;
    });
    record('frozen-background-advance', advanced);
    shell('cmd', 'media_session', 'dispatch', 'pause');
    const paused = await waitFor('native media pause', () => { const s = native(); return s.state === 2 && s; });
    await delay(5500);
    assert.deepEqual(native(), paused, 'Paused read advanced while the WebView was frozen');
    record('remote-pause', paused);
    shell('cmd', 'statusbar', 'expand-notifications');
    evidence.notificationScreenshots = capture('table-read-notification');
    shell('cmd', 'statusbar', 'collapse');
    shell('cmd', 'media_session', 'dispatch', 'next');
    const next = await waitFor('paused next line', () => { const s = native(); return s.state === 2 && s.line === paused.line + 1 && s; });
    shell('cmd', 'media_session', 'dispatch', 'previous');
    await waitFor('paused previous line', () => native().line === paused.line);
    record('remote-skip', next);
    shell('cmd', 'media_session', 'dispatch', 'play');
    const resumed = await waitFor('native media resume', () => { const s = native(); return s.state === 3 && s.line > paused.line && s; });
    record('remote-resume', resumed);
    await client.call('Page.setWebLifecycleState', { state: 'active' }); frozen = false;
    startMain();
    await waitFor('panel reconciles native playback', async () => {
      const state = native();
      return client.evaluate((line) => {
        const panel = document.querySelector('.table-read-panel');
        return panel?.textContent.includes(`Line ${line} of 20`) && panel.querySelector('.table-read-play')?.getAttribute('aria-label') === 'Pause';
      }, state.line);
    });
    assert(await client.evaluate(() => window.__foldTest.editor.state.doc.eq(window.__tableReadDoc)), 'Reading changed the script');
    record('foreground-reconciled', native());
    evidence.screenshots = capture('table-read-foreground');
    await client.evaluate(() => document.querySelector('.table-read-panel button[aria-label="Stop"]')?.click());
    await waitFor('native playback service released', () => !shell('dumpsys', 'activity', 'services', 'com.proteus.opendraft').includes('TableReadService'));
    assert(!activeWakeLocks(shell('dumpsys', 'power')).includes('OpenDraft:TableRead'), 'Playback wake lock survived Stop');
    record('stopped', native());
    // A second read also checks restart cleanup and the standard media Stop key.
    await client.evaluate(() => document.querySelector('.table-read-panel .table-read-play')?.click());
    await waitFor('restarted native read', () => native().state === 3);
    shell('cmd', 'media_session', 'dispatch', 'stop');
    await waitFor('media Stop releases the service', () => !shell('dumpsys', 'activity', 'services', 'com.proteus.opendraft').includes('TableReadService'));
    assert(!activeWakeLocks(shell('dumpsys', 'power')).includes('OpenDraft:TableRead'), 'Media Stop leaked a wake lock');
    record('media-stop', native());
    evidence.status = 'passed';
    return evidence;
  } catch (error) {
    error.message += `\nTable Read evidence: ${JSON.stringify({ ...evidence, lastNative: native(), mediaDump: shell('dumpsys', 'media_session').slice(0, 4000) })}`;
    throw error;
  } finally {
    if (frozen) await client.call('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    // The outer runner captures the live failure snapshot and logcat before
    // stopping the app. Killing it here hides the panel's startup error.
  }
}

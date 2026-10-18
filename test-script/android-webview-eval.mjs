#!/usr/bin/env node
// Evaluate a JavaScript expression inside OpenDraft's WebView on a running
// Android emulator (debug APK only — release WebViews are not debuggable).
//
//   node test-script/android-webview-eval.mjs '<expression>' [adb-serial]
//
// The expression's value is printed as JSON. Wrap multi-statement code in an
// IIFE: '(() => { ...; return x; })()'.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const expr = process.argv[2];
const serial = process.argv[3] || 'emulator-5556';
const PORT = 9333;
const adb = `${homedir()}/Library/Android/sdk/platform-tools/adb`;

if (!expr) {
  console.error('usage: android-webview-eval.mjs <expression> [adb-serial]');
  process.exit(2);
}

try {
  const sockets = execFileSync(adb, ['-s', serial, 'shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' })
    .match(/webview_devtools_remote_\d+/g);
  if (!sockets) throw new Error('No debuggable WebView found — is the debug APK running?');
  execFileSync(adb, ['-s', serial, 'forward', `tcp:${PORT}`, `localabstract:${sockets.at(-1)}`]);

  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error(`No page target among ${pages.length} targets`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WebSocket connect failed')); });
  const result = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('Timed out waiting for evaluation')), 15000);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      res(msg.result);
    };
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }));
  });
  ws.close();

  if (result.exceptionDetails) {
    console.error('Page threw:', result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    process.exit(1);
  }
  console.log(JSON.stringify(result.result.value, null, 2));
} catch (err) {
  console.error(`android-webview-eval: ${err.message}`);
  process.exit(1);
}

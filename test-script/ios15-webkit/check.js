// Load a built frontend (dist/) in an old WebKit and report whether it starts.
// Runs inside the Playwright Docker image — see run.sh.
//
//   node check.js <distDir> <label> <outDir>
//
// Exit 0 = the app rendered; 1 = it did not ("Loading timed out" / "failed to
// start" overlay, or an empty #root).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { webkit } = require('playwright-core');

const [distDir, label, outDir] = process.argv.slice(2);
if (!distDir || !label || !outDir) {
  console.error('usage: node check.js <distDir> <label> <outDir>');
  process.exit(2);
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

function serve(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let file = path.join(root, urlPath);
        if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
        // SPA: unknown paths (and /api/* — there is no backend here) get index.html or 404.
        if (urlPath.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
        if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  let server, browser;
  let exitCode = 1;
  try {
    server = await serve(path.resolve(distDir));
    const url = `http://127.0.0.1:${server.address().port}/`;
    browser = await webkit.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    // STRIP_BUILTINS=1 removes what Safari 15.0–15.3 does not have before any
    // page script runs, so index.html's polyfills are what the app gets.
    if (process.env.STRIP_BUILTINS === '1') {
      await page.addInitScript(() => {
        const TA = Object.getPrototypeOf(Int8Array.prototype);
        delete Array.prototype.at; delete Array.prototype.findLast; delete Array.prototype.findLastIndex;
        delete String.prototype.at; delete TA.at; delete TA.findLast; delete TA.findLastIndex;
        delete Object.hasOwn; delete window.structuredClone; delete Promise.withResolvers;
        try { delete Crypto.prototype.randomUUID; } catch (_) { /* not present */ }
        window.__strippedBuiltins = typeof [].at === 'undefined' && typeof structuredClone === 'undefined';
      });
    }

    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Which of the features the bug report hinges on does this engine have?
    const features = await page.evaluate(() => {
      const syntax = (src) => { try { new Function(src); return true; } catch (_) { return false; } };
      return {
        userAgent: navigator.userAgent,
        // Probed on a fresh iframe so the app's polyfills do not mask the answer.
        native: (() => {
          const f = document.createElement('iframe');
          document.body.appendChild(f);
          const w = f.contentWindow;
          const out = {
            'Array#at': typeof w.Array.prototype.at === 'function',
            'Object.hasOwn': typeof w.Object.hasOwn === 'function',
            structuredClone: typeof w.structuredClone === 'function',
            'crypto.randomUUID': !!(w.crypto && typeof w.crypto.randomUUID === 'function'),
            'Promise.withResolvers': typeof w.Promise.withResolvers === 'function',
          };
          f.remove();
          return out;
        })(),
        'regex lookbehind': syntax('/(?<=a)b/'),
        'class static block': syntax('class A { static { } }'),
      };
    });

    // index.html's own timeout fires at 8 s; give it margin.
    await page.waitForTimeout(12000);
    const state = await page.evaluate(() => {
      const fatal = document.getElementById('_fatal');
      return {
        rootChildren: document.getElementById('root').children.length,
        overlay: fatal ? fatal.innerText.slice(0, 600) : null,
        bodyText: document.body.innerText.slice(0, 300),
      };
    });

    fs.mkdirSync(outDir, { recursive: true });
    const shot = path.join(outDir, `${label}.png`);
    await page.screenshot({ path: shot });

    state.strippedBuiltins = await page.evaluate(() => window.__strippedBuiltins === true);
    state.polyfilled = await page.evaluate(() => ({
      'Array#at': typeof [].at === 'function', structuredClone: typeof structuredClone === 'function',
      'Object.hasOwn': typeof Object.hasOwn === 'function', 'crypto.randomUUID': typeof crypto.randomUUID === 'function',
      'Promise.withResolvers': typeof Promise.withResolvers === 'function',
    }));
    const ok = state.rootChildren > 0 && !state.overlay;
    exitCode = ok ? 0 : 1;
    console.log(JSON.stringify({ label, result: ok ? 'RENDERED' : 'FAILED', features, ...state, errors: errors.slice(0, 8), screenshot: shot }, null, 2));
  } catch (e) {
    console.error(`[${label}] check crashed:`, e && e.stack ? e.stack : e);
    exitCode = 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }
  process.exit(exitCode);
})();

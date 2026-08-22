/**
 * Static server for the harness, plus a POST sink.
 *
 * The Chrome extension refuses `file://`, so the page has to be served over
 * http. `POST /save/<name>` writes the body to `out/<name>`, which is how the
 * document the browser parsed reaches a node test.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const OUT = join(DIR, 'out');
const PORT = Number(process.env.PORT || 8791);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.fdx': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

mkdirSync(OUT, { recursive: true });

createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'POST' && url.startsWith('/save/')) {
    // Basename only: the browser must not be able to write outside out/.
    const name = normalize(decodeURIComponent(url.slice('/save/'.length))).replace(/^(\.\.[/\\])+/, '');
    if (!name || name.includes('/') || name.includes('\\')) {
      res.writeHead(400); res.end('bad name'); return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        writeFileSync(join(OUT, name), body);
        res.writeHead(200, { 'access-control-allow-origin': '*' });
        res.end(String(body.length));
      } catch (err) {
        res.writeHead(500); res.end(String(err));
      }
    });
    return;
  }

  try {
    const name = url === '/' ? '/index.html' : url;
    const path = join(DIR, normalize(name).replace(/^(\.\.[/\\])+/, ''));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, () => console.log(`fdx harness on http://localhost:${PORT}/`));

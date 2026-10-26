/**
 * Local SMTP catcher for manual testing: accepts every message and writes it
 * to test-script/output/mail/<n>-<recipient>.eml instead of delivering it.
 *
 * Point the collab server at it so verification and password-reset emails
 * can be read without a real mail account:
 *
 *   node test-script/smtp-catcher.mjs [port]          # default 2525
 *   SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_USER= SMTP_PASS= ./start_collab.sh
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 2525);
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'output', 'mail');
fs.mkdirSync(outDir, { recursive: true });
let count = fs.readdirSync(outDir).filter((f) => f.endsWith('.eml')).length;

const server = net.createServer((socket) => {
  let buffer = '';
  let inData = false;
  let rcpt = 'unknown';
  let data = '';
  socket.write('220 smtp-catcher ESMTP\r\n');
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (inData) {
        if (line === '.') {
          inData = false;
          const file = path.join(outDir, `${String(++count).padStart(3, '0')}-${rcpt.replace(/[^\w.@-]/g, '_')}.eml`);
          try {
            fs.writeFileSync(file, data);
            console.log(`[smtp-catcher] ${rcpt} → ${file}`);
          } catch (err) {
            console.error('[smtp-catcher] could not save message:', err);
          }
          data = '';
          socket.write('250 OK queued\r\n');
        } else {
          data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
        }
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') socket.write('250-smtp-catcher\r\n250 SIZE 10485760\r\n');
      else if (cmd === 'HELO') socket.write('250 smtp-catcher\r\n');
      else if (cmd === 'RCPT') { rcpt = line.replace(/^RCPT TO:\s*/i, '').replace(/[<>]/g, ''); socket.write('250 OK\r\n'); }
      else if (cmd === 'DATA') { inData = true; socket.write('354 go ahead\r\n'); }
      else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 OK\r\n');
    }
  });
  socket.on('error', (err) => console.warn('[smtp-catcher] connection error:', err.message));
});

server.on('error', (err) => {
  console.error(`[smtp-catcher] could not listen on ${port}:`, err.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`[smtp-catcher] listening on 127.0.0.1:${port}, saving to ${outDir}`));

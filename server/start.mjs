import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { createApi } from './api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT || 4173);
const dev = args.includes('--dev');
const api = createApi({ dataDir: process.env.NOSTRAXIS_DATA_DIR || path.join(root, '.nostraxis') });
const vite = dev ? await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'spa' }) : null;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  const hostname = String(req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1', 'terminal.local'].includes(hostname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (await api.handle(req, res)) return;
  if (vite) { vite.middlewares(req, res); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filename = path.resolve(root, 'dist/client', `.${pathname}`);
    if (!filename.startsWith(path.join(root, 'dist/client') + path.sep) || !(await stat(filename).catch(() => null))?.isFile()) filename = path.join(root, 'dist/client/index.html');
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    res.end(await readFile(filename));
  } catch {
    res.writeHead(503); res.end('Run npm run build before npm start.');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`Nostraxis · http://localhost:${port}`));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  server.close();
  await api.close();
  await vite?.close();
});

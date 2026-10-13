import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.geojson': 'application/geo+json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  let path;
  try { path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
  catch { response.writeHead(400); response.end(); return; }
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    if (!statSync(path).isFile()) throw new Error();
    response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(path).pipe(response);
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(Number(process.argv[2] ?? 8846), '127.0.0.1', () => console.log('HistoryMap http://127.0.0.1:' + server.address().port));

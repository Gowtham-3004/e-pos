// Production server for the web apps: serves the built launcher, POS, Back Office and
// Platform Admin from one origin (like the launcher's dev proxy), so they share the
// simulated-cloud IndexedDB and live BroadcastChannel updates. Run `pnpm build:web` first.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'apps');
const port = Number(process.env.PORT) || 8080;

// Longest prefix first; '/' (launcher) last.
const MOUNTS = [
  ['/backoffice', join(root, 'backoffice/dist')],
  ['/admin', join(root, 'platform-admin/dist')],
  ['/pos', join(root, 'pos/dist')],
  ['', join(root, 'launcher/dist')],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

function send(res, file, method) {
  const immutable = file.includes('/assets/');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }

  const [prefix, dir] = MOUNTS.find(([p]) => p === '' || path === p || path.startsWith(`${p}/`));
  if (prefix && path === prefix) { res.writeHead(301, { Location: `${prefix}/` }).end(); return; }

  const rel = normalize(path.slice(prefix.length)).replace(/^([/\\])+/, '');
  const file = join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }

  if (isFile(file)) return send(res, file, req.method);
  if (isFile(join(file, 'index.html'))) return send(res, join(file, 'index.html'), req.method);
  // Missing asset → 404; anything else is a client-side route → the app's index.html.
  if (extname(rel)) { res.writeHead(404).end(); return; }
  send(res, join(dir, 'index.html'), req.method);
}).listen(port, () => console.log(`Elixir web apps on http://localhost:${port}`));

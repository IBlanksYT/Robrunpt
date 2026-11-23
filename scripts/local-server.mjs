// Pré-visualização local completa (site + API + Blobs simulados), sem conta Netlify.
// Uso: npm run local   →  http://localhost:8888
// Para desenvolvimento oficial podes também usar "netlify dev" (Netlify CLI).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startLocalBlobs } from './blobs-local.mjs';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const pub = join(root, 'public');
const PORT = Number(process.env.PORT || 8888);

if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = randomBytes(32).toString('hex');
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = 'local-' + randomBytes(6).toString('hex');
  console.log(`\n  Palavra-passe de administrador LOCAL (só para esta sessão): ${process.env.ADMIN_PASSWORD}\n`);
}

await startLocalBlobs(join(root, '.local-blobs'));
const { default: api } = await import('../netlify/functions/api.mjs');

const CSP_HEADER = (await readFile(join(root, 'netlify.toml'), 'utf8')).match(/Content-Security-Policy = "([^"]+)"/)?.[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

async function tryFile(p) {
  try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const r = await api(new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { ip: req.socket.remoteAddress });
      const out = {};
      r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
      const cookies = r.headers.getSetCookie();
      if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    const clean = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = await tryFile(join(pub, clean));
    if (!file) file = await tryFile(join(pub, `${clean}.html`));
    if (!file && (clean === '/' || clean === '')) file = join(pub, 'index.html');
    if (!file) file = join(pub, 'page.html'); // equivalente ao redirect /* -> /page.html 200
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', ...(CSP_HEADER ? { 'content-security-policy': CSP_HEADER, 'x-frame-options': 'SAMEORIGIN' } : {}) });
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('erro');
  }
}).listen(PORT, () => console.log(`  Site local em http://localhost:${PORT}  (painel: http://localhost:${PORT}/admin)\n`));

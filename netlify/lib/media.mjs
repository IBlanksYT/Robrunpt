// Biblioteca de imagens (logo, fundos, capas) guardada em Netlify Blobs.
import { HttpError } from './http.mjs';
import { store, listKeys, newId } from './store.mjs';

const MAX_BYTES = 4_500_000;
const TYPES = {
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', magic: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  'image/webp': { ext: 'webp', magic: (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  'image/avif': { ext: 'avif', magic: (b) => String.fromCharCode(...b.slice(4, 12)).includes('ftypavi') },
  'image/x-icon': { ext: 'ico', magic: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 },
};

export async function uploadMedia(req, user) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const spec = TYPES[type];
  if (!spec) throw new HttpError(415, 'Formato não suportado. Usa PNG, JPG, WEBP, GIF, AVIF ou ICO (SVG não é permitido por segurança).');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new HttpError(413, 'Imagem demasiado grande (máx. 4,5 MB).');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) throw new HttpError(400, 'Ficheiro vazio.');
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'Imagem demasiado grande (máx. 4,5 MB).');
  if (!spec.magic(buf)) throw new HttpError(415, 'O conteúdo do ficheiro não corresponde ao formato indicado.');
  const name = decodeURIComponent(req.headers.get('x-filename') || 'imagem').replace(/[^\w.\- ]+/g, '').slice(0, 80) || 'imagem';
  const key = `${newId()}.${spec.ext}`;
  const metadata = { contentType: type, name, size: buf.length, uploadedAt: Date.now(), by: user.name };
  await store('media').set(`m/${key}`, buf, { metadata });
  return { key, url: `/api/media/${key}`, ...metadata };
}

export async function listMedia() {
  const keys = await listKeys('media', 'm/');
  const out = [];
  for (const k of keys) {
    const m = await store('media').getMetadata(k);
    if (m) out.push({ key: k.slice(2), url: `/api/media/${k.slice(2)}`, ...m.metadata });
  }
  return out.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
}

export function validMediaKey(key) {
  return typeof key === 'string' && /^[a-z0-9]{8,40}\.(png|jpg|gif|webp|avif|ico)$/.test(key);
}

export async function serveMedia(key) {
  if (!validMediaKey(key)) return new Response('Não encontrado', { status: 404 });
  const r = await store('media').getWithMetadata(`m/${key}`, { type: 'arrayBuffer' });
  if (!r) return new Response('Não encontrado', { status: 404 });
  return new Response(r.data, {
    status: 200,
    headers: {
      'content-type': r.metadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}

export async function deleteMedia(key) {
  if (!validMediaKey(key)) throw new HttpError(400, 'Ficheiro inválido.');
  await store('media').delete(`m/${key}`);
}

// Camada de armazenamento sobre Netlify Blobs.
// Cada tipo de conteúdo vive numa store separada (ver schema/ARMAZENAMENTO.md).
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';
import { HttpError, sleep } from './http.mjs';

export const STORES = {
  site: 'rr-site',
  versions: 'rr-versions',
  content: 'rr-content',
  clips: 'rr-clips',
  users: 'rr-users',
  sessions: 'rr-sessions',
  media: 'rr-media',
  stats: 'rr-stats',
  ratelimit: 'rr-ratelimit',
  backups: 'rr-backups',
  audit: 'rr-audit',
};

const cache = new Map();
let strongSupported = true;

function describe(e) {
  const msg = String(e?.message || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 220);
  return `${e?.name || 'Erro'}: ${msg}`;
}

function rawStore(storeName, strong) {
  return strong ? getStore({ name: storeName, consistency: 'strong' }) : getStore(storeName);
}

export function store(name) {
  const storeName = STORES[name];
  if (!storeName) throw new Error(`Store desconhecida: ${name}`);
  if (cache.has(storeName)) return cache.get(storeName);
  const wrapper = new Proxy({}, {
    get(_, method) {
      return async (...args) => {
        try {
          return await rawStore(storeName, strongSupported)[method](...args);
        } catch (e) {
          if (strongSupported && /consisten|uncachedEdgeURL/i.test(`${e?.name} ${e?.message}`)) {
            strongSupported = false;
            console.warn('Netlify Blobs: consistência forte indisponível, a usar modo normal.');
            try { return await rawStore(storeName, false)[method](...args); } catch (e2) { e = e2; }
          }
          console.error(`Netlify Blobs falhou (${storeName}.${String(method)})`, e);
          throw new HttpError(503, `Erro no armazenamento (Netlify Blobs) — ${describe(e)}`);
        }
      };
    },
  });
  cache.set(storeName, wrapper);
  return wrapper;
}

export function resetStoreCache() { cache.clear(); }

export async function getJSON(name, key) {
  return (await store(name).get(key, { type: 'json' })) ?? null;
}

export async function getJSONMeta(name, key) {
  const r = await store(name).getWithMetadata(key, { type: 'json' });
  if (!r) return null;
  let etag = r.etag;
  if (!etag) {
    const { blobs } = await store(name).list({ prefix: key });
    etag = blobs.find((b) => b.key === key)?.etag;
  }
  return { data: r.data, etag };
}

export async function putJSON(name, key, value, opts) {
  return store(name).setJSON(key, value, opts);
}

export async function del(name, key) {
  await store(name).delete(key);
}

export async function listKeys(name, prefix) {
  const { blobs } = await store(name).list({ prefix });
  return blobs.map((b) => b.key).sort();
}

export async function getMany(name, keys, concurrency = 12) {
  const out = new Array(keys.length);
  let i = 0;
  async function worker() {
    while (i < keys.length) {
      const idx = i++;
      out[idx] = await getJSON(name, keys[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  return out;
}

export async function updateJSON(name, key, fn, { retries = 6 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const cur = await getJSONMeta(name, key);
    const next = await fn(cur ? structuredClone(cur.data) : null);
    if (next === undefined) return cur ? cur.data : null;
    const res = cur
      ? await store(name).setJSON(key, next, { onlyIfMatch: cur.etag })
      : await store(name).setJSON(key, next, { onlyIfNew: true });
    if (res.modified) return next;
    await sleep(20 + Math.random() * 60 * (attempt + 1));
  }
  throw new HttpError(409, 'Conflito de escrita simultânea. Tenta novamente.');
}

export function newId() {
  return Date.now().toString(36) + randomBytes(5).toString('hex');
}

export function newestFirstId() {
  const inv = (9_999_999_999_999 - Date.now()).toString().padStart(13, '0');
  return `${inv}-${randomBytes(4).toString('hex')}`;
}

export function isSafeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

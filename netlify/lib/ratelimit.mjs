// Limitação de pedidos em janela fixa, guardada em Netlify Blobs.
import { HttpError, sleep } from './http.mjs';
import { store, getJSONMeta } from './store.mjs';

export async function rateLimit(bucket, key, { limit, windowSec, message }) {
  const k = `${bucket}/${key}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    const cur = await getJSONMeta('ratelimit', k);
    let rec = cur?.data;
    if (!rec || rec.reset < now) rec = { count: 0, reset: now + windowSec * 1000 };
    if (rec.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((rec.reset - now) / 1000));
      throw new HttpError(429, message || 'Demasiados pedidos. Tenta novamente mais tarde.', { retryAfter });
    }
    rec.count += 1;
    const res = cur
      ? await store('ratelimit').setJSON(k, rec, { onlyIfMatch: cur.etag })
      : await store('ratelimit').setJSON(k, rec, { onlyIfNew: true });
    if (res.modified) return rec;
    await sleep(15 + Math.random() * 40);
  }
  throw new HttpError(429, 'Demasiados pedidos em simultâneo. Tenta novamente.');
}

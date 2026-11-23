// Utilitários HTTP partilhados pelas funções.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export async function readJSON(req, max = 2_500_000) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'Pedido demasiado grande.');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, 'Pedido demasiado grande.');
  if (!text) return {};
  let v;
  try { v = JSON.parse(text); } catch { throw new HttpError(400, 'JSON inválido.'); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new HttpError(400, 'Formato de dados inválido.');
  return v;
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = 'Lax' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; Secure; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`;
  if (httpOnly) c += '; HttpOnly';
  return c;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

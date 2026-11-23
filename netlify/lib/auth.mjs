// Sessões seguras (cookie HttpOnly assinado + registo no servidor), CSRF e autorização.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, parseCookies, serializeCookie } from './http.mjs';
import { getJSON, putJSON, del } from './store.mjs';
import { sessionSecret, privacyConfig } from './env.mjs';
import { getUser } from './users.mjs';

export const SID_COOKIE = '__Host-rr_sid';
export const CSRF_COOKIE = '__Host-rr_csrf';
const ADMIN_SESSION_HOURS = 12;

export const ROLES = ['player', 'moderator', 'admin'];
const RANK = { player: 1, moderator: 2, admin: 3 };

export const ADMIN_VIRTUAL_USER = Object.freeze({
  id: 'admin',
  name: 'Administrador',
  picture: '',
  role: 'admin',
  virtual: true,
});

function sign(value) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function hashForRateLimit(value) {
  // Pseudonimização: HMAC com segredo + dia; nunca guardamos o valor original.
  const day = new Date().toISOString().slice(0, 10);
  return createHmac('sha256', sessionSecret()).update(`${day}|${value}`).digest('base64url').slice(0, 22);
}

/** Cria a sessão no servidor e devolve o valor do cookie. */
export async function issueSession(userId, kind = 'user') {
  const sid = randomBytes(32).toString('base64url');
  const now = Date.now();
  const ttl = kind === 'admin-password' ? ADMIN_SESSION_HOURS * 3600e3 : privacyConfig().sessionDays * 86400e3;
  await putJSON('sessions', `s/${sid}`, { userId, kind, createdAt: now, expiresAt: now + ttl });
  return { value: `${sid}.${sign(sid)}`, maxAge: ttl / 1000 };
}

export async function startSession(ctx, userId, kind) {
  const { value, maxAge } = await issueSession(userId, kind);
  ctx.setCookie(serializeCookie(SID_COOKIE, value, { maxAge, httpOnly: true, sameSite: 'Lax' }));
  rotateCsrf(ctx);
}

function readSid(ctx) {
  const raw = ctx.cookies[SID_COOKIE];
  if (!raw || raw.length > 200) return null;
  const [sid, sig] = raw.split('.');
  if (!sid || !sig) return null;
  return safeEqual(sign(sid), sig) ? sid : null;
}

/** Devolve { user, session } ou null. Lê sempre o utilizador do servidor (papéis/banimentos atualizados). */
export async function currentUser(ctx) {
  if (ctx._auth !== undefined) return ctx._auth;
  ctx._auth = null;
  if (!ctx.cookies[SID_COOKIE]) return null;
  const sid = readSid(ctx);
  if (!sid) return null;
  const session = await getJSON('sessions', `s/${sid}`);
  if (!session || session.expiresAt < Date.now()) {
    if (session) await del('sessions', `s/${sid}`);
    return null;
  }
  let user;
  if (session.kind === 'admin-password' && session.userId === 'admin') user = { ...ADMIN_VIRTUAL_USER };
  else user = await getUser(session.userId);
  if (!user || user.banned) return null;
  ctx._auth = { user, session, sid };
  return ctx._auth;
}

export async function endSession(ctx) {
  const sid = readSid(ctx);
  if (sid) await del('sessions', `s/${sid}`);
  ctx.setCookie(serializeCookie(SID_COOKIE, '', { maxAge: 0 }));
  ctx._auth = null;
}

export function hasRole(user, role) {
  return !!user && (RANK[user.role] || 0) >= RANK[role];
}

export async function requireUser(ctx, role = 'player') {
  const auth = await currentUser(ctx);
  if (!auth) throw new HttpError(401, 'Precisas de iniciar sessão.');
  if (!hasRole(auth.user, role)) throw new HttpError(403, 'Não tens permissão para esta ação.');
  return auth.user;
}

// ---- CSRF: double-submit cookie + verificação de origem ----
export function rotateCsrf(ctx) {
  const token = randomBytes(24).toString('base64url');
  ctx.setCookie(serializeCookie(CSRF_COOKIE, token, { maxAge: 30 * 86400, httpOnly: false, sameSite: 'Strict' }));
  ctx.cookies[CSRF_COOKIE] = token;
  return token;
}

export function ensureCsrf(ctx) {
  const cur = ctx.cookies[CSRF_COOKIE];
  if (cur && /^[A-Za-z0-9_-]{20,64}$/.test(cur)) return cur;
  return rotateCsrf(ctx);
}

export function verifyCsrf(ctx) {
  const { req, url } = ctx;
  const origin = req.headers.get('origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'Origem do pedido não permitida.');
  const site = req.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) throw new HttpError(403, 'Pedido entre sites bloqueado.');
  const header = req.headers.get('x-csrf-token') || '';
  const cookie = ctx.cookies[CSRF_COOKIE] || '';
  if (!header || !cookie || !safeEqual(header, cookie)) {
    throw new HttpError(403, 'Token de segurança (CSRF) inválido. Recarrega a página.');
  }
}

export function cookiesFrom(req) {
  return parseCookies(req);
}

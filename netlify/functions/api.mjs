// API única da ROB RUN Portugal: /api/*
import { HttpError, json, readJSON } from '../lib/http.mjs';
import {
  cookiesFrom, currentUser, requireUser, startSession, endSession, ensureCsrf, verifyCsrf,
  safeEqual, hashForRateLimit, hasRole, ROLES,
} from '../lib/auth.mjs';
import { siteConfig, adminPassword, googleClientId, sessionSecret } from '../lib/env.mjs';
import { rateLimit } from '../lib/ratelimit.mjs';
import { verifyGoogleCredential } from '../lib/google.mjs';
import { upsertGoogleUser, getUser, publicUser, selfUser, listUsers, updateUser, deleteUserRecord } from '../lib/users.mjs';
import { getPublished, getDraft, saveDraft, publish, listVersions, getVersion, restoreVersion, createVersion } from '../lib/site.mjs';
import { listContent, getContent, createContent, updateContent, duplicateContent, deleteContent, submitClan, getMyClanSubmission, setClanStatus, removeUserClanSubmission, editMyClan, reviewClanEdit, getClanSettings, setClanSettings } from '../lib/content.mjs';
import { createClip, listClips, getClip, updateClip, deleteClip, deleteClipsOfUser, publicClip, normalizeClipUrl } from '../lib/clips.mjs';
import { uploadMedia, listMedia, serveMedia, deleteMedia } from '../lib/media.mjs';
import { recordView, recordEvent, getStats } from '../lib/stats.mjs';
import { listBackups, createBackup, getBackup, restoreBackup, importBackup, deleteBackup } from '../lib/backups.mjs';
import { audit, listAudit } from '../lib/audit.mjs';
import { listKeys, getMany, del } from '../lib/store.mjs';

const routes = [];
const route = (method, pattern, handler, { csrf = method !== 'GET' } = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, csrf });
};

// ---------- Público ----------
route('GET', '/health', async () => ({
  ok: true,
  googleConfigured: !!googleClientId(),
  sessionConfigured: (process.env.SESSION_SECRET || '').length >= 32,
  adminPasswordConfigured: adminPassword().length >= 10,
}));

route('GET', '/site', async () => ({ site: await getPublished() }));

route('GET', '/content/:type', async (ctx) => ({ items: (await listContent(ctx.params.type)).map(stripBody) }));
route('GET', '/content/:type/:id', async (ctx) => {
  const item = await getContent(ctx.params.type, ctx.params.id);
  if (!item.published) throw new HttpError(404, 'Conteúdo não encontrado.');
  return { item };
});

route('GET', '/clips', async (ctx) => {
  const q = ctx.url.searchParams;
  return listClips({ limit: q.get('limit'), cursor: q.get('cursor'), userId: q.get('user'), featuredOnly: q.get('featured') === '1' });
});
route('GET', '/clips/:id', async (ctx) => {
  const c = await getClip(ctx.params.id);
  if (!c || c.hidden) throw new HttpError(404, 'Clip não encontrado.');
  return { clip: publicClip(c) };
});

route('GET', '/users/:id', async (ctx) => {
  const u = await getUser(ctx.params.id);
  if (!u || u.banned) throw new HttpError(404, 'Perfil não encontrado.');
  return { user: publicUser(u) };
});

route('GET', '/media/:key', async (ctx) => serveMedia(ctx.params.key));

route('POST', '/stats/view', async (ctx) => {
  const body = await readJSON(ctx.req, 2000);
  await recordView(body.path, body.source);
  return { ok: true };
});

// ---------- Autenticação ----------
route('GET', '/auth/me', async (ctx) => {
  ensureCsrf(ctx);
  let auth = null;
  try { auth = await currentUser(ctx); } catch (e) { if (!(e instanceof HttpError)) throw e; }
  return { user: auth ? selfUser(auth.user) : null, googleClientId: googleClientId() };
});

route('POST', '/auth/google', async (ctx) => {
  sessionSecret();
  await rateLimit('login-google', hashForRateLimit(ctx.ip), { limit: 20, windowSec: 900 });
  const { credential } = await readJSON(ctx.req, 10000);
  const payload = await verifyGoogleCredential(credential);
  const user = await upsertGoogleUser(payload);
  if (user.banned) throw new HttpError(403, 'Esta conta foi suspensa pela moderação.');
  await startSession(ctx, user.id, 'google');
  await audit(user, 'login google', user.id);
  return { user: selfUser(user) };
});

route('POST', '/auth/admin', async (ctx) => {
  sessionSecret();
  const expected = adminPassword();
  if (expected.length < 10) throw new HttpError(503, 'ADMIN_PASSWORD não está configurada no Netlify (mínimo 10 caracteres).');
  await rateLimit('login-admin', hashForRateLimit(ctx.ip), { limit: 8, windowSec: 900, message: 'Demasiadas tentativas. Aguarda 15 minutos.' });
  await rateLimit('login-admin-global', 'all', { limit: 60, windowSec: 900, message: 'Demasiadas tentativas de login. Aguarda alguns minutos.' });
  const { password } = await readJSON(ctx.req, 2000);
  if (typeof password !== 'string' || !safeEqual(password, expected)) {
    await audit({ id: 'anon', name: 'Desconhecido' }, 'login admin falhado');
    throw new HttpError(401, 'Palavra-passe incorreta.');
  }
  await startSession(ctx, 'admin', 'admin-password');
  await audit({ id: 'admin', name: 'Administrador' }, 'login admin');
  return { ok: true };
});

route('POST', '/auth/logout', async (ctx) => {
  await endSession(ctx);
  return { ok: true };
});

// ---------- Conta do utilizador (RGPD) ----------
route('GET', '/me/export', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.virtual) throw new HttpError(400, 'A conta de administrador não tem dados pessoais.');
  const clips = await listClips({ userId: user.id, includeHidden: true, limit: 60 });
  const clan = await getMyClanSubmission(user.id);
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), user, clips: clips.items, clanSubmission: clan }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="os-meus-dados-robrun-pt.json"', 'cache-control': 'no-store' },
  });
});

route('DELETE', '/me', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.virtual) throw new HttpError(400, 'A conta de administrador não pode ser eliminada aqui.');
  const n = await deleteClipsOfUser(user.id);
  await removeUserClanSubmission(user.id);
  await deleteUserSessions(user.id);
  await deleteUserRecord(user.id);
  await endSession(ctx);
  await audit({ id: user.id, name: user.name }, 'conta eliminada pelo próprio', user.id, { clips: n });
  return { ok: true };
});

// ---------- Clips (jogadores) ----------
route('POST', '/clips/check', async (ctx) => {
  await requireUser(ctx);
  const { url } = await readJSON(ctx.req, 3000);
  const v = await normalizeClipUrl(url);
  return { video: v };
});

route('POST', '/clips', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.virtual) throw new HttpError(400, 'Inicia sessão com Google para publicar clips.');
  const body = await readJSON(ctx.req, 5000);
  const clip = await createClip(user, body);
  await recordEvent('clip').catch(() => {});
  return { clip: publicClip(clip) };
});

route('DELETE', '/clips/:id', async (ctx) => {
  const user = await requireUser(ctx);
  const clip = await getClip(ctx.params.id);
  if (!clip) throw new HttpError(404, 'Clip não encontrado.');
  const isOwner = clip.userId === user.id;
  if (!isOwner && !hasRole(user, 'moderator')) throw new HttpError(403, 'Só podes eliminar os teus próprios clips.');
  await deleteClip(clip);
  if (!isOwner) await audit(user, 'clip removido', clip.id, { title: clip.title, autor: clip.userId });
  return { ok: true };
});

// ---------- Pedidos de clã (jogadores) ----------
route('GET', '/clans/mine', async (ctx) => {
  const user = await requireUser(ctx);
  return { submission: user.virtual ? null : await getMyClanSubmission(user.id) };
});

route('POST', '/clans/submit', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.virtual) throw new HttpError(400, 'Inicia sessão com Google para enviar o teu clã.');
  await rateLimit('clan-submit', user.id, { limit: 5, windowSec: 3600, message: 'Demasiadas tentativas. Tenta mais tarde.' });
  const item = await submitClan(user, await readJSON(ctx.req, 10000));
  await audit(user, 'pedido de clã enviado', item.id, { title: item.title });
  return { submission: { id: item.id, title: item.title, status: item.status } };
});

route('PUT', '/clans/mine', async (ctx) => {
  const user = await requireUser(ctx);
  if (user.virtual) throw new HttpError(400, 'Inicia sessão com Google para editar o teu clã.');
  await rateLimit('clan-edit', user.id, { limit: 10, windowSec: 3600, message: 'Demasiadas edições. Tenta mais tarde.' });
  const { item, result } = await editMyClan(user, await readJSON(ctx.req, 10000));
  await audit(user, 'anúncio de clã editado pelo dono', item.id, { title: item.title, result });
  return { result, submission: await getMyClanSubmission(user.id) };
});

// ---------- Administração: site / CMS ----------
route('GET', '/admin/site', async (ctx) => {
  await requireUser(ctx, 'admin');
  const d = await getDraft();
  const published = await getPublished();
  return { draft: d.site, etag: d.etag, publishedAt: published.publishedAt || null };
});

route('PUT', '/admin/site', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const body = await readJSON(ctx.req, 3_500_000);
  const r = await saveDraft(body.site, body.etag, user, { force: body.force === true });
  return { etag: r.etag, site: r.site, savedAt: r.site.updatedAt };
});

route('POST', '/admin/publish', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const body = await readJSON(ctx.req, 3000);
  const r = await publish(user, body.note || '');
  await audit(user, 'site publicado', r.versionId, { note: body.note || '' });
  return { versionId: r.versionId, publishedAt: r.site.publishedAt };
});

route('GET', '/admin/versions', async (ctx) => {
  await requireUser(ctx, 'admin');
  return { items: await listVersions() };
});
route('POST', '/admin/versions', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const body = await readJSON(ctx.req, 3000);
  const { site } = await getDraft();
  const id = await createVersion(site, user, 'manual', body.note || 'Ponto de restauro manual');
  return { id };
});
route('GET', '/admin/versions/:id', async (ctx) => {
  await requireUser(ctx, 'admin');
  return { version: await getVersion(ctx.params.id) };
});
route('POST', '/admin/versions/:id/restore', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const body = await readJSON(ctx.req, 2000);
  await restoreVersion(ctx.params.id, user, { publishNow: body.publish === true });
  await audit(user, body.publish ? 'versão restaurada e publicada' : 'versão restaurada para rascunho', ctx.params.id);
  const d = await getDraft();
  return { draft: d.site, etag: d.etag };
});

// ---------- Administração: conteúdos ----------
route('GET', '/admin/content/:type', async (ctx) => {
  await requireUser(ctx, 'moderator');
  return { items: await listContent(ctx.params.type, { includeDrafts: true }) };
});
route('POST', '/admin/content/:type', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const item = await createContent(ctx.params.type, await readJSON(ctx.req, 300000), user);
  await audit(user, `criou ${ctx.params.type}`, item.id, { title: item.title });
  return { item };
});
route('PUT', '/admin/content/:type/:id', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const item = await updateContent(ctx.params.type, ctx.params.id, await readJSON(ctx.req, 300000), user);
  await audit(user, `editou ${ctx.params.type}`, item.id, { title: item.title });
  return { item };
});
route('POST', '/admin/content/:type/:id/duplicate', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const item = await duplicateContent(ctx.params.type, ctx.params.id, user);
  return { item };
});
route('DELETE', '/admin/content/:type/:id', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  await deleteContent(ctx.params.type, ctx.params.id);
  await audit(user, `eliminou ${ctx.params.type}`, ctx.params.id);
  return { ok: true };
});

route('POST', '/admin/clans/:id/approve', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const item = await setClanStatus(ctx.params.id, 'approved', user);
  await audit(user, 'pedido de clã aprovado', item.id, { title: item.title });
  return { item };
});
route('POST', '/admin/clans/:id/reject', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const body = await readJSON(ctx.req, 2000);
  const item = await setClanStatus(ctx.params.id, 'rejected', user, body.reason || '');
  await audit(user, 'pedido de clã recusado', item.id, { title: item.title, reason: item.rejectReason });
  return { item };
});

route('POST', '/admin/clans/:id/edit-approve', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const item = await reviewClanEdit(ctx.params.id, true, user);
  await audit(user, 'alteração de clã aprovada', item.id, { title: item.title });
  return { item };
});
route('POST', '/admin/clans/:id/edit-reject', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const body = await readJSON(ctx.req, 2000);
  const item = await reviewClanEdit(ctx.params.id, false, user, body.reason || '');
  await audit(user, 'alteração de clã recusada', item.id, { title: item.title });
  return { item };
});
route('GET', '/admin/clans-settings', async (ctx) => {
  await requireUser(ctx, 'moderator');
  return { settings: await getClanSettings() };
});
route('PUT', '/admin/clans-settings', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const settings = await setClanSettings(await readJSON(ctx.req, 2000));
  await audit(user, 'definições de clãs alteradas', '', settings);
  return { settings };
});

// ---------- Administração: clips ----------
route('GET', '/admin/clips', async (ctx) => {
  await requireUser(ctx, 'moderator');
  const q = ctx.url.searchParams;
  return listClips({ limit: q.get('limit') || 60, cursor: q.get('cursor'), userId: q.get('user'), includeHidden: true });
});
route('PATCH', '/admin/clips/:id', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  const clip = await updateClip(ctx.params.id, await readJSON(ctx.req, 5000));
  await audit(user, 'clip moderado', clip.id, { hidden: clip.hidden, featured: clip.featured });
  return { clip };
});

// ---------- Administração: utilizadores e permissões ----------
route('GET', '/admin/users', async (ctx) => {
  await requireUser(ctx, 'moderator');
  const users = await listUsers();
  const counts = {};
  for (const k of await listKeys('clips', 'byuser/')) { const id = k.split('/')[1]; counts[id] = (counts[id] || 0) + 1; }
  return { items: users.sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0)).map((u) => ({ ...selfUser(u), banned: !!u.banned, lastLoginAt: u.lastLoginAt, clips: counts[u.id] || 0 })) };
});
route('PATCH', '/admin/users/:id', async (ctx) => {
  const actor = await requireUser(ctx, 'moderator');
  const body = await readJSON(ctx.req, 2000);
  const target = await getUser(ctx.params.id);
  if (!target) throw new HttpError(404, 'Utilizador não encontrado.');
  if (target.id === actor.id) throw new HttpError(400, 'Não podes alterar a tua própria conta aqui.');
  if (body.role !== undefined) {
    if (!hasRole(actor, 'admin')) throw new HttpError(403, 'Só administradores podem alterar permissões.');
    if (!ROLES.includes(body.role)) throw new HttpError(400, 'Função inválida.');
  }
  if (!hasRole(actor, 'admin') && target.role !== 'player') throw new HttpError(403, 'Moderadores só podem moderar jogadores.');
  const updated = await updateUser(target.id, (u) => ({
    ...u,
    ...(body.role !== undefined ? { role: body.role } : {}),
    ...(body.banned !== undefined ? { banned: !!body.banned } : {}),
  }));
  if (body.banned) await deleteUserSessions(target.id);
  await audit(actor, 'utilizador alterado', target.id, { role: body.role, banned: body.banned });
  return { user: { ...selfUser(updated), banned: !!updated.banned } };
});
route('DELETE', '/admin/users/:id', async (ctx) => {
  const actor = await requireUser(ctx, 'admin');
  const target = await getUser(ctx.params.id);
  if (!target) throw new HttpError(404, 'Utilizador não encontrado.');
  if (target.id === actor.id) throw new HttpError(400, 'Não podes eliminar a tua própria conta aqui.');
  const n = await deleteClipsOfUser(target.id);
  await removeUserClanSubmission(target.id);
  await deleteUserSessions(target.id);
  await deleteUserRecord(target.id);
  await audit(actor, 'utilizador eliminado', target.id, { clips: n, name: target.name });
  return { ok: true, clipsDeleted: n };
});

// ---------- Administração: media ----------
route('GET', '/admin/media', async (ctx) => {
  await requireUser(ctx, 'moderator');
  return { items: await listMedia() };
});
route('POST', '/admin/media', async (ctx) => {
  const user = await requireUser(ctx, 'moderator');
  await rateLimit('upload', user.id, { limit: 60, windowSec: 3600 });
  const item = await uploadMedia(ctx.req, user);
  await audit(user, 'imagem carregada', item.key, { name: item.name });
  return { item };
});
route('DELETE', '/admin/media/:key', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  await deleteMedia(ctx.params.key);
  await audit(user, 'imagem eliminada', ctx.params.key);
  return { ok: true };
});

// ---------- Administração: estatísticas, backups, auditoria ----------
route('GET', '/admin/stats', async (ctx) => {
  await requireUser(ctx, 'moderator');
  return getStats(ctx.url.searchParams.get('days'));
});
route('GET', '/admin/backups', async (ctx) => {
  await requireUser(ctx, 'admin');
  return { items: await listBackups() };
});
route('POST', '/admin/backups', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const body = await readJSON(ctx.req, 2000);
  const meta = await createBackup(user, 'manual', body.note || '');
  await audit(user, 'backup criado', meta.id);
  return { backup: meta };
});
route('POST', '/admin/backups/import', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const data = await readJSON(ctx.req, 5_500_000);
  const meta = await importBackup(data, user);
  await audit(user, 'backup importado', meta.id);
  return { backup: meta };
});
route('GET', '/admin/backups/:id', async (ctx) => {
  await requireUser(ctx, 'admin');
  const b = await getBackup(ctx.params.id);
  return new Response(JSON.stringify(b.data), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="robrun-pt-backup-${b.id}.json"`, 'cache-control': 'no-store' },
  });
});
route('POST', '/admin/backups/:id/restore', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  const r = await restoreBackup(ctx.params.id, user);
  await audit(user, 'backup restaurado', ctx.params.id);
  return r;
});
route('DELETE', '/admin/backups/:id', async (ctx) => {
  const user = await requireUser(ctx, 'admin');
  await deleteBackup(ctx.params.id);
  await audit(user, 'backup eliminado', ctx.params.id);
  return { ok: true };
});
route('GET', '/admin/audit', async (ctx) => {
  await requireUser(ctx, 'moderator');
  return { items: await listAudit(300) };
});

// ---------- Auxiliares ----------
function stripBody(item) {
  const { body, ...rest } = item;
  return rest;
}

async function deleteUserSessions(userId) {
  const keys = await listKeys('sessions', 's/');
  const sessions = await getMany('sessions', keys);
  for (let i = 0; i < keys.length; i++) if (sessions[i]?.userId === userId) await del('sessions', keys[i]);
}

// ---------- Handler ----------
export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const ctx = {
    req, url, params: {}, cookies: cookiesFrom(req), outCookies: [],
    ip: context?.ip || req.headers.get('x-nf-client-connection-ip') || 'desconhecido',
    setCookie(c) { this.outCookies.push(c); },
  };
  let res;
  try {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const candidates = routes.filter((r) => r.re.test(path));
    if (!candidates.length) throw new HttpError(404, 'Rota não encontrada.');
    const r = candidates.find((c) => c.method === method);
    if (!r) throw new HttpError(405, 'Método não permitido.');
    const m = path.match(r.re);
    r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
    if (r.csrf) verifyCsrf(ctx);
    const out = await r.handler(ctx);
    res = out instanceof Response ? out : json(out);
  } catch (e) {
    if (e instanceof HttpError) {
      const headers = e.extra?.retryAfter ? { 'retry-after': String(e.extra.retryAfter) } : {};
      res = json({ error: e.message, ...e.extra }, e.status, headers);
    } else {
      console.error('Erro interno', e);
      res = json({ error: 'Erro interno do servidor. Tenta novamente.' }, 500);
    }
  }
  for (const c of ctx.outCookies) res.headers.append('set-cookie', c);
  return res;
};

export const config = { path: '/api/*' };

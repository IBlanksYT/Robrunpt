// Cópias de segurança completas (site, versões publicadas, conteúdos, clips, utilizadores).
// As imagens binárias ficam na store rr-media (não são apagadas pelo restauro); o backup guarda a lista.
import { HttpError } from './http.mjs';
import { getJSON, putJSON, del, listKeys, getMany, newestFirstId, isSafeId, store } from './store.mjs';
import { privacyConfig } from './env.mjs';
import { listMedia } from './media.mjs';
import { sanitizeSite } from './sanitize.mjs';

async function dump(name, prefix) {
  const keys = await listKeys(name, prefix);
  const vals = await getMany(name, keys);
  const out = {};
  keys.forEach((k, i) => { if (vals[i] !== null) out[k] = vals[i]; });
  return out;
}

export async function buildSnapshot() {
  return {
    format: 'robrun-pt-backup',
    version: 1,
    createdAt: Date.now(),
    site: { draft: await getJSON('site', 'draft'), published: await getJSON('site', 'published') },
    content: await dump('content', ''),
    clips: await dump('clips', ''),
    users: await dump('users', 'u/'),
    media: (await listMedia()).map(({ key, name, size, contentType }) => ({ key, name, size, contentType })),
  };
}

export async function createBackup(user, kind = 'manual', note = '') {
  const data = await buildSnapshot();
  const id = newestFirstId();
  const meta = {
    id, kind, note: String(note).slice(0, 200), createdAt: data.createdAt, by: user?.name || 'Sistema',
    counts: { content: Object.keys(data.content).length, clips: Object.keys(data.clips).filter((k) => k.startsWith('c/')).length, users: Object.keys(data.users).length },
  };
  await putJSON('backups', `b/${id}`, { ...meta, data });
  return meta;
}

export async function listBackups() {
  const keys = await listKeys('backups', 'b/');
  const out = [];
  for (const k of keys) {
    const b = await store('backups').get(k, { type: 'json' });
    if (b) { const { data, ...meta } = b; out.push(meta); }
  }
  return out;
}

export async function getBackup(id) {
  if (!isSafeId(id)) throw new HttpError(400, 'Backup inválido.');
  const b = await getJSON('backups', `b/${id}`);
  if (!b) throw new HttpError(404, 'Backup não encontrado.');
  return b;
}

function validateSnapshot(d) {
  if (!d || d.format !== 'robrun-pt-backup' || typeof d.content !== 'object' || typeof d.clips !== 'object' || typeof d.users !== 'object') {
    throw new HttpError(400, 'Ficheiro de backup inválido.');
  }
  const keyOk = (k) => typeof k === 'string' && /^[A-Za-z0-9_\-/]{1,200}$/.test(k);
  for (const part of ['content', 'clips', 'users']) {
    for (const k of Object.keys(d[part])) if (!keyOk(k)) throw new HttpError(400, `Chave inválida no backup: ${part}`);
  }
}

async function replaceAll(name, prefix, entries) {
  for (const k of await listKeys(name, prefix)) if (!(k in entries)) await del(name, k);
  for (const [k, v] of Object.entries(entries)) await putJSON(name, k, v);
}

export async function restoreBackup(id, user) {
  const b = await getBackup(id);
  const d = b.data;
  validateSnapshot(d);
  await createBackup(user, 'antes de restaurar', `Automático antes de restaurar ${id}`);
  if (d.site?.draft) await putJSON('site', 'draft', sanitizeSite(d.site.draft));
  if (d.site?.published) await putJSON('site', 'published', sanitizeSite(d.site.published));
  await replaceAll('content', '', d.content);
  await replaceAll('clips', '', d.clips);
  await replaceAll('users', 'u/', d.users);
  return { restored: id };
}

export async function importBackup(data, user) {
  validateSnapshot(data);
  const id = newestFirstId();
  const meta = { id, kind: 'importado', note: 'Importado de ficheiro', createdAt: Date.now(), by: user.name, counts: { content: Object.keys(data.content).length, clips: Object.keys(data.clips).length, users: Object.keys(data.users).length } };
  await putJSON('backups', `b/${id}`, { ...meta, data });
  return meta;
}

export async function deleteBackup(id) {
  await getBackup(id);
  await del('backups', `b/${id}`);
}

export async function pruneAutoBackups() {
  const keep = privacyConfig().autoBackupsToKeep;
  const list = await listBackups();
  const auto = list.filter((b) => b.kind === 'automático');
  for (const b of auto.slice(keep)) await del('backups', `b/${b.id}`);
  // cópias "antes de restaurar" com mais de 60 dias
  const old = list.filter((b) => b.kind === 'antes de restaurar' && b.createdAt < Date.now() - 60 * 86400e3);
  for (const b of old) await del('backups', `b/${b.id}`);
}

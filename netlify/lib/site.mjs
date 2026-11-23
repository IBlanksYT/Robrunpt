// Documento do site: rascunho, publicado e histórico de versões.
import { getJSONMeta, putJSON, store, listKeys, getJSON, del, newestFirstId, isSafeId } from './store.mjs';
import { HttpError } from './http.mjs';
import { defaultSite, privacyConfig } from './env.mjs';
import { sanitizeSite } from './sanitize.mjs';

export async function getPublished() {
  const r = await getJSONMeta('site', 'published');
  return r ? r.data : structuredClone(defaultSite);
}

export async function getDraft() {
  const r = await getJSONMeta('site', 'draft');
  if (r) return { site: r.data, etag: r.etag };
  const pub = await getJSONMeta('site', 'published');
  return { site: pub ? pub.data : structuredClone(defaultSite), etag: null };
}

/** Guarda o rascunho com controlo de concorrência: baseEtag tem de corresponder ao atual. */
export async function saveDraft(input, baseEtag, user, { force = false } = {}) {
  const site = sanitizeSite(input);
  site.updatedAt = Date.now();
  site.updatedBy = user.name;
  const cur = await getJSONMeta('site', 'draft');
  let res;
  if (!cur) {
    res = await store('site').setJSON('draft', site, { onlyIfNew: true });
  } else if (force) {
    res = await store('site').setJSON('draft', site);
  } else {
    if (!baseEtag || baseEtag !== cur.etag) {
      throw new HttpError(409, 'O rascunho foi alterado noutra sessão. Recarrega ou força a gravação.', {
        conflict: true, updatedBy: cur.data?.updatedBy, updatedAt: cur.data?.updatedAt,
      });
    }
    res = await store('site').setJSON('draft', site, { onlyIfMatch: cur.etag });
  }
  if (!res.modified) throw new HttpError(409, 'O rascunho foi alterado em simultâneo. Tenta novamente.', { conflict: true });
  return { site, etag: res.etag };
}

export async function createVersion(site, user, kind, note = '') {
  const id = newestFirstId();
  await putJSON('versions', `v/${id}`, {
    id, kind, note: String(note).slice(0, 200), createdAt: Date.now(), by: user?.name || 'Sistema',
    pages: site.pages?.length || 0, site,
  });
  return id;
}

export async function publish(user, note) {
  const { site } = await getDraft();
  const clean = sanitizeSite(site);
  clean.publishedAt = Date.now();
  clean.publishedBy = user.name;
  await putJSON('site', 'published', clean);
  const id = await createVersion(clean, user, 'publicação', note);
  return { versionId: id, site: clean };
}

export async function listVersions() {
  const keys = await listKeys('versions', 'v/');
  const items = [];
  for (const k of keys.slice(0, 150)) {
    const v = await getJSON('versions', k);
    if (v) items.push({ id: v.id, kind: v.kind, note: v.note, createdAt: v.createdAt, by: v.by, pages: v.pages });
  }
  return items;
}

export async function getVersion(id) {
  if (!isSafeId(id)) throw new HttpError(400, 'Versão inválida.');
  const v = await getJSON('versions', `v/${id}`);
  if (!v) throw new HttpError(404, 'Versão não encontrada.');
  return v;
}

export async function restoreVersion(id, user, { publishNow = false } = {}) {
  const v = await getVersion(id);
  const { site: current } = await getDraft();
  await createVersion(current, user, 'cópia antes de restaurar', `Antes de restaurar ${new Date(v.createdAt).toISOString()}`);
  const site = sanitizeSite(v.site);
  site.updatedAt = Date.now();
  site.updatedBy = user.name;
  await putJSON('site', 'draft', site);
  if (publishNow) return publish(user, `Restauro da versão de ${new Date(v.createdAt).toLocaleString('pt-PT')}`);
  return { site };
}

export async function pruneVersions() {
  const keep = privacyConfig().versionsToKeep;
  const keys = await listKeys('versions', 'v/');
  for (const k of keys.slice(keep)) await del('versions', k);
  return Math.max(0, keys.length - keep);
}

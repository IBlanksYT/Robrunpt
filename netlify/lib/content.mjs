// Notícias, guias e clãs.
import { HttpError } from './http.mjs';
import { CONTENT_TYPES, sanitizeContent, cleanText, cleanLine } from './sanitize.mjs';
import { getJSON, putJSON, del, listKeys, getMany, newId, isSafeId, store } from './store.mjs';

function assertType(type) {
  if (!CONTENT_TYPES.includes(type)) throw new HttpError(404, 'Tipo de conteúdo desconhecido.');
}

function sortItems(type, items) {
  if (type === 'clans') {
    return items.sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order) || a.title.localeCompare(b.title, 'pt'));
  }
  return items.sort((a, b) => (b.pinned - a.pinned) || ((b.publishedAt || b.createdAt) - (a.publishedAt || a.createdAt)));
}

export async function listContent(type, { includeDrafts = false } = {}) {
  assertType(type);
  const keys = await listKeys('content', `${type}/`);
  const items = (await getMany('content', keys)).filter(Boolean).filter((i) => includeDrafts || i.published);
  return sortItems(type, items);
}

export async function getContent(type, id) {
  assertType(type);
  if (!isSafeId(id)) throw new HttpError(400, 'Identificador inválido.');
  const item = await getJSON('content', `${type}/${id}`);
  if (!item) throw new HttpError(404, 'Conteúdo não encontrado.');
  return item;
}

export async function createContent(type, input, user) {
  const data = sanitizeContent(type, input);
  const now = Date.now();
  const item = { id: newId(), type, ...data, createdAt: now, updatedAt: now, author: user.name, publishedAt: data.published ? now : null };
  await putJSON('content', `${type}/${item.id}`, item);
  return item;
}

export async function updateContent(type, id, input, user) {
  const cur = await getContent(type, id);
  const data = sanitizeContent(type, { ...cur, ...input });
  const item = {
    ...cur, ...data, updatedAt: Date.now(), updatedBy: user.name,
    publishedAt: data.published ? cur.publishedAt || Date.now() : cur.publishedAt || null,
  };
  if (type === 'clans' && cur.status && data.published && cur.status !== 'approved') {
    item.status = 'approved';
    item.reviewedBy = user.name;
    item.reviewedAt = Date.now();
  }
  await putJSON('content', `${type}/${id}`, item);
  return item;
}

export async function duplicateContent(type, id, user) {
  const cur = await getContent(type, id);
  return createContent(type, { ...cur, title: `${cur.title} (cópia)`, name: `${cur.title} (cópia)`, slug: '', published: false, pinned: false }, user);
}

export async function deleteContent(type, id) {
  const cur = await getContent(type, id);
  await del('content', `${type}/${id}`);
  if (type === 'clans' && cur.submittedBy) {
    const lock = await getJSON('content', `clansub/${cur.submittedBy}`);
    if (lock?.id === id) await del('content', `clansub/${cur.submittedBy}`);
  }
}

// ---------- Pedidos de clã enviados por jogadores (moderados no painel) ----------
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function getMyClanSubmission(userId) {
  const lock = await getJSON('content', `clansub/${userId}`);
  if (!lock) return null;
  const item = await getJSON('content', `clans/${lock.id}`);
  if (!item) return null;
  return { id: item.id, title: item.title, tag: item.tag, status: item.status || 'approved', rejectReason: item.rejectReason || '', createdAt: item.createdAt };
}

export async function submitClan(user, input) {
  if (input.website) throw new HttpError(400, 'Pedido rejeitado.');
  const existing = await getMyClanSubmission(user.id);
  if (existing) {
    throw new HttpError(409, existing.status === 'rejected'
      ? 'O teu pedido foi recusado pela equipa. Se achas que foi engano, fala connosco no Discord.'
      : 'Já enviaste o teu clã. Só é permitido um pedido por conta.');
  }
  const about = cleanText(input.about, 2000).trim();
  const data = sanitizeContent('clans', {
    title: input.title, tag: input.tag, cover: input.cover, summary: input.summary,
    recruiting: input.recruiting === true, requirements: input.requirements, members: input.members,
    contactUrl: input.contactUrl, tags: [],
    body: about ? about.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('') : '',
    published: false, pinned: false, order: 0,
  });
  if (data.summary.length < 10) throw new HttpError(400, 'Escreve uma descrição curta com pelo menos 10 caracteres.');
  if (!data.contactUrl || !/^https?:/i.test(data.contactUrl)) throw new HttpError(400, 'Indica um link de contacto válido (ex.: convite do Discord, https://discord.gg/...).');
  if (data.cover && !/^https:/i.test(data.cover)) data.cover = '';
  const now = Date.now();
  const item = {
    id: newId(), type: 'clans', ...data, status: 'pending', submittedBy: user.id, submittedByName: user.name,
    createdAt: now, updatedAt: now, author: user.name, publishedAt: null,
  };
  const claim = await store('content').setJSON(`clansub/${user.id}`, { id: item.id, at: now }, { onlyIfNew: true });
  if (!claim.modified) {
    // Bloqueio antigo de um pedido que já foi eliminado: pode ser reutilizado.
    if (await getMyClanSubmission(user.id)) throw new HttpError(409, 'Já enviaste o teu clã. Só é permitido um pedido por conta.');
    await putJSON('content', `clansub/${user.id}`, { id: item.id, at: now });
  }
  await putJSON('content', `clans/${item.id}`, item);
  return item;
}

export async function setClanStatus(id, status, user, reason = '') {
  const cur = await getContent('clans', id);
  const approved = status === 'approved';
  const item = {
    ...cur, status, published: approved,
    publishedAt: approved ? cur.publishedAt || Date.now() : cur.publishedAt || null,
    rejectReason: status === 'rejected' ? cleanLine(reason, 300) : '',
    reviewedBy: user.name, reviewedAt: Date.now(), updatedAt: Date.now(),
  };
  await putJSON('content', `clans/${id}`, item);
  return item;
}

/** RGPD: ao eliminar uma conta, remove pedidos pendentes/recusados e desliga o autor dos aprovados. */
export async function removeUserClanSubmission(userId) {
  const lock = await getJSON('content', `clansub/${userId}`);
  if (!lock) return;
  const item = await getJSON('content', `clans/${lock.id}`);
  if (item) {
    if (item.status === 'approved') {
      const { submittedBy, submittedByName, ...rest } = item;
      await putJSON('content', `clans/${item.id}`, rest);
    } else await del('content', `clans/${item.id}`);
  }
  await del('content', `clansub/${userId}`);
}

// Notícias, guias e clãs.
import { HttpError } from './http.mjs';
import { CONTENT_TYPES, sanitizeContent } from './sanitize.mjs';
import { getJSON, putJSON, del, listKeys, getMany, newId, isSafeId } from './store.mjs';

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
  await putJSON('content', `${type}/${id}`, item);
  return item;
}

export async function duplicateContent(type, id, user) {
  const cur = await getContent(type, id);
  return createContent(type, { ...cur, title: `${cur.title} (cópia)`, name: `${cur.title} (cópia)`, slug: '', published: false, pinned: false }, user);
}

export async function deleteContent(type, id) {
  await getContent(type, id);
  await del('content', `${type}/${id}`);
}

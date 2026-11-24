// Clips de jogadores: publicação automática com validação, anti-spam e moderação.
import { HttpError } from './http.mjs';
import { parseVideoUrl, youtubeResult } from './video.mjs';
import { cleanLine, cleanText } from './sanitize.mjs';
import { store, getJSON, putJSON, del, listKeys, getMany, newestFirstId, isSafeId, updateJSON } from './store.mjs';
import { rateLimit } from './ratelimit.mjs';
import { getUser, publicUser } from './users.mjs';

const TIKTOK_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

async function resolveTikTokShort(shortUrl) {
  let url = shortUrl;
  for (let hop = 0; hop < 5; hop++) {
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'Mozilla/5.0 (RobRunPT link check)' } });
    } catch {
      throw new HttpError(422, 'Não foi possível abrir o link curto do TikTok. Usa o link completo do vídeo.');
    }
    const loc = res.headers.get('location');
    if (!loc) break;
    const next = new URL(loc, url);
    if (!TIKTOK_HOSTS.has(next.hostname.toLowerCase())) throw new HttpError(422, 'O link curto não aponta para o TikTok.');
    const parsed = parseVideoUrl(next.href);
    if (parsed.ok && !parsed.needsResolve) return parsed;
    url = next.href;
  }
  throw new HttpError(422, 'Não foi possível resolver o link curto do TikTok. Usa o link completo do vídeo.');
}

// Confirma (quando possível) que o vídeo existe e é público através do oEmbed oficial.
async function checkOEmbed(v) {
  const endpoint = v.platform === 'youtube'
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(v.url)}`
    : `https://www.tiktok.com/oembed?url=${encodeURIComponent(v.url)}`;
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
    if ([400, 401, 403, 404].includes(res.status)) {
      throw new HttpError(422, 'O vídeo não existe, é privado ou não permite incorporação.');
    }
    return res.ok;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null; // rede indisponível: não bloqueia a publicação, o embed oficial trata do resto
  }
}

export async function normalizeClipUrl(raw) {
  let v = parseVideoUrl(raw);
  if (!v.ok) throw new HttpError(422, v.error);
  if (v.needsResolve) v = await resolveTikTokShort(v.shortUrl);
  return v;
}

async function withAuthors(clips) {
  const ids = [...new Set(clips.map((c) => c.userId))];
  const users = new Map();
  await Promise.all(ids.map(async (id) => users.set(id, publicUser(await getUser(id)))));
  return clips.map((c) => {
    const author = users.get(c.userId) || { id: c.userId, name: c.authorName || 'Jogador', picture: '' };
    return { ...c, author };
  });
}

export function publicClip(c) {
  const { hidden, moderationNote, ...rest } = c;
  return rest;
}

export async function createClip(user, input) {
  if (input.website) throw new HttpError(400, 'Pedido rejeitado.'); // honeypot anti-bot
  const title = cleanLine(input.title, 100);
  const description = cleanText(input.description, 500).trim();
  if (title.length < 3) throw new HttpError(400, 'O título tem de ter pelo menos 3 caracteres.');
  if ((description.match(/https?:\/\/|www\./gi) || []).length > 1) throw new HttpError(400, 'A descrição não pode conter vários links.');
  if (/(.)\1{14,}/.test(title + description)) throw new HttpError(400, 'Texto repetitivo detetado.');
  const pre = parseVideoUrl(input.url);
  if (!pre.ok) throw new HttpError(422, pre.error);

  await rateLimit('clip-attempts', user.id, { limit: 30, windowSec: 3600, message: 'Demasiadas tentativas. Tenta mais tarde.' });
  const v = await normalizeClipUrl(input.url);
  const dup = await getJSON('clips', `idx/${v.platform}-${v.videoId}`);
  if (dup && (await getJSON('clips', `c/${dup.clipId}`))) throw new HttpError(409, 'Este vídeo já foi publicado na comunidade.');
  await checkOEmbed(v);

  await rateLimit('clip-burst', user.id, { limit: 1, windowSec: 30, message: 'Espera 30 segundos entre publicações.' });
  await rateLimit('clip-hour', user.id, { limit: 5, windowSec: 3600, message: 'Atingiste o limite de 5 clips por hora.' });
  await rateLimit('clip-day', user.id, { limit: 15, windowSec: 86400, message: 'Atingiste o limite de 15 clips por dia.' });

  const id = newestFirstId();
  const idxKey = `idx/${v.platform}-${v.videoId}`;
  const claim = await store('clips').setJSON(idxKey, { clipId: id, userId: user.id }, { onlyIfNew: true });
  if (!claim.modified) {
    const existing = await getJSON('clips', idxKey);
    const stillThere = existing && (await getJSON('clips', `c/${existing.clipId}`));
    if (stillThere) throw new HttpError(409, 'Este vídeo já foi publicado na comunidade.');
    await putJSON('clips', idxKey, { clipId: id, userId: user.id });
  }
  const now = Date.now();
  const clip = {
    id,
    userId: user.id,
    authorName: user.name,
    platform: v.platform,
    videoId: v.videoId,
    kind: v.kind,
    url: v.url,
    embedUrl: v.embedUrl,
    thumbnail: v.thumbnail || '',
    title,
    description,
    createdAt: now,
    updatedAt: now,
    hidden: false,
    featured: false,
  };
  await putJSON('clips', `c/${id}`, clip);
  await putJSON('clips', `byuser/${user.id}/${id}`, { at: now });
  return (await withAuthors([clip]))[0];
}

export async function getClip(id) {
  if (!isSafeId(id)) return null;
  return getJSON('clips', `c/${id}`);
}

export async function listClips({ limit = 24, cursor = 0, userId = null, includeHidden = false, featuredOnly = false } = {}) {
  limit = Math.min(60, Math.max(1, Number(limit) || 24));
  let keys;
  if (userId) {
    if (!isSafeId(userId)) return { items: [], nextCursor: null };
    keys = (await listKeys('clips', `byuser/${userId}/`)).map((k) => `c/${k.split('/').pop()}`).sort();
  } else {
    keys = await listKeys('clips', 'c/');
  }
  const items = [];
  let i = Math.max(0, Number(cursor) || 0);
  while (i < keys.length && items.length < limit) {
    const batch = keys.slice(i, i + limit * 2);
    const loaded = await getMany('clips', batch);
    for (let j = 0; j < loaded.length; j++) {
      i++;
      const c = loaded[j];
      if (!c) continue;
      if (!includeHidden && c.hidden) continue;
      if (featuredOnly && !c.featured) continue;
      items.push(c);
      if (items.length >= limit) break;
    }
  }
  const out = await withAuthors(items);
  return { items: includeHidden ? out : out.map(publicClip), nextCursor: i < keys.length ? i : null, total: keys.length };
}

export async function updateClip(id, patch) {
  const updated = await updateJSON('clips', `c/${id}`, (c) => {
    if (!c) return undefined;
    if (patch.title !== undefined) {
      const t = cleanLine(patch.title, 100);
      if (t.length < 3) throw new HttpError(400, 'Título demasiado curto.');
      c.title = t;
    }
    if (patch.description !== undefined) c.description = cleanText(patch.description, 500).trim();
    if (patch.hidden !== undefined) c.hidden = !!patch.hidden;
    if (patch.featured !== undefined) c.featured = !!patch.featured;
    if (patch.moderationNote !== undefined) c.moderationNote = cleanLine(patch.moderationNote, 200);
    c.updatedAt = Date.now();
    return c;
  });
  if (!updated) throw new HttpError(404, 'Clip não encontrado.');
  return updated;
}

export async function deleteClip(clip) {
  await del('clips', `c/${clip.id}`);
  await del('clips', `byuser/${clip.userId}/${clip.id}`);
  const idx = await getJSON('clips', `idx/${clip.platform}-${clip.videoId}`);
  if (idx?.clipId === clip.id) await del('clips', `idx/${clip.platform}-${clip.videoId}`);
}

export async function deleteClipsOfUser(userId) {
  const keys = await listKeys('clips', `byuser/${userId}/`);
  let n = 0;
  for (const k of keys) {
    const c = await getClip(k.split('/').pop());
    if (c) { await deleteClip(c); n++; } else await del('clips', k);
  }
  return n;
}

export { youtubeResult };

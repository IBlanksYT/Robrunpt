// Validação e normalização de links de vídeo. Partilhado entre servidor e browser
// (o build copia este ficheiro para public/assets/js/video.js). Sem dependências.
// Só são aceites YouTube (incluindo Shorts) e TikTok. Tudo o resto é rejeitado.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const TT_ID = /^\d{8,25}$/;
const TT_USER = /^[A-Za-z0-9._]{1,40}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const TT_HOSTS = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com']);
const TT_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

const fail = (error) => ({ ok: false, error });

export function youtubeResult(id, kind) {
  return {
    ok: true,
    platform: 'youtube',
    videoId: id,
    kind,
    url: kind === 'shorts' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

export function tiktokResult(id, user) {
  return {
    ok: true,
    platform: 'tiktok',
    videoId: id,
    kind: 'video',
    url: user ? `https://www.tiktok.com/@${user}/video/${id}` : `https://m.tiktok.com/v/${id}.html`,
    embedUrl: `https://www.tiktok.com/player/v1/${id}`,
    thumbnail: '',
  };
}

export function parseVideoUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return fail('Indica o link do vídeo.');
  if (s.length > 600) return fail('O link é demasiado longo.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return fail('O link não é válido.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail('O link tem de começar por https://');
  if (u.username || u.password || u.port) return fail('O link não é válido.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (YT_HOSTS.has(host)) {
    if (host === 'youtu.be') {
      const id = parts[0];
      return id && YT_ID.test(id) && parts.length === 1 ? youtubeResult(id, 'video') : fail('Link do YouTube inválido.');
    }
    if (parts[0] === 'watch' && parts.length === 1) {
      const id = u.searchParams.get('v');
      return id && YT_ID.test(id) ? youtubeResult(id, 'video') : fail('Link do YouTube inválido.');
    }
    if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && parts.length === 2 && YT_ID.test(parts[1])) {
      return youtubeResult(parts[1], parts[0] === 'shorts' ? 'shorts' : 'video');
    }
    return fail('Link do YouTube inválido. Usa o link de um vídeo ou de um Short.');
  }

  if (TT_SHORT_HOSTS.has(host)) {
    if (parts.length === 1 && /^[A-Za-z0-9]{5,20}$/.test(parts[0])) {
      return { ok: true, platform: 'tiktok', needsResolve: true, shortUrl: `https://${host}/${parts[0]}/` };
    }
    return fail('Link curto do TikTok inválido.');
  }

  if (TT_HOSTS.has(host)) {
    // /@utilizador/video/ID
    if (parts.length === 3 && parts[0].startsWith('@') && parts[1] === 'video') {
      const user = parts[0].slice(1);
      if (TT_USER.test(user) && TT_ID.test(parts[2])) return tiktokResult(parts[2], user);
    }
    // m.tiktok.com/v/ID.html
    if (parts.length === 2 && parts[0] === 'v') {
      const id = parts[1].replace(/\.html$/, '');
      if (TT_ID.test(id)) return tiktokResult(id, null);
    }
    // /embed/v2/ID, /embed/ID, /player/v1/ID
    const last = parts[parts.length - 1];
    if ((parts[0] === 'embed' || (parts[0] === 'player' && parts[1] === 'v1')) && TT_ID.test(last || '')) {
      return tiktokResult(last, null);
    }
    return fail('Link do TikTok inválido. Usa o link de um vídeo (…/@utilizador/video/…).');
  }

  return fail('Só são aceites links do YouTube ou do TikTok.');
}

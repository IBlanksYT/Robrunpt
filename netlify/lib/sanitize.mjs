// Sanitização e validação de todos os dados recebidos do browser.
import sanitizeHtml from 'sanitize-html';
import { HttpError } from './http.mjs';

export const FONTS = [
  'Rajdhani', 'Inter', 'Russo One', 'Orbitron', 'Oxanium', 'Chakra Petch',
  'Bebas Neue', 'Exo 2', 'Teko', 'Poppins', 'Montserrat', 'Barlow Condensed',
];

const RICH_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre', 'hr'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const href = cleanUrl(attribs.href || '');
      const external = /^https?:/i.test(href);
      return {
        tagName: 'a',
        attribs: external ? { href, target: '_blank', rel: 'noopener noreferrer nofollow' } : { href },
      };
    },
  },
};

export function cleanRich(html, max = 60000) {
  return sanitizeHtml(String(html ?? '').slice(0, max * 2), RICH_OPTIONS).slice(0, max);
}

export function cleanText(s, max = 5000) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, max);
}

export function cleanLine(s, max = 300) {
  return cleanText(s, max).replace(/[\r\n]+/g, ' ').trim();
}

const TOKEN = /^\{\{(siteName|discordUrl|contactEmail|tiktok|youtube|instagram|x|twitch)\}\}$/;

export function cleanUrl(s) {
  const v = String(s ?? '').trim().slice(0, 2000);
  if (!v) return '';
  if (TOKEN.test(v)) return v;
  if (/[\u0000-\u001F\u007F\s"'<>\\`]/.test(v)) return '';
  if (v.startsWith('#')) return /^#[A-Za-z0-9_-]{0,80}$/.test(v) ? v : '';
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch { /* inválido */ }
  return '';
}

export function cleanColor(s) {
  const v = String(s ?? '').trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i.test(v)) return v;
  if (v === 'transparent') return v;
  return '';
}

export function slugify(s, max = 60) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max) || '';
}

// ---- Documento do site (páginas, secções, tema, cabeçalho, rodapé) ----
function cleanByKey(key, parentKey, v) {
  if (key === 'body') return cleanRich(v);
  if (parentKey === 'colors' || /color$/i.test(key)) return cleanColor(v);
  if (parentKey === 'fonts') return FONTS.includes(v) ? v : 'Inter';
  if (parentKey === 'social' || /^(href|url|src|image|favicon)$/i.test(key) || /(Href|Url|Src|Image)$/.test(key)) return cleanUrl(v);
  if (key === 'id' || key === 'type') return String(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (key === 'slug') return slugify(v);
  return cleanText(v, 20000);
}

function walk(v, key, parentKey, depth) {
  if (depth > 14) return undefined;
  if (v === null) return null;
  if (Array.isArray(v)) {
    return v.slice(0, 300).map((x) => walk(x, key, parentKey, depth + 1)).filter((x) => x !== undefined);
  }
  if (typeof v === 'object') {
    const o = {};
    let n = 0;
    for (const [k, val] of Object.entries(v)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) continue;
      if (++n > 120) break;
      const r = walk(val, k, key, depth + 1);
      if (r !== undefined) o[k] = r;
    }
    return o;
  }
  if (typeof v === 'string') return cleanByKey(key, parentKey, v);
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : 0;
  if (typeof v === 'boolean') return v;
  return undefined;
}

export function sanitizeSite(doc) {
  if (!doc || typeof doc !== 'object') throw new HttpError(400, 'Documento do site inválido.');
  if (JSON.stringify(doc).length > 3_000_000) throw new HttpError(413, 'O site é demasiado grande (máx. 3 MB).');
  const s = walk(doc, '', '', 0) || {};
  for (const k of ['theme', 'header', 'footer', 'settings']) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
  if (!Array.isArray(s.pages) || !s.pages.length) throw new HttpError(400, 'O site tem de ter pelo menos uma página.');
  if (s.pages.length > 80) throw new HttpError(400, 'Máximo de 80 páginas.');
  const ids = new Set();
  const slugs = new Set();
  s.pages = s.pages.filter((p) => p && typeof p === 'object').map((p, i) => {
    let id = p.id || `p${i}`;
    while (ids.has(id)) id += 'x';
    ids.add(id);
    let slug = p.home ? 'inicio' : slugify(p.slug || p.title || id) || id;
    if (['api', 'admin', 'assets', 'config', 'preview', 'page', 'index'].includes(slug)) slug = `${slug}-pagina`;
    while (slugs.has(slug)) slug += '-2';
    slugs.add(slug);
    const sections = (Array.isArray(p.sections) ? p.sections : []).slice(0, 60).filter((x) => x && typeof x === 'object' && x.type);
    const secIds = new Set();
    for (const sec of sections) {
      if (!sec.id || secIds.has(sec.id)) sec.id = `s${Math.random().toString(36).slice(2, 10)}`;
      secIds.add(sec.id);
      if (!sec.props || typeof sec.props !== 'object') sec.props = {};
      if (!sec.style || typeof sec.style !== 'object') sec.style = {};
    }
    return {
      ...p,
      id,
      slug,
      title: cleanLine(p.title || 'Página', 120) || 'Página',
      home: !!p.home,
      showInMenu: p.showInMenu !== false,
      sections,
    };
  });
  if (!s.pages.some((p) => p.home)) s.pages[0].home = true, (s.pages[0].slug = 'inicio');
  let homeSeen = false;
  for (const p of s.pages) { if (p.home) { if (homeSeen) p.home = false; homeSeen = true; } }
  s.schema = Math.max(2, Number(doc.schema) || 0);
  return s;
}

// ---- Conteúdos geridos (notícias, guias, clãs) ----
export const CONTENT_TYPES = ['news', 'guides', 'clans'];

export function sanitizeContent(type, input) {
  if (!CONTENT_TYPES.includes(type)) throw new HttpError(404, 'Tipo de conteúdo desconhecido.');
  const title = cleanLine(type === 'clans' ? input.name ?? input.title : input.title, 120);
  if (title.length < 2) throw new HttpError(400, type === 'clans' ? 'O nome do clã é obrigatório.' : 'O título é obrigatório.');
  const base = {
    title,
    slug: slugify(input.slug || title),
    summary: cleanText(input.summary, 400).trim(),
    body: cleanRich(input.body),
    cover: cleanUrl(input.cover),
    tags: (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(','))
      .map((t) => cleanLine(t, 30)).filter(Boolean).slice(0, 10),
    published: input.published === true,
    pinned: input.pinned === true,
    order: Number.isFinite(Number(input.order)) ? Math.trunc(Number(input.order)) : 0,
  };
  if (type === 'guides') {
    base.category = cleanLine(input.category, 60);
    base.difficulty = ['iniciante', 'intermedio', 'avancado'].includes(input.difficulty) ? input.difficulty : '';
  }
  if (type === 'clans') {
    base.tag = cleanLine(input.tag, 12);
    base.recruiting = input.recruiting === true;
    base.requirements = cleanText(input.requirements, 600).trim();
    base.contactUrl = cleanUrl(input.contactUrl);
    base.members = cleanLine(input.members, 20);
  }
  return base;
}

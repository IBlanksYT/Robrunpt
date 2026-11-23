// Renderer partilhado: site público e pré-visualização do CMS usam exatamente o mesmo código.
import { h } from './dom.js';
import { sanitizeHtml, safeUrl } from './sanitize-client.js';
import { parseVideoUrl } from './video.js';

const pick = (v, allowed, def) => (allowed.includes(v) ? v : def);
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const color = (v) => (/^#[0-9a-f]{3,8}$/i.test(v || '') || /^rgba?\([\d\s.,]+\)$/i.test(v || '') || v === 'transparent' ? v : '');

// ---------- Tokens {{...}} ----------
export function tokenValue(name, site) {
  const s = site.settings || {};
  const social = s.social || {};
  const map = { siteName: s.siteName, discordUrl: s.discordUrl, contactEmail: s.contactEmail, ...social };
  return map[name] || '';
}

export function tokens(str, site) {
  return String(str ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = tokenValue(k, site);
    if (v) return v;
    return k === 'contactEmail' ? '[email de contacto por definir]' : '';
  });
}

export function href(v, site) {
  const raw = String(v || '').trim();
  const resolved = /^\{\{\w+\}\}$/.test(raw) ? tokenValue(raw.slice(2, -2), site) : raw;
  return safeUrl(resolved);
}

const isExternal = (u) => /^https?:/i.test(u) && !u.startsWith(location.origin);
function linkAttrs(u) {
  return isExternal(u) ? { href: u, target: '_blank', rel: 'noopener noreferrer' } : { href: u };
}

export function pagePath(page) {
  return page.home ? '/' : `/${page.slug}`;
}

export function findPage(site, pathname) {
  let p = decodeURIComponent(pathname || '/').replace(/\/+$/, '').replace(/\.html$/, '').replace(/^\/p\//, '/');
  if (p === '' || p === '/index' || p === '/page') return site.pages.find((x) => x.home) || site.pages[0];
  const slug = p.replace(/^\//, '').toLowerCase();
  return site.pages.find((x) => x.slug === slug) || null;
}

// ---------- Tema ----------
export function applyTheme(site, root = document.documentElement) {
  const t = site.theme || {};
  const c = t.colors || {};
  const set = (k, v) => { if (v !== '' && v !== undefined && v !== null) root.style.setProperty(k, v); };
  set('--c-bg', color(c.bg) || '#07090a');
  set('--c-surface', color(c.surface) || '#101416');
  set('--c-surface-2', color(c.surface2) || '#171d20');
  set('--c-text', color(c.text) || '#f4f6f5');
  set('--c-muted', color(c.muted) || '#9aa5a0');
  set('--c-primary', color(c.primary) || '#1fbf5b');
  set('--c-secondary', color(c.secondary) || '#e1263b');
  set('--c-accent', color(c.accent) || '#ffffff');
  set('--c-border', color(c.border) || '#243035');
  const fonts = t.fonts || {};
  const safeFont = (f, d) => (/^[A-Za-z0-9 ]{2,40}$/.test(f || '') ? f : d);
  set('--font-heading', `'${safeFont(fonts.heading, 'Rajdhani')}', system-ui, sans-serif`);
  set('--font-body', `'${safeFont(fonts.body, 'Inter')}', system-ui, sans-serif`);
  set('--radius', `${num(t.radius, 0, 32, 14)}px`);
  set('--space', String(num(t.spacing, 60, 160, 100) / 100));
  set('--border-w', `${num(t.borderWidth, 0, 4, 1)}px`);
  root.dataset.headings = t.uppercaseHeadings === false ? 'normal' : 'upper';
  root.dataset.bg = pick(t.bgStyle, ['glow', 'grid', 'plain'], 'glow');
}

// ---------- Campos de texto (com suporte a edição inline no CMS) ----------
function tf(ctx, tag, key, value, attrs = {}, site) {
  const raw = String(value ?? '');
  const shown = site ? tokens(raw, site) : raw;
  const a = { ...attrs };
  if (ctx.mode === 'preview') {
    a['data-field'] = key;
    if (shown !== raw) a['data-raw'] = raw;
  }
  if (!raw && ctx.mode !== 'preview') return null;
  return h(tag, a, shown);
}

function richBody(ctx, html, site) {
  const div = h('div', { class: 'rr-prose' });
  div.append(sanitizeHtml(tokens(html, site)));
  if (ctx.mode === 'preview') div.dataset.rich = 'body';
  return div;
}

function button(label, url, variant, site, extraClass = '') {
  const u = href(url, site);
  if (!label) return null;
  const v = pick(variant, ['primary', 'secondary', 'ghost'], 'primary');
  if (!u) return h('span', { class: `rr-btn rr-btn--${v} is-disabled ${extraClass}`, title: 'Link por definir' }, label);
  return h('a', { class: `rr-btn rr-btn--${v} ${extraClass}`, ...linkAttrs(u) }, label);
}

function img(src, alt, attrs = {}) {
  const u = safeUrl(src);
  if (!u) return null;
  return h('img', { src: u, alt: alt || '', loading: 'lazy', decoding: 'async', ...attrs });
}

function sectionHead(ctx, p, site, keys = ['heading', 'intro']) {
  const [hk, ik] = keys;
  const title = tf(ctx, 'h2', hk, p[hk], { class: 'rr-h2' }, site);
  const intro = ik ? tf(ctx, 'p', ik, p[ik], { class: 'rr-lead' }, site) : null;
  if (!title && !intro) return null;
  return h('header', { class: 'rr-sec-head' }, title, intro);
}

// ---------- Secções ----------
const R = {};

R.hero = (s, site, ctx) => {
  const p = s.props;
  const height = pick(p.height, ['sm', 'md', 'lg', 'full'], 'md');
  const align = pick(p.align, ['left', 'center'], 'left');
  const bg = safeUrl(p.image);
  const buttons = (p.buttons || []).map((b, i) => {
    const el = button(b.label, b.href, b.variant, site);
    if (el && ctx.mode === 'preview') el.dataset.field = `buttons.${i}.label`;
    return el;
  });
  const side = img(p.sideImage, '', { class: 'rr-hero__side' });
  return {
    className: `rr-hero rr-hero--${height} rr-hero--${align}${side ? ' rr-hero--has-side' : ''}`,
    style: bg ? { '--hero-img': `url("${bg}")`, '--hero-overlay': num(p.overlay, 0, 95, 60) / 100 } : { '--hero-overlay': num(p.overlay, 0, 95, 60) / 100 },
    bgLayer: bg ? h('div', { class: 'rr-hero__bg', 'aria-hidden': 'true' }) : h('div', { class: 'rr-hero__bg rr-hero__bg--none', 'aria-hidden': 'true' }),
    content: h('div', { class: 'rr-hero__grid' },
      h('div', { class: 'rr-hero__text' },
        tf(ctx, 'span', 'eyebrow', p.eyebrow, { class: 'rr-eyebrow' }, site),
        tf(ctx, 'h1', 'title', p.title, { class: 'rr-hero__title' }, site),
        tf(ctx, 'p', 'subtitle', p.subtitle, { class: 'rr-hero__sub' }, site),
        buttons.some(Boolean) ? h('div', { class: 'rr-actions' }, buttons) : null),
      side),
  };
};

R.text = (s, site, ctx) => {
  const p = s.props;
  return { className: `rr-align-${pick(p.align, ['left', 'center', 'right'], 'left')}`, content: [tf(ctx, 'h2', 'heading', p.heading, { class: 'rr-h2' }, site), richBody(ctx, p.body, site)] };
};

R.split = (s, site, ctx) => {
  const p = s.props;
  const pos = pick(p.imagePosition, ['left', 'right'], 'right');
  return {
    content: h('div', { class: `rr-split rr-split--${pos}` },
      h('div', { class: 'rr-split__text' }, tf(ctx, 'h2', 'heading', p.heading, { class: 'rr-h2' }, site), richBody(ctx, p.body, site),
        p.buttonLabel ? h('div', { class: 'rr-actions' }, button(p.buttonLabel, p.buttonHref, 'primary', site)) : null),
      h('div', { class: 'rr-split__media' }, img(p.image, p.imageAlt) || h('div', { class: 'rr-placeholder' }, 'Escolhe uma imagem'))),
  };
};

R.features = (s, site, ctx) => {
  const p = s.props;
  const cols = num(p.columns, 2, 4, 3);
  return {
    content: [sectionHead(ctx, p, site), h('div', { class: `rr-grid rr-cols-${cols}` }, (p.items || []).map((it, i) => {
      const u = href(it.href, site);
      return h('article', { class: 'rr-card rr-feature reveal' },
        it.icon ? h('div', { class: 'rr-feature__icon', 'aria-hidden': 'true' }, it.icon) : null,
        tf(ctx, 'h3', `items.${i}.title`, it.title, { class: 'rr-h3' }, site),
        tf(ctx, 'p', `items.${i}.text`, it.text, { class: 'rr-muted' }, site),
        u ? h('a', { class: 'rr-link-arrow', ...linkAttrs(u) }, it.linkLabel || 'Saber mais') : null);
    }))],
  };
};

R.cta = (s, site, ctx) => {
  const p = s.props;
  return {
    content: h('div', { class: 'rr-cta reveal' },
      h('div', {}, tf(ctx, 'h2', 'title', p.title, { class: 'rr-h2' }, site), tf(ctx, 'p', 'text', p.text, { class: 'rr-lead' }, site)),
      button(p.buttonLabel, p.buttonHref, p.variant, site, 'rr-btn--lg')),
  };
};

R.image = (s, site, ctx) => {
  const p = s.props;
  const size = pick(p.size, ['normal', 'wide', 'full'], 'normal');
  let el = img(p.src, p.alt, { class: p.rounded === false ? '' : 'rr-rounded' }) || h('div', { class: 'rr-placeholder' }, 'Escolhe uma imagem');
  const u = href(p.href, site);
  if (u) el = h('a', linkAttrs(u), el);
  return { className: `rr-image rr-image--${size}`, content: h('figure', { class: 'rr-figure' }, el, tf(ctx, 'figcaption', 'caption', p.caption, {}, site)) };
};

R.gallery = (s, site, ctx) => {
  const p = s.props;
  const cols = num(p.columns, 2, 4, 3);
  const images = (p.images || []).filter((i) => safeUrl(i.src));
  if (!images.length && ctx.mode !== 'preview') return { content: null, className: 'hide-mobile hide-desktop' };
  return {
    content: [sectionHead(ctx, p, site, ['heading']),
      images.length
        ? h('div', { class: `rr-gallery rr-cols-${cols}` }, images.map((im) => h('figure', { class: 'rr-gallery__item reveal' }, img(im.src, im.alt), im.caption ? h('figcaption', {}, im.caption) : null)))
        : (ctx.mode === 'preview' ? h('div', { class: 'rr-placeholder' }, 'Adiciona imagens à galeria no painel da direita') : null)],
  };
};

R.video = (s, site, ctx) => {
  const p = s.props;
  const v = parseVideoUrl(p.url || '');
  let player;
  if (v.ok && !v.needsResolve) player = clipPlayer(v);
  else player = ctx.mode === 'preview' ? h('div', { class: 'rr-placeholder' }, p.url ? 'Link inválido: só YouTube ou TikTok (links completos)' : 'Indica um link do YouTube ou TikTok') : null;
  return { className: 'rr-align-center', content: [tf(ctx, 'h2', 'heading', p.heading, { class: 'rr-h2' }, site), h('div', { class: 'rr-video-wrap' }, player), tf(ctx, 'p', 'caption', p.caption, { class: 'rr-muted' }, site)] };
};

R.rules = (s, site, ctx) => {
  const p = s.props;
  return {
    content: [sectionHead(ctx, p, site), h('ol', { class: 'rr-rules' }, (p.items || []).map((it, i) => h('li', { class: 'rr-rule reveal' },
      h('span', { class: 'rr-rule__n', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
      h('div', {}, tf(ctx, 'h3', `items.${i}.title`, it.title, { class: 'rr-h3' }, site), tf(ctx, 'p', `items.${i}.text`, it.text, { class: 'rr-muted' }, site)))))],
  };
};

R.discord = (s, site, ctx) => {
  const p = s.props;
  const u = href(p.url, site);
  return {
    content: h('div', { class: 'rr-discord reveal' },
      h('div', { class: 'rr-discord__icon', 'aria-hidden': 'true' }, discordSvg()),
      h('div', { class: 'rr-discord__text' }, tf(ctx, 'h2', 'title', p.title, { class: 'rr-h2' }, site), tf(ctx, 'p', 'text', p.text, { class: 'rr-lead' }, site)),
      u ? h('a', { class: 'rr-btn rr-btn--discord rr-btn--lg', ...linkAttrs(u) }, p.buttonLabel || 'Entrar no Discord')
        : h('span', { class: 'rr-btn rr-btn--ghost is-disabled' }, ctx.mode === 'preview' ? 'Define o convite em Definições' : 'Convite brevemente')),
  };
};

R.faq = (s, site, ctx) => {
  const p = s.props;
  return {
    className: 'rr-w-narrow-inner',
    content: [sectionHead(ctx, p, site, ['heading']), h('div', { class: 'rr-faq' }, (p.items || []).map((it, i) => h('details', { class: 'rr-faq__item', open: ctx.mode === 'preview' && i === 0 },
      h('summary', {}, tf(ctx, 'span', `items.${i}.q`, it.q, {}, site)), tf(ctx, 'p', `items.${i}.a`, it.a, { class: 'rr-muted' }, site))))],
  };
};

R.notice = (s, site, ctx) => {
  const p = s.props;
  const tone = pick(p.tone, ['info', 'warning', 'success'], 'info');
  return { content: h('div', { class: `rr-notice rr-notice--${tone}`, role: 'note' }, h('strong', { class: 'rr-notice__title' }, tf(ctx, 'span', 'title', p.title, {}, site)), tf(ctx, 'p', 'text', p.text, {}, site)) };
};

R.spacer = (s) => {
  const p = s.props;
  return { className: 'rr-spacer', style: { '--spacer-h': `${num(p.height, 8, 240, 48)}px` }, content: p.line ? h('hr', { class: 'rr-hr' }) : null, bare: true };
};

// Secções dinâmicas: delegadas em widgets.js (injetado em ctx.widgets)
for (const t of ['feed', 'clipSubmit', 'auth', 'profile']) {
  R[t] = (s, site, ctx) => {
    const mount = h('div', { class: `rr-dyn rr-dyn--${t}` });
    const head = t === 'feed' ? sectionHead(ctx, s.props, site) : null;
    if (ctx.widgets?.[t]) queueMicrotask(() => ctx.widgets[t](mount, s, site, ctx));
    return { content: [head, mount] };
  };
}

export function renderSection(s, site, ctx) {
  const fn = R[s.type];
  if (!fn) return ctx.mode === 'preview' ? h('section', { class: 'rr-sec', 'data-section-id': s.id }, h('div', { class: 'rr-container' }, h('div', { class: 'rr-placeholder' }, `Secção desconhecida: ${s.type}`))) : null;
  const out = fn({ ...s, props: s.props || {} }, site, ctx);
  const st = s.style || {};
  const width = pick(st.width, ['narrow', 'wide', 'full'], 'normal');
  const style = { ...(out.style || {}) };
  if (color(st.bgColor)) style['--sec-bg'] = st.bgColor;
  if (color(st.textColor)) style.color = st.textColor;
  if (st.padTop !== undefined && st.padTop !== '') style['--pad-top'] = `${num(st.padTop, 0, 240, 80)}px`;
  if (st.padBottom !== undefined && st.padBottom !== '') style['--pad-bottom'] = `${num(st.padBottom, 0, 240, 80)}px`;
  if (num(st.borderWidth, 0, 8, 0) > 0) style.border = `${num(st.borderWidth, 0, 8, 0)}px solid ${color(st.borderColor) || 'var(--c-border)'}`;
  if (num(st.radius, 0, 48, 0) > 0) style['border-radius'] = `${num(st.radius, 0, 48, 0)}px`;
  const bgImg = safeUrl(st.bgImage);
  if (bgImg) { style['--sec-img'] = `url("${bgImg}")`; style['--sec-overlay'] = num(st.bgOverlay, 0, 95, 50) / 100; }
  const classes = ['rr-sec', `rr-sec--${s.type}`, out.className || '', bgImg ? 'has-img' : '', st.hideOnMobile ? 'hide-mobile' : '', st.hideOnDesktop ? 'hide-desktop' : '', st.align ? `rr-align-${pick(st.align, ['left', 'center', 'right'], 'left')}` : ''];
  const anchor = String(st.anchor || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  const section = h('section', { class: classes.filter(Boolean).join(' '), style, id: anchor || null, 'data-section-id': ctx.mode === 'preview' ? s.id : null });
  if (out.bgLayer) section.append(out.bgLayer);
  section.append(h('div', { class: `rr-container rr-w-${width}` }, out.content));
  return section;
}

// ---------- Cabeçalho e rodapé ----------
export function renderHeader(site, ctx) {
  const hd = site.header || {};
  const logo = hd.logo || {};
  const logoH = num(logo.height, 20, 120, 46);
  const home = site.pages.find((p) => p.home) || site.pages[0];
  const brand = h('a', { class: 'rr-brand', href: pagePath(home), 'aria-label': `${site.settings?.siteName || 'Início'} — início` },
    img(logo.src, site.settings?.siteName || 'Logo', { class: 'rr-brand__img', style: { height: `${logoH}px` }, loading: 'eager' }),
    logo.showText ? h('span', { class: 'rr-brand__text' }, logo.text || site.settings?.siteName) : null);
  const current = ctx.currentPage?.id;
  const links = [
    ...site.pages.filter((p) => p.showInMenu !== false).map((p) => ({ label: p.title, href: pagePath(p), active: p.id === current })),
    ...(hd.extraLinks || []).map((l) => ({ label: l.label, href: href(l.href, site) })),
  ].filter((l) => l.label && l.href);
  const nav = h('nav', { class: 'rr-nav', id: 'rr-nav', 'aria-label': 'Navegação principal' },
    h('ul', {}, links.map((l) => h('li', {}, h('a', { ...linkAttrs(l.href), class: l.active ? 'is-active' : null, 'aria-current': l.active ? 'page' : null }, l.label)))));
  const right = h('div', { class: 'rr-header__actions' });
  const ctaU = href(hd.ctaHref, site);
  if (hd.ctaLabel && ctaU) right.append(h('a', { class: 'rr-btn rr-btn--discord rr-btn--sm hide-mobile', ...linkAttrs(ctaU) }, hd.ctaLabel));
  if (hd.showLogin !== false) {
    if (ctx.user) {
      right.append(h('a', { class: 'rr-avatar-link', href: '/perfil', title: 'O meu perfil' },
        ctx.user.picture ? h('img', { src: safeUrl(ctx.user.picture), alt: '', class: 'rr-avatar rr-avatar--sm', referrerpolicy: 'no-referrer' }) : h('span', { class: 'rr-avatar rr-avatar--sm rr-avatar--letter' }, (ctx.user.name || '?')[0]),
        h('span', { class: 'hide-mobile' }, ctx.user.name.split(' ')[0])));
    } else {
      right.append(h('a', { class: 'rr-btn rr-btn--primary rr-btn--sm', href: '/login' }, 'Entrar'));
    }
  }
  const toggle = h('button', { class: 'rr-burger', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', 'aria-controls': 'rr-nav', type: 'button' }, h('span'), h('span'), h('span'));
  toggle.addEventListener('click', () => {
    const open = header.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  const header = h('header', {
    class: `rr-header ${hd.sticky === false ? '' : 'is-sticky'} rr-header--logo-${pick(logo.align, ['left', 'center'], 'left')}`,
    style: color(hd.bgColor) ? { '--header-bg': hd.bgColor } : {},
    'data-zone': ctx.mode === 'preview' ? 'header' : null,
  }, h('div', { class: 'rr-header__inner' }, brand, nav, right, toggle));
  return header;
}

const SOCIAL = { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', x: 'X', twitch: 'Twitch' };

export function renderFooter(site, ctx) {
  const ft = site.footer || {};
  const logo = ft.logo || {};
  const social = site.settings?.social || {};
  const discord = href(site.settings?.discordUrl, site);
  const socialLinks = [
    ...(discord ? [['Discord', discord]] : []),
    ...Object.entries(SOCIAL).map(([k, label]) => [label, href(social[k], site)]).filter(([, u]) => u),
  ];
  return h('footer', { class: `rr-footer rr-footer--${pick(logo.align, ['left', 'center'], 'left')}`, style: color(ft.bgColor) ? { '--footer-bg': ft.bgColor } : {}, 'data-zone': ctx.mode === 'preview' ? 'footer' : null },
    h('div', { class: 'rr-footer__stripe', 'aria-hidden': 'true' }),
    h('div', { class: 'rr-container rr-footer__inner' },
      h('div', { class: 'rr-footer__brand' },
        img(logo.src, site.settings?.siteName || 'Logo', { style: { height: `${num(logo.height, 20, 120, 40)}px` }, class: 'rr-footer__logo' }),
        ft.text ? h('p', { class: 'rr-muted' }, tokens(ft.text, site)) : null),
      h('nav', { class: 'rr-footer__links', 'aria-label': 'Rodapé' }, (ft.links || []).map((l) => { const u = href(l.href, site); return u && l.label ? h('a', linkAttrs(u), l.label) : null; })),
      ft.showSocial !== false && socialLinks.length ? h('div', { class: 'rr-footer__social' }, socialLinks.map(([label, u]) => h('a', { ...linkAttrs(u), class: 'rr-chip' }, label))) : null),
    h('div', { class: 'rr-container rr-footer__legal' },
      ft.disclaimer ? h('p', { class: 'rr-disclaimer' }, tokens(ft.disclaimer, site)) : null,
      ft.copyright ? h('p', { class: 'rr-muted rr-small' }, tokens(ft.copyright, site)) : null));
}

export function renderPage(site, page, ctx) {
  const main = h('main', { id: 'conteudo', class: 'rr-main' });
  if (!page) {
    main.append(h('section', { class: 'rr-sec rr-sec--notfound' }, h('div', { class: 'rr-container rr-align-center' },
      h('h1', { class: 'rr-hero__title' }, '404'), h('p', { class: 'rr-lead' }, 'Esta página não existe ou foi removida.'),
      h('div', { class: 'rr-actions', style: { 'justify-content': 'center' } }, h('a', { class: 'rr-btn rr-btn--primary', href: '/' }, 'Voltar ao início')))));
    return main;
  }
  for (const s of page.sections || []) {
    const el = renderSection(s, site, ctx);
    if (el) main.append(el);
  }
  if (!page.sections?.length && ctx.mode === 'preview') {
    main.append(h('section', { class: 'rr-sec rr-empty-page', 'data-empty': 'true' }, h('div', { class: 'rr-container rr-align-center' }, h('p', { class: 'rr-lead' }, 'Página vazia — arrasta uma secção para aqui ou usa "+ Adicionar secção".'))));
  }
  return main;
}

// ---------- Leitor de vídeo com consentimento (carrega o embed só ao clicar) ----------
const EMBED_OK = /^https:\/\/(www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}|www\.tiktok\.com\/player\/v1\/\d{8,25})$/;

export function clipPlayer(v) {
  const vertical = v.platform === 'tiktok' || v.kind === 'shorts';
  const box = h('div', { class: `rr-player ${vertical ? 'is-vertical' : ''} rr-player--${v.platform === 'tiktok' ? 'tiktok' : 'youtube'}` });
  if (!EMBED_OK.test(v.embedUrl || '')) { box.append(h('div', { class: 'rr-placeholder' }, 'Vídeo indisponível')); return box; }
  const thumb = safeUrl(v.thumbnail);
  const name = v.platform === 'tiktok' ? 'TikTok' : 'YouTube';
  const btn = h('button', { class: 'rr-player__poster', type: 'button', 'aria-label': `Reproduzir vídeo do ${name}` },
    thumb ? h('img', { src: thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    h('span', { class: 'rr-player__play', 'aria-hidden': 'true' }, '▶'),
    h('span', { class: 'rr-player__badge' }, name),
    h('span', { class: 'rr-player__consent' }, `Ao reproduzir, o ${name} pode recolher dados.`));
  btn.addEventListener('click', () => {
    const src = v.platform === 'youtube' ? `${v.embedUrl}?autoplay=1&rel=0` : `${v.embedUrl}?autoplay=1`;
    box.replaceChildren(h('iframe', { src, title: `Vídeo do ${name}`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' }));
  });
  box.append(btn);
  return box;
}

function discordSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '40');
  svg.setAttribute('height', '40');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', 'M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z');
  svg.append(path);
  return svg;
}

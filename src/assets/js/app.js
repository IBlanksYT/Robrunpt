// Arranque das páginas públicas.
import { h } from './dom.js';
import { api } from './api.js';
import { applyTheme, findPage, renderHeader, renderFooter, renderPage } from './render.js';
import { widgets, observeReveal } from './widgets.js';
import { safeUrl } from './sanitize-client.js';

async function loadSite() {
  try { return (await api('/site')).site; }
  catch {
    // Sem API (ex.: ficheiros abertos sem funções): usa o conteúdo por omissão incluído no build.
    const r = await fetch('/assets/site.default.json');
    return r.json();
  }
}

function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) { m = document.createElement('meta'); m.name = name; document.head.append(m); }
  m.content = content;
}

function referrerKind() {
  const r = document.referrer;
  if (!r) return 'direct';
  try {
    const host = new URL(r).hostname;
    if (host === location.hostname) return 'direct';
    if (/google|bing|duckduckgo|yahoo|ecosia/.test(host)) return 'search';
    if (/tiktok|youtube|instagram|discord|facebook|twitter|x\.com|reddit|twitch/.test(host)) return 'social';
  } catch { /* ignora */ }
  return 'other';
}

async function boot() {
  const app = document.getElementById('app');
  const [me, site] = await Promise.all([api('/auth/me').catch(() => ({ user: null })), loadSite()]);
  const page = findPage(site, location.pathname);
  const ctx = { mode: 'live', user: me.user, googleClientId: me.googleClientId || '', widgets, currentPage: page };
  applyTheme(site);
  const name = site.settings?.siteName || 'ROB RUN Portugal';
  document.title = page ? (page.home ? `${name} — ${site.settings?.tagline || ''}`.replace(/ — $/, '') : `${page.title} · ${name}`) : `Página não encontrada · ${name}`;
  setMeta('description', page?.seo?.description || site.settings?.description || '');
  const fav = safeUrl(site.settings?.favicon);
  if (fav) document.querySelector('link[rel="icon"]')?.setAttribute('href', fav);
  app.replaceChildren(
    h('a', { class: 'rr-skip', href: '#conteudo' }, 'Saltar para o conteúdo'),
    renderHeader(site, ctx),
    renderPage(site, page, ctx),
    renderFooter(site, ctx),
  );
  document.body.classList.add('is-ready');
  observeReveal(document);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  api('/stats/view', { method: 'POST', body: { path: page ? (page.home ? '/' : `/${page.slug}`) : '/404', source: referrerKind() } }).catch(() => {});
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').replaceChildren(h('div', { class: 'rr-container rr-boot-error' }, h('h1', {}, 'Não foi possível carregar o site'), h('p', {}, 'Tenta recarregar a página dentro de momentos.')));
});

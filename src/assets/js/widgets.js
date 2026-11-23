// Componentes dinâmicos: listas (clips/notícias/guias/clãs), publicação de clips, login Google e perfil.
import { h, fmtDate, timeAgo, toast } from './dom.js';
import { api } from './api.js';
import { sanitizeHtml, safeUrl } from './sanitize-client.js';
import { clipPlayer, href } from './render.js';
import { parseVideoUrl } from './video.js';

const LABELS = {
  news: { empty: 'Ainda não há notícias publicadas.', read: 'Ler notícia' },
  guides: { empty: 'Ainda não há guias publicados. Queres escrever o primeiro?', read: 'Ler guia' },
  clans: { empty: 'Ainda não há clãs na lista.', read: 'Ver clã' },
  clips: { empty: 'Ainda não há clips. Sê o primeiro a publicar!' },
};
const DIFF = { iniciante: 'Iniciante', intermedio: 'Intermédio', avancado: 'Avançado' };

function loading() { return h('div', { class: 'rr-loading', role: 'status' }, h('span', { class: 'rr-spinner' }), 'A carregar…'); }
function errorBox(msg, retry) {
  return h('div', { class: 'rr-notice rr-notice--warning' }, h('p', {}, msg), retry ? h('button', { class: 'rr-btn rr-btn--ghost rr-btn--sm', type: 'button', onclick: retry }, 'Tentar novamente') : null);
}
function avatar(user, size = 'sm') {
  const pic = safeUrl(user?.picture);
  return pic ? h('img', { class: `rr-avatar rr-avatar--${size}`, src: pic, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
    : h('span', { class: `rr-avatar rr-avatar--${size} rr-avatar--letter`, 'aria-hidden': 'true' }, (user?.name || '?')[0]);
}

// ---------- Clips ----------
export function clipCard(clip, ctx, { onDelete } = {}) {
  const canDelete = ctx.user && (ctx.user.id === clip.userId || ['moderator', 'admin'].includes(ctx.user.role));
  const author = clip.author || { name: 'Jogador' };
  const card = h('article', { class: 'rr-card rr-clip reveal' },
    clipPlayer(clip),
    h('div', { class: 'rr-clip__body' },
      h('div', { class: 'rr-clip__meta' },
        h('span', { class: `rr-tag rr-tag--${clip.platform}` }, clip.platform === 'tiktok' ? 'TikTok' : clip.kind === 'shorts' ? 'YouTube Shorts' : 'YouTube'),
        h('time', { datetime: new Date(clip.createdAt).toISOString(), title: fmtDate(clip.createdAt) }, timeAgo(clip.createdAt))),
      h('h3', { class: 'rr-h3 rr-clip__title' }, clip.title),
      clip.description ? h('p', { class: 'rr-muted rr-clip__desc' }, clip.description) : null,
      h('div', { class: 'rr-clip__foot' },
        h('a', { class: 'rr-author', href: `/perfil?u=${encodeURIComponent(author.id || clip.userId)}` }, avatar(author), h('span', {}, author.name)),
        h('div', { class: 'rr-clip__actions' },
          h('a', { href: safeUrl(clip.url), target: '_blank', rel: 'noopener noreferrer nofollow', class: 'rr-link-small' }, 'Original ↗'),
          canDelete ? h('button', { class: 'rr-link-small rr-danger', type: 'button', onclick: async () => {
            if (!confirm('Eliminar este clip? Esta ação não pode ser anulada.')) return;
            try { await api(`/clips/${clip.id}`, { method: 'DELETE' }); card.remove(); toast('Clip eliminado.'); onDelete?.(); }
            catch (e) { toast(e.message, 'error'); }
          } }, 'Eliminar') : null))));
  return card;
}

async function clipsFeed(mount, s, site, ctx, { userId = null } = {}) {
  const p = s.props;
  const limit = Math.min(60, Math.max(1, Number(p.limit) || 12));
  const layout = p.layout === 'list' ? 'list' : 'grid';
  let cursor = 0;
  const grid = h('div', { class: `rr-clips rr-clips--${layout}` });
  const more = h('button', { class: 'rr-btn rr-btn--ghost', type: 'button' }, 'Carregar mais');
  const moreWrap = h('div', { class: 'rr-actions rr-actions--center' });
  mount.replaceChildren(loading());
  async function load(reset = false) {
    if (reset) { cursor = 0; grid.replaceChildren(); }
    more.disabled = true;
    try {
      const q = new URLSearchParams({ limit: String(limit), cursor: String(cursor) });
      if (userId) q.set('user', userId);
      const data = await api(`/clips?${q}`);
      if (!grid.isConnected) mount.replaceChildren(grid, moreWrap);
      for (const c of data.items) grid.append(clipCard(c, ctx));
      if (!grid.children.length) grid.append(h('p', { class: 'rr-empty' }, userId ? 'Este jogador ainda não publicou clips.' : LABELS.clips.empty));
      cursor = data.nextCursor;
      moreWrap.replaceChildren();
      if (p.paginate && cursor !== null) moreWrap.append(more);
      else if (!p.paginate && p.moreLabel && href(p.moreHref, site)) moreWrap.append(h('a', { class: 'rr-btn rr-btn--ghost', href: href(p.moreHref, site) }, p.moreLabel));
      observeReveal(grid);
    } catch (e) {
      mount.replaceChildren(errorBox(e.message, () => load(true)));
    } finally { more.disabled = false; }
  }
  more.addEventListener('click', () => load());
  document.addEventListener('rr:clip-added', () => load(true));
  await load(true);
}

// ---------- Notícias / guias / clãs ----------
function contentCard(type, item, layout, onOpen) {
  const cover = safeUrl(item.cover);
  if (type === 'clans') {
    const contact = safeUrl(item.contactUrl);
    return h('article', { class: 'rr-card rr-clan reveal' },
      h('div', { class: 'rr-clan__head' },
        cover ? h('img', { src: cover, alt: '', class: 'rr-clan__logo', loading: 'lazy' }) : h('div', { class: 'rr-clan__logo rr-clan__logo--letter', 'aria-hidden': 'true' }, (item.tag || item.title)[0]),
        h('div', {}, h('h3', { class: 'rr-h3' }, item.title, item.tag ? h('span', { class: 'rr-clan__tag' }, ` [${item.tag}]`) : null),
          h('span', { class: `rr-badge ${item.recruiting ? 'rr-badge--on' : 'rr-badge--off'}` }, item.recruiting ? '● A recrutar' : 'Recrutamento fechado'))),
      item.summary ? h('p', { class: 'rr-muted' }, item.summary) : null,
      item.requirements ? h('p', { class: 'rr-small' }, h('strong', {}, 'Requisitos: '), item.requirements) : null,
      item.members ? h('p', { class: 'rr-small rr-muted' }, `Membros: ${item.members}`) : null,
      h('div', { class: 'rr-actions' },
        contact ? h('a', { class: 'rr-btn rr-btn--primary rr-btn--sm', href: contact, target: '_blank', rel: 'noopener noreferrer nofollow' }, item.recruiting ? 'Candidatar-me' : 'Contactar') : null,
        h('button', { class: 'rr-btn rr-btn--ghost rr-btn--sm', type: 'button', onclick: () => onOpen(item) }, 'Detalhes')));
  }
  return h('article', { class: `rr-card rr-post rr-post--${layout} reveal` },
    cover ? h('button', { class: 'rr-post__cover', type: 'button', onclick: () => onOpen(item), 'aria-label': item.title }, h('img', { src: cover, alt: '', loading: 'lazy' })) : null,
    h('div', { class: 'rr-post__body' },
      h('div', { class: 'rr-post__meta' },
        item.pinned ? h('span', { class: 'rr-tag rr-tag--pin' }, '📌 Destaque') : null,
        type === 'guides' && item.difficulty ? h('span', { class: 'rr-tag' }, DIFF[item.difficulty]) : null,
        type === 'guides' && item.category ? h('span', { class: 'rr-tag' }, item.category) : null,
        h('time', {}, fmtDate(item.publishedAt || item.createdAt))),
      h('h3', { class: 'rr-h3' }, h('button', { class: 'rr-linklike', type: 'button', onclick: () => onOpen(item) }, item.title)),
      item.summary ? h('p', { class: 'rr-muted' }, item.summary) : null,
      (item.tags || []).length ? h('div', { class: 'rr-tags' }, item.tags.map((t) => h('span', { class: 'rr-chip rr-chip--sm' }, `#${t}`))) : null,
      h('button', { class: 'rr-link-arrow', type: 'button', onclick: () => onOpen(item) }, LABELS[type].read)));
}

async function contentDetail(mount, type, id, back) {
  mount.replaceChildren(loading());
  try {
    const { item } = await api(`/content/${type}/${encodeURIComponent(id)}`);
    const cover = safeUrl(item.cover);
    const body = h('div', { class: 'rr-prose' });
    body.append(sanitizeHtml(item.body || ''));
    document.title = `${item.title} · ${document.title.split(' · ').pop()}`;
    mount.replaceChildren(h('article', { class: 'rr-article' },
      h('button', { class: 'rr-link-arrow rr-link-arrow--back', type: 'button', onclick: back }, 'Voltar'),
      h('h1', { class: 'rr-article__title' }, item.title),
      h('p', { class: 'rr-muted rr-small' }, [fmtDate(item.publishedAt || item.createdAt), item.author ? ` · ${item.author}` : ''].join('')),
      cover ? h('img', { class: 'rr-article__cover', src: cover, alt: '' }) : null,
      item.summary ? h('p', { class: 'rr-lead' }, item.summary) : null,
      body));
    mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    mount.replaceChildren(errorBox(e.status === 404 ? 'Este conteúdo não existe ou foi removido.' : e.message), h('button', { class: 'rr-btn rr-btn--ghost', type: 'button', onclick: back }, 'Voltar'));
  }
}

async function contentFeed(mount, s, site, ctx) {
  const p = s.props;
  const type = p.source;
  const limit = Math.min(60, Math.max(1, Number(p.limit) || 6));
  const layout = p.layout === 'list' ? 'list' : 'grid';
  const sectionEl = mount.closest('section');
  const head = sectionEl?.querySelector('.rr-sec-head');
  const param = 'artigo';
  const open = (item) => {
    if (ctx.mode === 'preview') return;
    const url = new URL(location.href);
    url.searchParams.set(param, `${type}:${item.id}`);
    history.pushState({}, '', url);
    route();
  };
  const back = () => {
    const url = new URL(location.href);
    url.searchParams.delete(param);
    history.pushState({}, '', url);
    route();
  };
  async function list() {
    if (head) head.hidden = false;
    mount.replaceChildren(loading());
    try {
      const { items } = await api(`/content/${type}`);
      const shown = items.slice(0, limit);
      const wrap = h('div', { class: layout === 'grid' ? `rr-grid rr-cols-${type === 'clans' ? 2 : 3}` : 'rr-list' });
      for (const it of shown) wrap.append(contentCard(type, it, layout, open));
      const moreU = href(p.moreHref, site);
      mount.replaceChildren(shown.length ? wrap : h('p', { class: 'rr-empty' }, LABELS[type].empty),
        p.moreLabel && moreU && shown.length ? h('div', { class: 'rr-actions rr-actions--center' }, h('a', { class: 'rr-btn rr-btn--ghost', href: moreU }, p.moreLabel)) : null);
      observeReveal(mount);
    } catch (e) { mount.replaceChildren(errorBox(e.message, list)); }
  }
  function route() {
    const v = new URL(location.href).searchParams.get(param) || '';
    const [t, id] = v.split(':');
    if (t === type && id) { if (head) head.hidden = true; contentDetail(mount, type, id, back); }
    else list();
  }
  window.addEventListener('popstate', route);
  route();
}

export const widgets = {
  feed(mount, s, site, ctx) {
    if (!['clips', 'news', 'guides', 'clans'].includes(s.props.source)) return;
    if (s.props.source === 'clips') return clipsFeed(mount, s, site, ctx);
    return contentFeed(mount, s, site, ctx);
  },

  clipSubmit(mount, s, site, ctx) {
    const p = s.props;
    const head = h('div', { class: 'rr-sec-head' }, p.heading ? h('h2', { class: 'rr-h2' }, p.heading) : null, p.text ? h('p', { class: 'rr-lead' }, p.text) : null);
    if (ctx.mode === 'preview') {
      mount.replaceChildren(h('div', { class: 'rr-card rr-form-card' }, head, h('div', { class: 'rr-placeholder' }, 'Formulário de publicação de clips (ativo no site publicado para jogadores com sessão iniciada)')));
      return;
    }
    if (!ctx.user) {
      mount.replaceChildren(h('div', { class: 'rr-card rr-form-card rr-align-center' }, head,
        h('a', { class: 'rr-btn rr-btn--primary', href: `/login?next=${encodeURIComponent(location.pathname)}` }, 'Entrar com Google para publicar')));
      return;
    }
    const url = h('input', { type: 'url', name: 'url', required: true, maxlength: 600, placeholder: 'https://www.youtube.com/shorts/… ou https://www.tiktok.com/@…/video/…', autocomplete: 'off', id: `u-${s.id}` });
    const title = h('input', { type: 'text', name: 'title', required: true, minlength: 3, maxlength: 100, placeholder: 'Ex.: Fuga épica no último segundo', id: `t-${s.id}` });
    const desc = h('textarea', { name: 'description', maxlength: 500, rows: 3, placeholder: 'Opcional', id: `d-${s.id}` });
    const trap = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'rr-hp', 'aria-hidden': 'true' });
    const hint = h('p', { class: 'rr-field-hint', 'aria-live': 'polite' }, 'Aceitamos apenas YouTube (vídeos e Shorts) e TikTok.');
    const submit = h('button', { class: 'rr-btn rr-btn--primary', type: 'submit' }, 'Publicar clip');
    const count = h('span', { class: 'rr-small rr-muted' }, '0/500');
    url.addEventListener('input', () => {
      const v = parseVideoUrl(url.value);
      hint.className = `rr-field-hint ${url.value ? (v.ok ? 'is-ok' : 'is-bad') : ''}`;
      hint.textContent = !url.value ? 'Aceitamos apenas YouTube (vídeos e Shorts) e TikTok.'
        : v.ok ? (v.needsResolve ? '✓ Link curto do TikTok — será verificado ao publicar.' : `✓ ${v.platform === 'tiktok' ? 'Vídeo do TikTok' : v.kind === 'shorts' ? 'YouTube Short' : 'Vídeo do YouTube'} detetado`) : `✗ ${v.error}`;
    });
    desc.addEventListener('input', () => { count.textContent = `${desc.value.length}/500`; });
    const form = h('form', { class: 'rr-form', novalidate: true },
      h('label', { for: url.id }, 'Link do vídeo'), url, hint,
      h('label', { for: title.id }, 'Título'), title,
      h('label', { for: desc.id }, 'Descrição ', count), desc, trap,
      h('p', { class: 'rr-small rr-muted' }, 'Ao publicar confirmas que o vídeo é de ROB RUN, que tens direito a partilhá-lo e que respeita as regras da comunidade.'),
      h('div', { class: 'rr-actions' }, submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = parseVideoUrl(url.value);
      if (!v.ok) { toast(v.error, 'error'); url.focus(); return; }
      if (title.value.trim().length < 3) { toast('O título tem de ter pelo menos 3 caracteres.', 'error'); title.focus(); return; }
      submit.disabled = true;
      submit.textContent = 'A publicar…';
      try {
        await api('/clips', { method: 'POST', body: { url: url.value, title: title.value, description: desc.value, website: trap.value } });
        form.reset();
        hint.textContent = 'Aceitamos apenas YouTube (vídeos e Shorts) e TikTok.';
        hint.className = 'rr-field-hint';
        toast('Clip publicado! 🎉');
        document.dispatchEvent(new CustomEvent('rr:clip-added'));
      } catch (err) { toast(err.message, 'error', 6000); }
      finally { submit.disabled = false; submit.textContent = 'Publicar clip'; }
    });
    mount.replaceChildren(h('div', { class: 'rr-card rr-form-card' }, head, form));
  },

  auth(mount, s, site, ctx) {
    const p = s.props;
    const head = [h('div', { class: 'rr-auth__logo' }, h('img', { src: safeUrl(site.header?.logo?.src) || '/assets/img/logo.webp', alt: '' })),
      p.heading ? h('h1', { class: 'rr-h2' }, p.heading) : null, p.text ? h('p', { class: 'rr-muted' }, p.text) : null];
    const card = h('div', { class: 'rr-card rr-auth' }, head);
    mount.replaceChildren(card);
    if (ctx.mode === 'preview') { card.append(h('div', { class: 'rr-placeholder' }, 'Botão "Iniciar sessão com Google" (ativo no site publicado)')); return; }
    if (ctx.user) {
      card.append(h('p', {}, `Tens sessão iniciada como ${ctx.user.name}.`), h('div', { class: 'rr-actions rr-actions--center' },
        h('a', { class: 'rr-btn rr-btn--primary', href: '/perfil' }, 'Ver o meu perfil'),
        h('button', { class: 'rr-btn rr-btn--ghost', type: 'button', onclick: logout }, 'Terminar sessão')));
      return;
    }
    if (!ctx.googleClientId) {
      card.append(h('div', { class: 'rr-notice rr-notice--warning' }, h('p', {}, 'O login com Google ainda não foi configurado pelo administrador do site.')));
      return;
    }
    const btnBox = h('div', { class: 'rr-gsi' }, loading());
    const msg = h('p', { class: 'rr-small rr-muted', 'aria-live': 'polite' });
    card.append(btnBox, msg, h('p', { class: 'rr-small rr-muted' }, 'Ao entrar aceitas os ', h('a', { href: '/termos' }, 'Termos'), ' e a ', h('a', { href: '/privacidade' }, 'Política de Privacidade'), '. Guardamos apenas o teu nome, fotografia e email Google.'));
    loadGsi().then((google) => {
      google.accounts.id.initialize({
        client_id: ctx.googleClientId,
        ux_mode: 'popup',
        use_fedcm_for_button: true,
        callback: async (resp) => {
          msg.textContent = 'A validar a tua conta…';
          try {
            await api('/auth/google', { method: 'POST', body: { credential: resp.credential } });
            const next = new URLSearchParams(location.search).get('next') || '/perfil';
            location.href = /^\/(?!\/)[\w\-/]*$/.test(next) ? next : '/perfil';
          } catch (e) { msg.textContent = e.message; toast(e.message, 'error'); }
        },
      });
      btnBox.replaceChildren();
      google.accounts.id.renderButton(btnBox, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'pt-PT', width: 280 });
    }).catch(() => { btnBox.replaceChildren(errorBox('Não foi possível carregar o login Google. Desativa bloqueadores para este site e tenta novamente.')); });
  },

  async profile(mount, s, site, ctx) {
    const p = s.props;
    if (ctx.mode === 'preview') { mount.replaceChildren(h('div', { class: 'rr-placeholder' }, 'Perfil do jogador: nome, fotografia e clips (ativo no site publicado)')); return; }
    const other = new URLSearchParams(location.search).get('u');
    const isSelf = !other || other === ctx.user?.id;
    if (isSelf && !ctx.user) {
      mount.replaceChildren(h('div', { class: 'rr-card rr-auth' }, h('h1', { class: 'rr-h2' }, p.heading || 'Perfil'), h('p', { class: 'rr-muted' }, 'Inicia sessão para veres o teu perfil.'), h('a', { class: 'rr-btn rr-btn--primary', href: '/login?next=/perfil' }, 'Entrar com Google')));
      return;
    }
    let user = ctx.user;
    if (!isSelf) {
      mount.replaceChildren(loading());
      try { user = (await api(`/users/${encodeURIComponent(other)}`)).user; }
      catch (e) { mount.replaceChildren(errorBox(e.status === 404 ? 'Este perfil não existe.' : e.message)); return; }
    }
    const roleLabel = { admin: 'Administrador', moderator: 'Moderador' }[user.role];
    const header = h('div', { class: 'rr-profile' },
      avatar(user, 'xl'),
      h('div', {},
        h('h1', { class: 'rr-h2' }, user.name, roleLabel && isSelf ? h('span', { class: 'rr-badge rr-badge--on' }, ` ${roleLabel}`) : null),
        user.createdAt ? h('p', { class: 'rr-muted' }, `Membro desde ${fmtDate(user.createdAt)}`) : null,
        isSelf && user.email ? h('p', { class: 'rr-small rr-muted' }, user.email) : null,
        isSelf && !user.virtual ? h('div', { class: 'rr-actions' },
          h('a', { class: 'rr-btn rr-btn--primary rr-btn--sm', href: '/clips' }, '+ Publicar clip'),
          h('button', { class: 'rr-btn rr-btn--ghost rr-btn--sm', type: 'button', onclick: logout }, 'Terminar sessão')) : null,
        isSelf && user.virtual ? h('div', { class: 'rr-actions' }, h('a', { class: 'rr-btn rr-btn--primary rr-btn--sm', href: '/admin' }, 'Abrir painel'), h('button', { class: 'rr-btn rr-btn--ghost rr-btn--sm', type: 'button', onclick: logout }, 'Terminar sessão')) : null));
    const clipsMount = h('div');
    const parts = [header, h('h2', { class: 'rr-h2 rr-mt' }, isSelf ? 'Os meus clips' : 'Clips publicados'), clipsMount];
    if (isSelf && !user.virtual) {
      parts.push(h('details', { class: 'rr-card rr-privacy-box' },
        h('summary', {}, 'Os meus dados e privacidade'),
        h('p', { class: 'rr-muted rr-small' }, 'Podes descarregar todos os dados que temos sobre ti ou eliminar a tua conta. Ao eliminar a conta, todos os teus clips são apagados.'),
        h('div', { class: 'rr-actions' },
          h('a', { class: 'rr-btn rr-btn--ghost rr-btn--sm', href: '/api/me/export' }, 'Exportar os meus dados'),
          h('button', { class: 'rr-btn rr-btn--secondary rr-btn--sm', type: 'button', onclick: async () => {
            if (!confirm('Tens a certeza? A tua conta e todos os teus clips serão eliminados de forma permanente.')) return;
            try { await api('/me', { method: 'DELETE' }); toast('Conta eliminada.'); location.href = '/'; }
            catch (e) { toast(e.message, 'error'); }
          } }, 'Eliminar conta'))));
    }
    mount.replaceChildren(...parts);
    if (!user.virtual) clipsFeed(clipsMount, { props: { limit: 12, paginate: true, layout: 'grid' } }, site, ctx, { userId: user.id });
    else clipsMount.append(h('p', { class: 'rr-empty' }, 'A conta de administrador por palavra-passe não publica clips.'));
  },
};

export async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignora */ }
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignora */ }
  location.href = '/';
}

let gsiPromise;
export function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  gsiPromise ||= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://accounts.google.com/gsi/client';
    sc.async = true;
    sc.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('GSI')));
    sc.onerror = () => { gsiPromise = null; reject(new Error('GSI')); };
    document.head.append(sc);
  });
  return gsiPromise;
}

let io;
export function observeReveal(root = document) {
  const els = root.querySelectorAll('.reveal:not(.is-in)');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach((e) => e.classList.add('is-in')); return; }
  io ||= new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -40px 0px' });
  els.forEach((e) => io.observe(e));
}

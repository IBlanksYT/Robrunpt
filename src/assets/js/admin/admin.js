// Painel de administração: autenticação, navegação por separadores e permissões.
import { h } from '../dom.js';
import { api } from '../api.js';
import { loadGsi } from '../widgets.js';
import { editorView, isDirty } from './editor.js';
import { contentView } from './content.js';
import { clipsView, usersView, auditView } from './moderation.js';
import { statsView, backupsView, healthBanner } from './system.js';
import { mediaView } from './media.js';
import { confirmDialog, errorMsg } from './ui.js';

const TABS = [
  { id: 'editor', label: 'Editor do site', icon: '🎨', role: 'admin', view: (r) => editorView(r) },
  { id: 'noticias', label: 'Notícias', icon: '📰', role: 'moderator', view: (r) => contentView(r, 'news') },
  { id: 'guias', label: 'Guias', icon: '📘', role: 'moderator', view: (r) => contentView(r, 'guides') },
  { id: 'clas', label: 'Clãs', icon: '🛡️', role: 'moderator', view: (r) => contentView(r, 'clans') },
  { id: 'clips', label: 'Clips', icon: '🎬', role: 'moderator', view: (r, me) => clipsView(r, { me, onOpenUser: (id) => { location.hash = `#utilizadores?q=${encodeURIComponent(id)}`; } }) },
  { id: 'utilizadores', label: 'Utilizadores', icon: '👥', role: 'moderator', view: (r, me) => usersView(r, { me }) },
  { id: 'estatisticas', label: 'Estatísticas', icon: '📊', role: 'moderator', view: (r) => statsView(r) },
  { id: 'media', label: 'Media', icon: '🖼️', role: 'moderator', view: (r, me) => mediaView(r, { canDelete: me.role === 'admin' }) },
  { id: 'backups', label: 'Backups', icon: '💾', role: 'admin', view: (r) => backupsView(r) },
  { id: 'atividade', label: 'Atividade', icon: '🧾', role: 'moderator', view: (r) => auditView(r) },
];
const RANK = { player: 1, moderator: 2, admin: 3 };

const loginEl = document.getElementById('ad-login');
const appEl = document.getElementById('ad-app');
let me = null;
let current = null;

async function start() {
  let data;
  try { data = await api('/auth/me'); }
  catch (e) { showLogin(null, `Não foi possível contactar a API: ${errorMsg(e)}`); return; }
  if (data.user && RANK[data.user.role] >= RANK.moderator) { me = data.user; showApp(); return; }
  showLogin(data, data.user ? `A conta ${data.user.name} não tem permissões de administração. Pede a um administrador para te atribuir a função de moderador ou administrador.` : '');
}

function showLogin(data, message) {
  appEl.hidden = true;
  loginEl.hidden = false;
  const msg = loginEl.querySelector('.ad-login__msg');
  msg.textContent = message || '';
  msg.hidden = !message;
  const form = loginEl.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const pw = form.password.value;
    const b = form.querySelector('button');
    b.disabled = true;
    try {
      await api('/auth/admin', { method: 'POST', body: { password: pw } });
      form.reset();
      start();
    } catch (err) { msg.textContent = errorMsg(err); msg.hidden = false; }
    finally { b.disabled = false; }
  };
  const gbox = loginEl.querySelector('.ad-login__google');
  if (data?.googleClientId) {
    gbox.hidden = false;
    loadGsi().then((google) => {
      google.accounts.id.initialize({
        client_id: data.googleClientId, ux_mode: 'popup', use_fedcm_for_button: true,
        callback: async (resp) => {
          try { await api('/auth/google', { method: 'POST', body: { credential: resp.credential } }); start(); }
          catch (err) { msg.textContent = errorMsg(err); msg.hidden = false; }
        },
      });
      const target = gbox.querySelector('.ad-login__gbtn');
      target.replaceChildren();
      google.accounts.id.renderButton(target, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'pt-PT' });
    }).catch(() => { gbox.hidden = true; });
  } else gbox.hidden = true;
  if (data?.user) {
    const out = h('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', onclick: logout }, 'Terminar sessão desta conta');
    msg.after(out);
  }
}

async function logout() {
  if (isDirty() && !(await confirmDialog('Tens alterações no editor que ainda não foram guardadas. Sair mesmo assim?', { danger: true, ok: 'Sair' }))) return;
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignora */ }
  location.reload();
}

function allowedTabs() {
  return TABS.filter((t) => RANK[me.role] >= RANK[t.role]);
}

function showApp() {
  loginEl.hidden = true;
  appEl.hidden = false;
  const nav = appEl.querySelector('.ad-nav');
  nav.replaceChildren(...allowedTabs().map((t) => h('a', { href: `#${t.id}`, 'data-tab': t.id }, h('span', { 'aria-hidden': 'true' }, t.icon), h('span', { class: 'ad-nav__label' }, t.label))));
  appEl.querySelector('.ad-me').replaceChildren(h('span', {}, me.name), h('span', { class: 'ad-pill ad-pill--green' }, me.role === 'admin' ? 'Admin' : 'Moderador'),
    h('a', { class: 'ad-btn ad-btn--ghost ad-btn--sm', href: '/', target: '_blank', rel: 'noopener' }, 'Ver site ↗'),
    h('button', { type: 'button', class: 'ad-btn ad-btn--ghost ad-btn--sm', onclick: logout }, 'Sair'));
  healthBanner().then((issues) => {
    const b = appEl.querySelector('.ad-health');
    b.hidden = !issues.length;
    b.replaceChildren(...issues.map((i) => h('div', {}, '⚠ ', i)));
  });
  window.addEventListener('hashchange', route);
  route();
}

function route() {
  const id = location.hash.slice(1).split('?')[0];
  const tabs = allowedTabs();
  const tab = tabs.find((t) => t.id === id) || tabs[0];
  appEl.querySelectorAll('.ad-nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === tab.id));
  const view = appEl.querySelector('#ad-view');
  view.dataset.tab = tab.id;
  if (current !== tab.id || tab.id !== 'editor') tab.view(view, me);
  current = tab.id;
  document.title = `${tab.label} · Painel ROB RUN PT`;
}

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

start();

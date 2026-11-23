// Ponte entre o editor (admin.html) e a pré-visualização (preview.html, dentro de um iframe).
// Recebe o rascunho por postMessage, desenha-o com o renderer público e envia de volta
// seleções, edições inline, reordenações e secções largadas a partir da paleta.
import { h } from './dom.js';
import { applyTheme, renderHeader, renderFooter, renderPage, findPage } from './render.js';
import { widgets, observeReveal } from './widgets.js';

const ORIGIN = location.origin;
const app = document.getElementById('app');
let state = { site: null, pageId: null, selected: null, user: null };
const send = (msg) => parent.postMessage(msg, ORIGIN);

function render() {
  const { site, pageId } = state;
  if (!site) return;
  const page = site.pages.find((p) => p.id === pageId) || site.pages[0];
  const ctx = { mode: 'preview', user: state.user, widgets, currentPage: page };
  const y = window.scrollY;
  applyTheme(site);
  app.replaceChildren(renderHeader(site, ctx), renderPage(site, page, ctx), renderFooter(site, ctx));
  decorate(page);
  observeReveal(document);
  document.querySelectorAll('.reveal').forEach((e) => e.classList.add('is-in'));
  window.scrollTo(0, y);
  markSelected();
}

function decorate(page) {
  const sections = [...document.querySelectorAll('[data-section-id]')];
  sections.forEach((el, idx) => {
    const id = el.dataset.sectionId;
    const sec = page.sections.find((s) => s.id === id);
    const bar = h('div', { class: 'pv-bar', contenteditable: 'false' },
      h('span', { class: 'pv-handle', draggable: 'true', title: 'Arrastar para reordenar' }, '⠿'),
      h('span', { class: 'pv-label' }, sec ? labelOf(sec) : ''),
      h('button', { type: 'button', title: 'Subir', disabled: idx === 0, onclick: (e) => { e.stopPropagation(); send({ type: 'move', id, delta: -1 }); } }, '↑'),
      h('button', { type: 'button', title: 'Descer', disabled: idx === sections.length - 1, onclick: (e) => { e.stopPropagation(); send({ type: 'move', id, delta: 1 }); } }, '↓'),
      h('button', { type: 'button', title: 'Duplicar', onclick: (e) => { e.stopPropagation(); send({ type: 'duplicate', id }); } }, '⧉'),
      h('button', { type: 'button', title: 'Eliminar', class: 'pv-del', onclick: (e) => { e.stopPropagation(); send({ type: 'delete', id }); } }, '🗑'));
    el.prepend(bar);
    el.addEventListener('click', (e) => {
      if (e.target.closest('.pv-bar')) return;
      send({ type: 'select', target: 'section', id });
    });
    const handle = bar.querySelector('.pv-handle');
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-rr-move', id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('pv-dragging');
    });
    handle.addEventListener('dragend', () => el.classList.remove('pv-dragging'));
  });
  for (const zone of document.querySelectorAll('[data-zone]')) {
    zone.addEventListener('click', (e) => { e.preventDefault(); send({ type: 'select', target: zone.dataset.zone }); });
  }
}

const LABELS = { hero: 'Destaque', text: 'Texto', split: 'Imagem + texto', features: 'Cartões', cta: 'Chamada para ação', image: 'Imagem', gallery: 'Galeria', video: 'Vídeo', rules: 'Regras', discord: 'Discord', faq: 'FAQ', notice: 'Aviso', feed: 'Lista dinâmica', clipSubmit: 'Formulário de clips', auth: 'Login', profile: 'Perfil', spacer: 'Espaço' };
function labelOf(s) { return LABELS[s.type] || s.type; }

function markSelected() {
  document.querySelectorAll('.pv-selected').forEach((e) => e.classList.remove('pv-selected'));
  const sel = state.selected;
  if (!sel) return;
  let el = null;
  if (sel.target === 'section') el = document.querySelector(`[data-section-id="${CSS.escape(sel.id)}"]`);
  else if (sel.target === 'header' || sel.target === 'footer') el = document.querySelector(`[data-zone="${sel.target}"]`);
  if (el) {
    el.classList.add('pv-selected');
    if (sel.scroll) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// --- Drag & drop: reordenar secções e largar novas secções vindas da paleta ---
const indicator = h('div', { class: 'pv-drop-indicator' });
function dropIndex(clientY) {
  const secs = [...document.querySelectorAll('main [data-section-id]')];
  for (let i = 0; i < secs.length; i++) {
    const r = secs[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { index: i, el: secs[i], before: true };
  }
  return { index: secs.length, el: secs[secs.length - 1], before: false };
}
function accepts(e) {
  const t = e.dataTransfer?.types || [];
  return t.includes('application/x-rr-move') || t.includes('application/x-rr-section');
}
document.addEventListener('dragover', (e) => {
  if (!accepts(e)) return;
  e.preventDefault();
  const { el, before } = dropIndex(e.clientY);
  const main = document.querySelector('main');
  if (!el) { main?.prepend(indicator); return; }
  if (before) el.before(indicator); else el.after(indicator);
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) indicator.remove(); });
document.addEventListener('drop', (e) => {
  if (!accepts(e)) return;
  e.preventDefault();
  indicator.remove();
  const { index } = dropIndex(e.clientY);
  const moveId = e.dataTransfer.getData('application/x-rr-move');
  const newType = e.dataTransfer.getData('application/x-rr-section');
  if (moveId) send({ type: 'reorder', id: moveId, index });
  else if (newType) send({ type: 'add', sectionType: newType, index });
});

// --- Edição de texto diretamente na pré-visualização (duplo clique) ---
document.addEventListener('dblclick', (e) => {
  const el = e.target.closest('[data-field]');
  const secEl = e.target.closest('[data-section-id]');
  if (!el || !secEl) return;
  e.preventDefault();
  const original = el.dataset.raw ?? el.textContent;
  el.textContent = original;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.classList.add('pv-editing');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  let cancelled = false;
  const finish = () => {
    el.contentEditable = 'false';
    el.classList.remove('pv-editing');
    el.removeEventListener('keydown', onKey);
    if (!cancelled && el.textContent !== original) send({ type: 'edit', id: secEl.dataset.sectionId, field: el.dataset.field, value: el.textContent });
    else if (cancelled) el.textContent = original;
  };
  const onKey = (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && el.tagName !== 'P') { ev.preventDefault(); el.blur(); }
    if (ev.key === 'Escape') { cancelled = true; el.blur(); }
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', finish, { once: true });
});

// --- Links não navegam; links internos mudam a página no editor ---
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (e.target.closest('[data-section-id]')) return;
  const url = new URL(a.href, location.href);
  if (url.origin === location.origin && state.site) {
    const page = findPage(state.site, url.pathname);
    if (page) send({ type: 'navigate', pageId: page.id });
  }
}, true);
document.addEventListener('submit', (e) => e.preventDefault(), true);

window.addEventListener('message', (e) => {
  if (e.origin !== ORIGIN || e.source !== parent) return;
  const m = e.data || {};
  if (m.type === 'render') {
    state.site = m.site;
    state.pageId = m.pageId;
    state.selected = m.selected || null;
    state.user = m.user || null;
    render();
  } else if (m.type === 'select') {
    state.selected = m.selected;
    markSelected();
  }
});

send({ type: 'ready' });

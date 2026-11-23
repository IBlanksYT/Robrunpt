// Biblioteca de imagens: seletor (usado pelos campos de imagem) e separador "Media".
import { h, fmtDate, toast } from '../dom.js';
import { api } from '../api.js';
import { modal, btn, confirmDialog, spinner, emptyState, errorMsg } from './ui.js';

const BUILTIN = [
  { url: '/assets/img/logo.webp', name: 'Logo (horizontal)' },
  { url: '/assets/img/logo-square.webp', name: 'Logo (quadrado)' },
  { url: '/assets/img/hero-bg.webp', name: 'Fundo ROB RUN' },
];

export async function uploadFiles(files, onEach) {
  const done = [];
  for (const file of files) {
    try {
      if (file.size > 4.5 * 1024 * 1024) throw new Error(`${file.name}: máximo 4,5 MB.`);
      const { item } = await api('/admin/media', { method: 'POST', body: file, raw: true, headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) } });
      done.push(item);
      onEach?.(item);
    } catch (e) { toast(errorMsg(e), 'error', 6000); }
  }
  return done;
}

function fileInput(onFiles, multiple = true) {
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon', multiple: multiple ? true : null, hidden: true });
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  return input;
}

function dropZone(onFiles, label = 'Arrasta imagens para aqui ou clica para escolher') {
  const input = fileInput(onFiles);
  const zone = h('div', { class: 'ad-drop', tabindex: '0', role: 'button', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); } }, h('strong', {}, '⬆ Carregar imagens'), h('span', {}, label), h('small', {}, 'PNG, JPG, WEBP, GIF, AVIF ou ICO · máx. 4,5 MB'), input);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('is-over'); const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')); if (files.length) onFiles(files); });
  return zone;
}

/** Abre o seletor; devolve o URL escolhido ou null. */
export function openMediaPicker() {
  return new Promise((resolve) => {
    let chosen = null;
    const grid = h('div', { class: 'ad-media-grid' }, spinner());
    const pick = (url) => { chosen = url; document.querySelector('.ad-modal .ad-btn--primary')?.click(); };
    const tile = (m) => h('button', { type: 'button', class: 'ad-media-tile', title: m.name, onclick: () => pick(m.url) }, h('img', { src: m.url, alt: '', loading: 'lazy' }), h('span', {}, m.name));
    async function load() {
      try {
        const { items } = await api('/admin/media');
        grid.replaceChildren(...BUILTIN.map(tile), ...items.map(tile));
      } catch (e) { grid.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e)), ...BUILTIN.map(tile)); }
    }
    const zone = dropZone(async (files) => {
      zone.classList.add('is-busy');
      const up = await uploadFiles(files);
      zone.classList.remove('is-busy');
      if (up.length === 1 && files.length === 1) pick(up[0].url);
      else load();
    });
    load();
    modal({
      title: 'Escolher imagem', wide: true,
      body: h('div', {}, zone, grid),
      actions: [{ label: 'Cancelar', value: null }, { label: 'Usar', value: () => chosen, cls: 'ad-btn--primary ad-hidden' }],
    }).then((v) => resolve(v ?? null));
  });
}

export async function mediaView(root, { canDelete }) {
  const grid = h('div', { class: 'ad-media-grid ad-media-grid--lg' }, spinner());
  async function load() {
    try {
      const { items } = await api('/admin/media');
      if (!items.length) { grid.replaceChildren(emptyState('Ainda não carregaste imagens. As imagens carregadas ficam guardadas em Netlify Blobs e sobrevivem a novos deploys.')); return; }
      grid.replaceChildren(...items.map((m) => h('div', { class: 'ad-media-card' },
        h('a', { href: m.url, target: '_blank', rel: 'noopener' }, h('img', { src: m.url, alt: '', loading: 'lazy' })),
        h('div', { class: 'ad-media-card__info' }, h('strong', { title: m.name }, m.name), h('small', {}, `${Math.round((m.size || 0) / 1024)} KB · ${fmtDate(m.uploadedAt)}`)),
        h('div', { class: 'ad-row' },
          btn('Copiar URL', async () => { await navigator.clipboard.writeText(location.origin + m.url).catch(() => {}); toast('URL copiado.'); }, 'ad-btn--sm ad-btn--ghost'),
          canDelete ? btn('Eliminar', async () => {
            if (!(await confirmDialog(`Eliminar "${m.name}"? Se estiver a ser usada no site, deixará de aparecer.`, { danger: true, ok: 'Eliminar' }))) return;
            try { await api(`/admin/media/${m.key}`, { method: 'DELETE' }); toast('Imagem eliminada.'); load(); } catch (e) { toast(errorMsg(e), 'error'); }
          }, 'ad-btn--sm ad-btn--danger-ghost') : null))));
    } catch (e) { grid.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
  }
  const zone = dropZone(async (files) => { zone.classList.add('is-busy'); const up = await uploadFiles(files); zone.classList.remove('is-busy'); if (up.length) toast(`${up.length} imagem(ns) carregada(s).`); load(); });
  root.replaceChildren(h('div', { class: 'ad-page' }, h('div', { class: 'ad-page__head' }, h('h1', {}, 'Media'), h('p', { class: 'ad-muted' }, 'Imagens usadas no logo, fundos, capas de notícias e clãs.')), zone, grid));
  load();
}

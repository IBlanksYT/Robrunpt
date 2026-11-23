// Editor visual do site: páginas, secções (drag & drop), inspetor, pré-visualização em tempo real,
// anular/refazer, rascunhos, publicação e histórico de versões.
import { h, uid, setPath, getPath, toast, fmtDateTime } from '../dom.js';
import { api } from '../api.js';
import { SECTION_TYPES, STYLE_FIELDS, THEME_FIELDS, HEADER_FIELDS, FOOTER_FIELDS, SETTINGS_FIELDS, PAGE_FIELDS, newSection } from '../sections.js';
import { pagePath } from '../render.js';
import { renderFields } from './fields.js';
import { modal, confirmDialog, promptDialog, btn, iconBtn, errorMsg, spinner } from './ui.js';

const st = {
  loaded: false, site: null, etag: null, publishedAt: null, pageId: null,
  sel: { target: 'page' }, dirty: false, rev: 0, undo: [], redo: [], lastCo: null, lastCoAt: 0,
  device: 'desktop', saving: false, savedAt: null, viewing: null, leftTab: 'pages', inspTab: 'content',
};
let els = {};
let frame = null;
let frameReady = false;
let previewTimer = null;
let autosaveTimer = null;

const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const page = () => st.site.pages.find((p) => p.id === st.pageId) || st.site.pages[0];
const section = (id = st.sel.id) => page().sections.find((s) => s.id === id);
const cloneSection = (s) => ({ ...structuredClone(s), id: uid('s') });
const snippet = (s) => {
  const p = s.props || {};
  const t = p.title || p.heading || p.caption || p.q || (p.source ? { clips: 'Clips', news: 'Notícias', guides: 'Guias', clans: 'Clãs' }[p.source] : '') || '';
  return String(t).replace(/\{\{\w+\}\}/g, '').slice(0, 38);
};

export function isDirty() { return st.dirty; }

// ---------- Mutação, histórico e gravação ----------
function mutate(fn, { coalesce = null, structural = true } = {}) {
  if (st.viewing) return;
  const now = Date.now();
  if (!(coalesce && coalesce === st.lastCo && now - st.lastCoAt < 1500)) {
    st.undo.push(JSON.stringify(st.site));
    if (st.undo.length > 120) st.undo.shift();
    st.redo = [];
  }
  st.lastCo = coalesce;
  st.lastCoAt = now;
  fn(st.site);
  st.rev++;
  st.dirty = true;
  updateStatus();
  schedulePreview();
  renderLeft();
  if (structural) renderInspector();
}

function undo() {
  if (!st.undo.length || st.viewing) return;
  st.redo.push(JSON.stringify(st.site));
  st.site = JSON.parse(st.undo.pop());
  afterHistory();
}
function redo() {
  if (!st.redo.length || st.viewing) return;
  st.undo.push(JSON.stringify(st.site));
  st.site = JSON.parse(st.redo.pop());
  afterHistory();
}
function afterHistory() {
  st.lastCo = null;
  st.rev++;
  st.dirty = true;
  if (!st.site.pages.some((p) => p.id === st.pageId)) st.pageId = st.site.pages[0].id;
  if (st.sel.target === 'section' && !section()) st.sel = { target: 'page' };
  renderAll();
}

async function save({ force = false, quiet = false } = {}) {
  if (st.saving || st.viewing) return false;
  st.saving = true;
  const rev = st.rev;
  updateStatus('A guardar…');
  try {
    const r = await api('/admin/site', { method: 'PUT', body: { site: st.site, etag: st.etag, force } });
    st.etag = r.etag;
    st.savedAt = r.savedAt;
    if (st.rev === rev) {
      st.site = r.site;
      st.dirty = false;
      if (!st.site.pages.some((p) => p.id === st.pageId)) st.pageId = st.site.pages[0].id;
      renderLeft();
      schedulePreview();
    }
    if (!quiet) toast('Rascunho guardado.');
    return true;
  } catch (e) {
    if (e.status === 409 && e.data?.conflict) {
      const choice = await modal({
        title: 'Conflito de edição',
        body: h('div', {}, h('p', {}, 'O rascunho foi alterado noutra sessão ou por outro administrador' + (e.data.updatedBy ? ` (${e.data.updatedBy}, ${fmtDateTime(e.data.updatedAt)})` : '') + '.'),
          h('p', {}, 'Podes carregar a versão do servidor (perdes as tuas alterações locais não guardadas) ou substituir pelo que tens aqui.')),
        actions: [{ label: 'Cancelar', value: null }, { label: 'Carregar do servidor', value: 'reload' }, { label: 'Substituir pelo meu', value: 'force', cls: 'ad-btn--danger' }],
      });
      st.saving = false;
      if (choice === 'force') return save({ force: true });
      if (choice === 'reload') { await load(true); return false; }
    } else {
      toast(`Não foi possível guardar: ${errorMsg(e)}`, 'error', 7000);
    }
    return false;
  } finally {
    st.saving = false;
    updateStatus();
  }
}

async function publishFlow() {
  const note = h('input', { type: 'text', placeholder: 'Opcional — ex.: novo banner do torneio', maxlength: 200 });
  const ok = await modal({
    title: 'Publicar alterações',
    body: h('div', {}, h('p', {}, 'O rascunho atual passa a ser o site público. Fica guardada uma versão no histórico, que podes restaurar a qualquer momento.'),
      h('label', { class: 'ad-field' }, h('span', { class: 'ad-field__label' }, 'Nota da versão'), note)),
    actions: [{ label: 'Cancelar', value: false }, { label: 'Publicar agora', value: true, cls: 'ad-btn--primary' }],
  });
  if (!ok) return;
  if (st.dirty && !(await save({ quiet: true }))) return;
  try {
    const r = await api('/admin/publish', { method: 'POST', body: { note: note.value } });
    st.publishedAt = r.publishedAt;
    updateStatus();
    toast('Site publicado! 🚀');
  } catch (e) { toast(errorMsg(e), 'error', 7000); }
}

// ---------- Versões ----------
async function versionsFlow() {
  const list = h('div', { class: 'ad-versions' }, spinner());
  const load = async () => {
    try {
      const { items } = await api('/admin/versions');
      if (!items.length) { list.replaceChildren(h('p', { class: 'ad-muted' }, 'Ainda não há versões. É criada uma versão sempre que publicas ou crias um ponto de restauro.')); return; }
      list.replaceChildren(...items.map((v) => h('div', { class: 'ad-version' },
        h('div', {}, h('strong', {}, fmtDateTime(v.createdAt)), h('span', { class: `ad-pill ad-pill--${v.kind === 'publicação' ? 'green' : 'grey'}` }, v.kind),
          h('div', { class: 'ad-muted ad-small' }, `${v.by} · ${v.pages} páginas${v.note ? ` · ${v.note}` : ''}`)),
        h('div', { class: 'ad-row' },
          btn('Pré-visualizar', async () => { document.querySelector('.ad-overlay .ad-icon')?.click(); await viewVersion(v.id); }, 'ad-btn--sm ad-btn--ghost'),
          btn('Restaurar', async () => { document.querySelector('.ad-overlay .ad-icon')?.click(); await restoreVersion(v.id, false); }, 'ad-btn--sm')))));
    } catch (e) { list.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
  };
  load();
  await modal({
    title: 'Histórico de versões', wide: true,
    body: h('div', {}, h('div', { class: 'ad-row ad-row--between' }, h('p', { class: 'ad-muted' }, 'Restaurar uma versão substitui o rascunho (é guardada uma cópia do atual antes). Depois podes publicá-la.'),
      btn('+ Criar ponto de restauro', async () => {
        if (st.dirty && !(await save({ quiet: true }))) return;
        const n = await promptDialog('Ponto de restauro', { label: 'Nota', value: 'Ponto de restauro manual' });
        if (n === null) return;
        await api('/admin/versions', { method: 'POST', body: { note: n } }).catch((e) => toast(errorMsg(e), 'error'));
        load();
      }, 'ad-btn--sm')), list),
  });
}

async function viewVersion(id) {
  try {
    const { version } = await api(`/admin/versions/${id}`);
    st.viewing = version;
    renderAll();
  } catch (e) { toast(errorMsg(e), 'error'); }
}

async function restoreVersion(id, publishNow) {
  if (!(await confirmDialog(publishNow ? 'Restaurar esta versão e publicá-la imediatamente?' : 'Restaurar esta versão para o rascunho? As alterações não guardadas serão perdidas (é feita uma cópia do rascunho atual no histórico).', { ok: 'Restaurar' }))) return;
  try {
    const r = await api(`/admin/versions/${id}/restore`, { method: 'POST', body: { publish: publishNow } });
    st.undo.push(JSON.stringify(st.site));
    st.site = r.draft;
    st.etag = r.etag;
    st.dirty = false;
    st.viewing = null;
    st.pageId = st.site.pages.find((p) => p.home)?.id || st.site.pages[0].id;
    st.sel = { target: 'page' };
    renderAll();
    toast(publishNow ? 'Versão restaurada e publicada.' : 'Versão restaurada no rascunho.');
  } catch (e) { toast(errorMsg(e), 'error'); }
}

// ---------- Operações de páginas e secções ----------
function selectPage(id) {
  st.pageId = id;
  st.sel = { target: 'page' };
  renderAll();
}

function select(sel) {
  st.sel = sel;
  if (sel.target === 'section') st.inspTab = st.inspTab || 'content';
  renderLeft();
  renderInspector();
  frame?.contentWindow?.postMessage({ type: 'select', selected: { ...sel, scroll: true } }, location.origin);
}

async function addPage() {
  const title = h('input', { type: 'text', placeholder: 'Ex.: Torneio de Verão', autofocus: true, maxlength: 100 });
  const tpl = h('select', {}, h('option', { value: 'hero' }, 'Destaque + texto'), h('option', { value: 'blank' }, 'Em branco'), h('option', { value: 'news' }, 'Lista de notícias'), h('option', { value: 'clips' }, 'Galeria de clips'));
  const menu = h('input', { type: 'checkbox', checked: true, class: 'ad-switch' });
  const ok = await modal({
    title: 'Nova página',
    body: h('div', { class: 'ad-fields' }, h('label', { class: 'ad-field' }, h('span', { class: 'ad-field__label' }, 'Título'), title), h('label', { class: 'ad-field' }, h('span', { class: 'ad-field__label' }, 'Modelo'), tpl), h('label', { class: 'ad-toggle' }, menu, h('span', {}, 'Mostrar no menu'))),
    actions: [{ label: 'Cancelar', value: false }, { label: 'Criar página', value: true, cls: 'ad-btn--primary', validate: () => { if (title.value.trim().length < 2) { title.focus(); return false; } return true; } }],
  });
  if (!ok) return;
  const t = title.value.trim();
  let slug = slugify(t) || uid('pagina');
  while (st.site.pages.some((p) => p.slug === slug)) slug += '-2';
  const sections = [];
  if (tpl.value === 'hero') { const hs = newSection('hero'); hs.props.title = t; hs.props.buttons = []; hs.props.height = 'sm'; sections.push(hs, newSection('text')); }
  if (tpl.value === 'news') { const hs = newSection('hero'); hs.props.title = t; hs.props.buttons = []; hs.props.height = 'sm'; const f = newSection('feed'); f.props.source = 'news'; f.props.heading = ''; sections.push(hs, f); }
  if (tpl.value === 'clips') { const hs = newSection('hero'); hs.props.title = t; hs.props.buttons = []; hs.props.height = 'sm'; const f = newSection('feed'); f.props.source = 'clips'; f.props.heading = ''; f.props.paginate = true; f.props.limit = 12; sections.push(hs, newSection('clipSubmit'), f); }
  const p = { id: uid('p'), slug, title: t, showInMenu: menu.checked, seo: { description: '' }, sections };
  mutate((s) => s.pages.push(p));
  selectPage(p.id);
  toast(`Página criada em /${slug}`);
}

function duplicatePage(id) {
  const src = st.site.pages.find((p) => p.id === id);
  let slug = `${src.slug}-copia`;
  while (st.site.pages.some((p) => p.slug === slug)) slug += '-2';
  const copy = { ...structuredClone(src), id: uid('p'), slug, home: false, title: `${src.title} (cópia)`, sections: src.sections.map(cloneSection) };
  mutate((s) => s.pages.splice(s.pages.indexOf(s.pages.find((p) => p.id === id)) + 1, 0, copy));
  selectPage(copy.id);
}

async function deletePage(id) {
  const p = st.site.pages.find((x) => x.id === id);
  if (p.home) { toast('Não podes eliminar a página inicial. Define outra página como inicial primeiro.', 'error', 5000); return; }
  if (!(await confirmDialog(`Eliminar a página "${p.title}" e todas as suas secções? Podes anular com Ctrl+Z antes de guardar, ou restaurar uma versão anterior.`, { danger: true, ok: 'Eliminar página' }))) return;
  mutate((s) => { s.pages = s.pages.filter((x) => x.id !== id); });
  if (st.pageId === id) selectPage((st.site.pages.find((x) => x.home) || st.site.pages[0]).id);
}

function setHome(id) {
  mutate((s) => s.pages.forEach((p) => {
    if (p.id === id) { p.home = true; } else if (p.home) { p.home = false; if (p.slug === 'inicio') p.slug = 'inicio-antigo'; }
  }));
  toast('Página inicial alterada.');
}

function addSection(type, index = null) {
  if (!SECTION_TYPES[type]) return;
  const s = newSection(type);
  mutate((site) => {
    const secs = site.pages.find((p) => p.id === st.pageId).sections;
    let i = index;
    if (i === null) {
      const selIdx = st.sel.target === 'section' ? secs.findIndex((x) => x.id === st.sel.id) : -1;
      i = selIdx >= 0 ? selIdx + 1 : secs.length;
    }
    secs.splice(Math.max(0, Math.min(i, secs.length)), 0, s);
  });
  st.inspTab = 'content';
  select({ target: 'section', id: s.id });
}

function moveSection(id, delta) {
  mutate((site) => {
    const secs = site.pages.find((p) => p.id === st.pageId).sections;
    const i = secs.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= secs.length) return;
    [secs[i], secs[j]] = [secs[j], secs[i]];
  });
}

function reorderSection(id, index) {
  mutate((site) => {
    const secs = site.pages.find((p) => p.id === st.pageId).sections;
    const i = secs.findIndex((x) => x.id === id);
    if (i < 0) return;
    const [s] = secs.splice(i, 1);
    secs.splice(index > i ? index - 1 : index, 0, s);
  });
}

function duplicateSection(id) {
  let copy;
  mutate((site) => {
    const secs = site.pages.find((p) => p.id === st.pageId).sections;
    const i = secs.findIndex((x) => x.id === id);
    copy = cloneSection(secs[i]);
    secs.splice(i + 1, 0, copy);
  });
  select({ target: 'section', id: copy.id });
}

function deleteSection(id) {
  mutate((site) => {
    const p = site.pages.find((x) => x.id === st.pageId);
    p.sections = p.sections.filter((x) => x.id !== id);
  });
  if (st.sel.id === id) select({ target: 'page' });
  toast('Secção eliminada (Ctrl+Z para anular).');
}

// ---------- Pré-visualização ----------
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(sendRender, 90);
}
function sendRender() {
  if (!frameReady || !frame?.contentWindow) return;
  const site = st.viewing ? st.viewing.site : st.site;
  const pageId = site.pages.some((p) => p.id === st.pageId) ? st.pageId : (site.pages.find((p) => p.home) || site.pages[0]).id;
  frame.contentWindow.postMessage({ type: 'render', site, pageId, selected: st.viewing ? null : st.sel }, location.origin);
}

function onPreviewMessage(e) {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
  const m = e.data || {};
  if (m.type === 'ready') { frameReady = true; sendRender(); return; }
  if (st.viewing) return;
  if (m.type === 'select') {
    if (m.target === 'section') select({ target: 'section', id: m.id });
    else if (m.target === 'header' || m.target === 'footer') select({ target: m.target });
  } else if (m.type === 'move') moveSection(m.id, m.delta);
  else if (m.type === 'reorder') reorderSection(m.id, m.index);
  else if (m.type === 'duplicate') duplicateSection(m.id);
  else if (m.type === 'delete') deleteSection(m.id);
  else if (m.type === 'add') addSection(m.sectionType, m.index);
  else if (m.type === 'navigate') selectPage(m.pageId);
  else if (m.type === 'edit') {
    const s = section(m.id);
    if (!s) return;
    mutate(() => setPath(s.props, m.field, m.value), { structural: false });
    if (st.sel.target === 'section' && st.sel.id === m.id) renderInspector();
  }
}

// ---------- Desenho da interface ----------
function linkOptions() {
  return [
    ...st.site.pages.map((p) => [p.title, pagePath(p)]),
    ['Discord (Definições)', '{{discordUrl}}'], ['TikTok', '{{tiktok}}'], ['YouTube', '{{youtube}}'], ['Instagram', '{{instagram}}'],
    ['Entrar', '/login'], ['Perfil', '/perfil'],
  ];
}

function updateStatus(text) {
  if (!els.status) return;
  els.status.className = `ad-status ${st.dirty ? 'is-dirty' : 'is-saved'}`;
  els.status.textContent = text || (st.dirty ? '● Alterações por guardar' : st.savedAt ? `✓ Guardado ${fmtDateTime(st.savedAt)}` : '✓ Rascunho sincronizado');
  els.published.textContent = st.publishedAt ? `Publicado: ${fmtDateTime(st.publishedAt)}` : 'Ainda não publicado (o site mostra o conteúdo original)';
  els.undoBtn.disabled = !st.undo.length;
  els.redoBtn.disabled = !st.redo.length;
}

function sortable(list, onMove, { acceptPalette = null } = {}) {
  let from = null;
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('[data-index]');
    if (!li) return;
    from = Number(li.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(from));
    li.classList.add('is-dragging');
  });
  list.addEventListener('dragend', (e) => { e.target.closest?.('[data-index]')?.classList.remove('is-dragging'); from = null; list.querySelectorAll('.is-drop-before,.is-drop-after').forEach((x) => x.classList.remove('is-drop-before', 'is-drop-after')); });
  list.addEventListener('dragover', (e) => {
    const palette = acceptPalette && e.dataTransfer.types.includes('application/x-rr-section');
    if (from === null && !palette) return;
    e.preventDefault();
    list.querySelectorAll('.is-drop-before,.is-drop-after').forEach((x) => x.classList.remove('is-drop-before', 'is-drop-after'));
    const li = e.target.closest('[data-index]');
    if (li) { const r = li.getBoundingClientRect(); li.classList.add(e.clientY < r.top + r.height / 2 ? 'is-drop-before' : 'is-drop-after'); }
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const li = e.target.closest('[data-index]');
    let to = li ? Number(li.dataset.index) : list.querySelectorAll('[data-index]').length;
    if (li) { const r = li.getBoundingClientRect(); if (e.clientY >= r.top + r.height / 2) to += 1; }
    const type = e.dataTransfer.getData('application/x-rr-section');
    if (type && acceptPalette) { acceptPalette(type, to); return; }
    if (from !== null && to !== from && to !== from + 1) onMove(from, to);
  });
}

function renderLeft() {
  if (!els.left) return;
  const tabs = h('div', { class: 'ad-tabs ad-tabs--small' }, [['pages', 'Páginas'], ['add', '+ Adicionar'], ['design', 'Design']].map(([k, l]) =>
    h('button', { type: 'button', class: st.leftTab === k ? 'is-active' : '', onclick: () => { st.leftTab = k; renderLeft(); } }, l)));
  const body = h('div', { class: 'ad-left__body' });
  if (st.leftTab === 'pages') {
    const pages = h('ul', { class: 'ad-tree' }, st.site.pages.map((p, i) => h('li', {
      'data-index': i, draggable: 'true', class: `ad-tree__item ${p.id === st.pageId ? 'is-current' : ''} ${p.id === st.pageId && st.sel.target === 'page' ? 'is-selected' : ''}`,
    },
    h('span', { class: 'ad-grip', 'aria-hidden': 'true' }, '⠿'),
    h('button', { type: 'button', class: 'ad-tree__main', onclick: () => selectPage(p.id), title: pagePath(p) },
      h('span', {}, p.home ? '🏠 ' : '📄 ', p.title), h('small', {}, pagePath(p), p.showInMenu === false ? ' · fora do menu' : '')),
    h('span', { class: 'ad-tree__tools' },
      iconBtn('⚙', 'Definições da página', () => { st.pageId = p.id; select({ target: 'page' }); renderAll(); }),
      iconBtn('⧉', 'Duplicar página', () => duplicatePage(p.id)),
      iconBtn('🗑', 'Eliminar página', () => deletePage(p.id), 'ad-icon--danger')))));
    sortable(pages, (from, to) => mutate((s) => { const [x] = s.pages.splice(from, 1); s.pages.splice(to > from ? to - 1 : to, 0, x); }));
    const pg = page();
    const layers = h('ul', { class: 'ad-tree ad-tree--layers' }, pg.sections.map((s, i) => {
      const def = SECTION_TYPES[s.type] || { label: s.type, icon: '?' };
      return h('li', { 'data-index': i, draggable: 'true', class: `ad-tree__item ${st.sel.target === 'section' && st.sel.id === s.id ? 'is-selected' : ''}` },
        h('span', { class: 'ad-grip', 'aria-hidden': 'true' }, '⠿'),
        h('button', { type: 'button', class: 'ad-tree__main', onclick: () => select({ target: 'section', id: s.id }) },
          h('span', {}, `${def.icon} ${def.label}`), snippet(s) ? h('small', {}, snippet(s)) : null),
        h('span', { class: 'ad-tree__tools' },
          iconBtn('⧉', 'Duplicar secção', () => duplicateSection(s.id)),
          iconBtn('🗑', 'Eliminar secção', () => deleteSection(s.id), 'ad-icon--danger')));
    }));
    sortable(layers, (from, to) => reorderSection(pg.sections[from].id, to), { acceptPalette: (type, to) => addSection(type, to) });
    body.append(
      h('div', { class: 'ad-panel-head' }, h('h3', {}, 'Páginas'), btn('+ Nova', addPage, 'ad-btn--sm')), pages,
      h('div', { class: 'ad-panel-head' }, h('h3', {}, `Secções — ${pg.title}`), btn('+ Secção', () => { st.leftTab = 'add'; renderLeft(); }, 'ad-btn--sm ad-btn--ghost')),
      pg.sections.length ? layers : h('p', { class: 'ad-note' }, 'Página vazia. Arrasta secções da aba "+ Adicionar" para aqui ou para a pré-visualização.'),
      h('div', { class: 'ad-zones' },
        btn('Cabeçalho & logo', () => select({ target: 'header' }), `ad-btn--sm ad-btn--ghost ${st.sel.target === 'header' ? 'is-active' : ''}`),
        btn('Rodapé', () => select({ target: 'footer' }), `ad-btn--sm ad-btn--ghost ${st.sel.target === 'footer' ? 'is-active' : ''}`)));
  } else if (st.leftTab === 'add') {
    body.append(h('p', { class: 'ad-note' }, 'Arrasta uma secção para a pré-visualização (ou para a lista de secções), ou clica para a inserir a seguir à secção selecionada.'));
    const groups = {};
    for (const [type, def] of Object.entries(SECTION_TYPES)) (groups[def.group] ||= []).push([type, def]);
    for (const [g, items] of Object.entries(groups)) {
      body.append(h('h4', { class: 'ad-fields__heading' }, g), h('div', { class: 'ad-palette' }, items.map(([type, def]) => {
        const item = h('button', { type: 'button', class: 'ad-palette__item', draggable: 'true', onclick: () => addSection(type), title: `Adicionar ${def.label}` }, h('span', { class: 'ad-palette__icon' }, def.icon), h('span', {}, def.label));
        item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-rr-section', type); e.dataTransfer.effectAllowed = 'copy'; });
        return item;
      })));
    }
  } else {
    const zone = (target, icon, label, desc) => h('button', { type: 'button', class: `ad-zone-card ${st.sel.target === target ? 'is-active' : ''}`, onclick: () => select({ target }) }, h('span', { class: 'ad-zone-card__icon' }, icon), h('span', {}, h('strong', {}, label), h('small', {}, desc)));
    body.append(
      zone('theme', '🎨', 'Tema', 'Cores, fontes, cantos, espaçamentos, bordas'),
      zone('header', '🔝', 'Cabeçalho & logo', 'Logo, tamanho e posição, menu, botões'),
      zone('footer', '🔚', 'Rodapé', 'Logo do rodapé, links, aviso legal'),
      zone('settings', '⚙️', 'Definições do site', 'Nome, Discord, redes sociais, favicon'));
  }
  els.left.replaceChildren(tabs, body);
  // página atual no seletor da barra
  if (els.pageSelect) {
    els.pageSelect.replaceChildren(...st.site.pages.map((p) => h('option', { value: p.id, selected: p.id === st.pageId ? true : null }, `${p.home ? '🏠 ' : ''}${p.title}`)));
  }
}

function renderInspector() {
  if (!els.right) return;
  if (st.viewing) { els.right.replaceChildren(h('div', { class: 'ad-insp' }, h('p', { class: 'ad-note' }, 'A pré-visualizar uma versão antiga. Fecha a pré-visualização para voltar a editar.'))); return; }
  const sel = st.sel;
  const commitTo = (getTarget) => (path, value, o = {}) => mutate(() => {
    const t = getTarget();
    if (value === undefined) { const keys = path.split('.'); const last = keys.pop(); const parent = keys.length ? getPath(t, keys.join('.')) : t; if (parent) delete parent[last]; }
    else setPath(t, path, value);
  }, { coalesce: o.coalesce, structural: false });
  const opts = { linkOptions: linkOptions(), rerender: () => renderInspector() };
  let title;
  let body;
  if (sel.target === 'section' && section()) {
    const s = section();
    const def = SECTION_TYPES[s.type] || { label: s.type, fields: [], icon: '?' };
    title = h('div', { class: 'ad-insp__title' }, h('h3', {}, `${def.icon} ${def.label}`), h('div', { class: 'ad-row' },
      iconBtn('↑', 'Subir', () => moveSection(s.id, -1)), iconBtn('↓', 'Descer', () => moveSection(s.id, 1)),
      iconBtn('⧉', 'Duplicar', () => duplicateSection(s.id)), iconBtn('🗑', 'Eliminar', () => deleteSection(s.id), 'ad-icon--danger')));
    const tabs = h('div', { class: 'ad-tabs ad-tabs--small' }, [['content', 'Conteúdo'], ['style', 'Estilo']].map(([k, l]) => h('button', { type: 'button', class: st.inspTab === k ? 'is-active' : '', onclick: () => { st.inspTab = k; renderInspector(); } }, l)));
    const getProps = () => { const x = section(s.id); if (!x.props) x.props = {}; return x.props; };
    const getStyle = () => { const x = section(s.id); if (!x.style) x.style = {}; return x.style; };
    body = [tabs, st.inspTab === 'style'
      ? renderFields(STYLE_FIELDS, getStyle, commitTo(getStyle), opts)
      : renderFields(def.fields, getProps, commitTo(getProps), opts),
    h('p', { class: 'ad-note' }, 'Dica: faz duplo clique num texto da pré-visualização para o editar diretamente.')];
  } else if (sel.target === 'header') {
    title = h('div', { class: 'ad-insp__title' }, h('h3', {}, '🔝 Cabeçalho & logo'));
    const g = () => (st.site.header ||= {});
    body = renderFields(HEADER_FIELDS, g, commitTo(g), opts);
  } else if (sel.target === 'footer') {
    title = h('div', { class: 'ad-insp__title' }, h('h3', {}, '🔚 Rodapé'));
    const g = () => (st.site.footer ||= {});
    body = renderFields(FOOTER_FIELDS, g, commitTo(g), opts);
  } else if (sel.target === 'theme') {
    title = h('div', { class: 'ad-insp__title' }, h('h3', {}, '🎨 Tema'));
    const g = () => (st.site.theme ||= {});
    body = [renderFields(THEME_FIELDS, g, commitTo(g), opts), btn('Repor tema original', async () => {
      if (!(await confirmDialog('Repor as cores, fontes e medidas originais da ROB RUN Portugal?'))) return;
      const def = await fetch('/assets/site.default.json').then((r) => r.json());
      mutate((s) => { s.theme = def.theme; });
    }, 'ad-btn--sm ad-btn--ghost')];
  } else if (sel.target === 'settings') {
    title = h('div', { class: 'ad-insp__title' }, h('h3', {}, '⚙️ Definições do site'));
    const g = () => (st.site.settings ||= {});
    body = [renderFields(SETTINGS_FIELDS, g, commitTo(g), opts), h('p', { class: 'ad-note' }, 'Os valores iniciais vêm do config.json. Depois de publicares, os valores daqui têm prioridade. O Google Client ID e os segredos não se editam aqui.')];
  } else {
    const p = page();
    st.sel = { target: 'page' };
    title = h('div', { class: 'ad-insp__title' }, h('h3', {}, `📄 ${p.title}`));
    const g = () => page();
    const commitPage = (path, value, o) => {
      if (path === 'slug') value = slugify(value);
      commitTo(g)(path, value, o);
      if (path === 'title' || path === 'slug' || path === 'showInMenu') renderLeft();
    };
    body = [
      p.home ? h('p', { class: 'ad-note' }, '🏠 Esta é a página inicial (endereço /).') : null,
      renderFields(p.home ? PAGE_FIELDS.filter((f) => f.key !== 'slug') : PAGE_FIELDS, g, commitPage, opts),
      h('div', { class: 'ad-stack' },
        p.home ? null : btn('🏠 Definir como página inicial', () => setHome(p.id), 'ad-btn--sm ad-btn--ghost'),
        btn('↗ Abrir página publicada', () => window.open(pagePath(p), '_blank', 'noopener'), 'ad-btn--sm ad-btn--ghost'),
        btn('⧉ Duplicar página', () => duplicatePage(p.id), 'ad-btn--sm ad-btn--ghost'),
        p.home ? null : btn('🗑 Eliminar página', () => deletePage(p.id), 'ad-btn--sm ad-btn--danger-ghost')),
      h('p', { class: 'ad-note' }, 'Seleciona uma secção na pré-visualização ou na lista à esquerda para a editar.'),
    ];
  }
  els.right.replaceChildren(h('div', { class: 'ad-insp' }, title, body));
}

const DEVICE_W = { desktop: 1280, tablet: 820, mobile: 390 };
function fitCanvas() {
  if (!els.canvasWrap || !frame) return;
  const box = els.canvasWrap.getBoundingClientRect();
  const availW = box.width - 32;
  const availH = box.height - 32;
  const w = DEVICE_W[st.device];
  const scale = Math.min(1, availW / w);
  const dev = els.canvasWrap.firstChild;
  dev.style.width = `${w * scale}px`;
  dev.style.height = `${Math.max(400, availH)}px`;
  frame.style.width = `${w}px`;
  frame.style.height = `${Math.max(400, availH) / scale}px`;
  frame.style.transform = scale < 1 ? `scale(${scale})` : '';
  els.zoom.textContent = `${Math.round(scale * 100)}%`;
}

function renderCanvasChrome() {
  if (!els.canvasWrap) return;
  els.canvasWrap.dataset.device = st.device;
  requestAnimationFrame(fitCanvas);
  els.deviceBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.device === st.device));
  els.banner.replaceChildren();
  els.banner.hidden = !st.viewing;
  if (st.viewing) {
    els.banner.append(h('span', {}, `A pré-visualizar a versão de ${fmtDateTime(st.viewing.createdAt)} (${st.viewing.kind}${st.viewing.note ? ` — ${st.viewing.note}` : ''})`),
      h('div', { class: 'ad-row' },
        btn('Restaurar no rascunho', () => restoreVersion(st.viewing.id, false), 'ad-btn--sm'),
        btn('Restaurar e publicar', () => restoreVersion(st.viewing.id, true), 'ad-btn--sm ad-btn--primary'),
        btn('Fechar', () => { st.viewing = null; renderAll(); }, 'ad-btn--sm ad-btn--ghost')));
  }
  els.root.classList.toggle('is-viewing', !!st.viewing);
}

function renderAll() {
  renderLeft();
  renderInspector();
  renderCanvasChrome();
  updateStatus();
  schedulePreview();
}

// ---------- Carregar e montar ----------
async function load(force = false) {
  if (st.loaded && !force) return;
  const { draft, etag, publishedAt } = await api('/admin/site');
  st.site = draft;
  st.etag = etag;
  st.publishedAt = publishedAt;
  st.dirty = false;
  st.undo = [];
  st.redo = [];
  st.loaded = true;
  if (!st.pageId || !st.site.pages.some((p) => p.id === st.pageId)) st.pageId = (st.site.pages.find((p) => p.home) || st.site.pages[0]).id;
  if (els.root) renderAll();
}

function onKey(e) {
  if (!els.root?.isConnected) return;
  const typing = e.target.closest('input, textarea, select, [contenteditable="true"]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel.target === 'section') { e.preventDefault(); deleteSection(st.sel.id); }
}

export async function editorView(root) {
  root.replaceChildren(spinner('A carregar o editor…'));
  try { await load(); } catch (e) { root.replaceChildren(h('div', { class: 'ad-page' }, h('p', { class: 'ad-error' }, errorMsg(e)), btn('Tentar novamente', () => editorView(root)))); return; }

  els = {};
  els.status = h('span', { class: 'ad-status' });
  els.published = h('span', { class: 'ad-muted ad-small' });
  els.undoBtn = iconBtn('↶', 'Anular (Ctrl+Z)', undo);
  els.redoBtn = iconBtn('↷', 'Refazer (Ctrl+Shift+Z)', redo);
  els.pageSelect = h('select', { class: 'ad-page-select', 'aria-label': 'Página em edição', onchange: (e) => selectPage(e.target.value) });
  els.deviceBtns = [['desktop', '🖥', 'Computador'], ['tablet', '📱', 'Tablet'], ['mobile', '📲', 'Telemóvel']].map(([d, i, t]) =>
    h('button', { type: 'button', class: 'ad-icon', 'data-device': d, title: `Pré-visualizar: ${t}`, 'aria-label': t, onclick: () => { st.device = d; renderCanvasChrome(); } }, i));
  els.left = h('aside', { class: 'ad-ed__left', 'aria-label': 'Páginas e secções' });
  els.right = h('aside', { class: 'ad-ed__right', 'aria-label': 'Inspetor' });
  els.banner = h('div', { class: 'ad-version-banner', hidden: true });
  frameReady = false;
  frame = h('iframe', { class: 'ad-frame', src: '/preview.html', title: 'Pré-visualização do site' });
  els.canvasWrap = h('div', { class: 'ad-canvas', 'data-device': st.device }, h('div', { class: 'ad-canvas__device' }, frame));
  const toolbar = h('div', { class: 'ad-ed__toolbar' },
    h('div', { class: 'ad-row' }, els.pageSelect, h('span', { class: 'ad-sep' }), ...els.deviceBtns, els.zoom = h('span', { class: 'ad-muted ad-small', title: 'Escala da pré-visualização' }), h('span', { class: 'ad-sep' }), els.undoBtn, els.redoBtn),
    h('div', { class: 'ad-ed__status' }, els.status, els.published),
    h('div', { class: 'ad-row' },
      btn('🕘 Versões', versionsFlow, 'ad-btn--ghost ad-btn--sm'),
      btn('Guardar rascunho', () => save(), 'ad-btn--sm'),
      btn('Publicar', publishFlow, 'ad-btn--primary ad-btn--sm')));
  els.root = h('div', { class: 'ad-ed' }, els.left, h('section', { class: 'ad-ed__center' }, toolbar, els.banner, els.canvasWrap), els.right);
  root.replaceChildren(els.root);
  new ResizeObserver(() => fitCanvas()).observe(els.canvasWrap);
  window.removeEventListener('message', onPreviewMessage);
  window.addEventListener('message', onPreviewMessage);
  document.removeEventListener('keydown', onKey);
  document.addEventListener('keydown', onKey);
  clearInterval(autosaveTimer);
  autosaveTimer = setInterval(() => { if (st.dirty && !st.saving && !st.viewing && els.root?.isConnected) save({ quiet: true }); }, 45000);
  renderAll();
}

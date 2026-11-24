// Gestão de notícias, guias e clãs.
import { h, fmtDate, toast } from '../dom.js';
import { api } from '../api.js';
import { renderFields } from './fields.js';
import { modal, btn, confirmDialog, promptDialog, spinner, emptyState, errorMsg } from './ui.js';
import { safeUrl } from '../sanitize-client.js';

const TYPES = {
  news: {
    title: 'Notícias', singular: 'notícia', page: '/noticias',
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'summary', label: 'Resumo (aparece na lista)', type: 'textarea' },
      { key: 'cover', label: 'Imagem de capa', type: 'image' },
      { key: 'body', label: 'Texto completo', type: 'rich' },
      { key: 'tags', label: 'Etiquetas (separadas por vírgulas)', type: 'text' },
      { key: 'pinned', label: 'Fixar em destaque', type: 'toggle' },
      { key: 'published', label: 'Publicado', type: 'toggle' },
    ],
  },
  guides: {
    title: 'Guias', singular: 'guia', page: '/guias',
    fields: [
      { key: 'title', label: 'Título', type: 'text' },
      { key: 'summary', label: 'Resumo', type: 'textarea' },
      { key: 'category', label: 'Categoria (ex.: Iniciantes, Estratégia)', type: 'text' },
      { key: 'difficulty', label: 'Dificuldade', type: 'select', options: [['', '—'], ['iniciante', 'Iniciante'], ['intermedio', 'Intermédio'], ['avancado', 'Avançado']] },
      { key: 'cover', label: 'Imagem de capa', type: 'image' },
      { key: 'body', label: 'Conteúdo do guia', type: 'rich' },
      { key: 'tags', label: 'Etiquetas (separadas por vírgulas)', type: 'text' },
      { key: 'pinned', label: 'Fixar em destaque', type: 'toggle' },
      { key: 'published', label: 'Publicado', type: 'toggle' },
    ],
  },
  clans: {
    title: 'Clãs', singular: 'clã', page: '/clas',
    fields: [
      { key: 'title', label: 'Nome do clã', type: 'text' },
      { key: 'tag', label: 'Tag (ex.: LUS)', type: 'text' },
      { key: 'cover', label: 'Logo do clã', type: 'image' },
      { key: 'summary', label: 'Descrição curta', type: 'textarea' },
      { key: 'body', label: 'Descrição completa (página de detalhes)', type: 'rich' },
      { key: 'recruiting', label: 'A recrutar', type: 'toggle' },
      { key: 'requirements', label: 'Requisitos de entrada', type: 'textarea' },
      { key: 'members', label: 'Nº de membros (texto livre, ex.: 25)', type: 'text' },
      { key: 'contactUrl', label: 'Link de contacto/candidatura (Discord, etc.)', type: 'url' },
      { key: 'order', label: 'Ordem na lista (menor aparece primeiro)', type: 'number' },
      { key: 'pinned', label: 'Fixar no topo', type: 'toggle' },
      { key: 'published', label: 'Visível no site', type: 'toggle' },
    ],
  },
};

async function editItem(type, item, onSaved) {
  const cfg = TYPES[type];
  const draft = item ? { ...structuredClone(item), tags: (item.tags || []).join(', ') } : { published: false, pinned: false, tags: '', recruiting: false };
  const form = renderFields(cfg.fields, () => draft, (path, value) => { draft[path] = value; }, { linkOptions: [['Discord (Definições)', '{{discordUrl}}']] });
  const res = await modal({
    title: item ? `Editar ${cfg.singular}` : `Nova ${cfg.singular === 'clã' ? 'entrada de clã' : cfg.singular}`,
    wide: true,
    body: form,
    actions: [
      { label: 'Cancelar', value: null },
      { label: 'Guardar como rascunho', value: () => ({ ...draft, published: false }) },
      { label: item?.published ? 'Guardar' : 'Guardar e publicar', value: () => ({ ...draft, published: item?.published ? draft.published !== false : true }), cls: 'ad-btn--primary',
        validate: () => { if (String(draft.title || '').trim().length < 2) { toast('Indica um título.', 'error'); return false; } return true; } },
    ],
  });
  if (!res) return;
  const payload = { ...res, name: res.title };
  try {
    if (item) await api(`/admin/content/${type}/${item.id}`, { method: 'PUT', body: payload });
    else await api(`/admin/content/${type}`, { method: 'POST', body: payload });
    toast('Guardado.');
    onSaved();
  } catch (e) { toast(errorMsg(e), 'error', 6000); }
}

const CLAN_LABELS = { title: 'Nome', tag: 'Tag', cover: 'Logo', summary: 'Descrição curta', body: 'Descrição completa', recruiting: 'A recrutar', requirements: 'Requisitos', members: 'Membros', contactUrl: 'Contacto' };
const showVal = (k, v) => (k === 'recruiting' ? (v ? 'Sim' : 'Não') : k === 'body' ? String(v || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : String(v ?? '')) || '—';

async function reviewEdit(item, onDone) {
  const rows = Object.keys(CLAN_LABELS).filter((k) => JSON.stringify(item[k] ?? '') !== JSON.stringify(item.pendingEdit[k] ?? ''));
  const table = rows.length
    ? h('table', { class: 'ad-table ad-table--compact ad-diff' }, h('thead', {}, h('tr', {}, h('th', {}, 'Campo'), h('th', {}, 'Atual (público)'), h('th', {}, 'Nova versão'))),
      h('tbody', {}, rows.map((k) => h('tr', {}, h('td', {}, CLAN_LABELS[k]), h('td', { class: 'ad-diff__old' }, showVal(k, item[k])), h('td', { class: 'ad-diff__new' }, showVal(k, item.pendingEdit[k]))))))
    : h('p', { class: 'ad-muted' }, 'A nova versão é igual à atual.');
  const choice = await modal({
    title: `Alteração ao clã "${item.title}"`, wide: true,
    body: h('div', {}, h('p', { class: 'ad-muted' }, `Pedida por ${item.submittedByName || 'jogador'}. Só aparecem os campos que mudaram.`), table),
    actions: [{ label: 'Fechar', value: null }, { label: '✕ Recusar alteração', value: 'reject', cls: 'ad-btn--danger-ghost' }, { label: '✓ Aprovar alteração', value: 'approve', cls: 'ad-btn--primary' }],
  });
  if (!choice) return;
  try {
    if (choice === 'approve') { await api(`/admin/clans/${item.id}/edit-approve`, { method: 'POST' }); toast('Alteração aprovada e publicada.'); }
    else {
      const reason = await promptDialog('Recusar alteração', { label: 'Motivo (o jogador vai ver esta mensagem)' });
      if (reason === null) return;
      await api(`/admin/clans/${item.id}/edit-reject`, { method: 'POST', body: { reason } });
      toast('Alteração recusada. Mantém-se a versão anterior.');
    }
    onDone();
  } catch (e) { toast(errorMsg(e), 'error'); }
}

async function clanSettingsBox(isAdmin) {
  const box = h('div', { class: 'ad-card ad-clan-settings' });
  try {
    const { settings } = await api('/admin/clans-settings');
    const t1 = h('input', { type: 'checkbox', class: 'ad-switch', checked: settings.allowOwnerEdits ? true : null, disabled: isAdmin ? null : true });
    const t2 = h('input', { type: 'checkbox', class: 'ad-switch', checked: settings.requireEditApproval ? true : null, disabled: isAdmin ? null : true });
    const save = async () => {
      try { await api('/admin/clans-settings', { method: 'PUT', body: { allowOwnerEdits: t1.checked, requireEditApproval: t2.checked } }); toast('Definições guardadas.'); }
      catch (e) { toast(errorMsg(e), 'error'); }
      t2.closest('label').style.opacity = t1.checked ? '' : '.45';
    };
    t1.addEventListener('change', save);
    t2.addEventListener('change', save);
    box.append(h('h3', {}, '✏️ Edição dos anúncios pelos donos'),
      h('label', { class: 'ad-toggle' }, t1, h('span', {}, 'Os donos podem editar o anúncio do seu clã no site')),
      h('label', { class: 'ad-toggle', style: { opacity: settings.allowOwnerEdits ? '' : '.45' } }, t2, h('span', {}, 'As alterações a clãs já aprovados precisam da aprovação da equipa')),
      ...(isAdmin ? [] : [h('p', { class: 'ad-small ad-muted' }, 'Só administradores podem mudar estas opções.')]));
  } catch (e) { box.append(h('p', { class: 'ad-error' }, errorMsg(e))); }
  return box;
}

export async function contentView(root, type) {
  const cfg = TYPES[type];
  const listEl = h('div', { class: 'ad-table-wrap' }, spinner());
  const search = h('input', { type: 'search', placeholder: 'Pesquisar…', class: 'ad-search' });
  const filter = h('select', {}, h('option', { value: '' }, 'Todos'), h('option', { value: 'pub' }, 'Publicados'), h('option', { value: 'draft' }, 'Rascunhos'),
    type === 'clans' ? h('option', { value: 'pending' }, 'Pedidos pendentes') : null,
    type === 'clans' ? h('option', { value: 'edits' }, 'Alterações pendentes') : null);
  const pendingNote = h('div');
  const settingsSlot = h('div');
  if (type === 'clans') api('/auth/me').then(({ user }) => clanSettingsBox(user?.role === 'admin')).then((b) => settingsSlot.replaceChildren(b)).catch(() => {});
  let items = [];
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const match = (i) => !filter.value || (filter.value === 'pub' ? i.published : filter.value === 'pending' ? i.status === 'pending' : filter.value === 'edits' ? !!i.pendingEdit : !i.published);
    const shown = items.filter((i) => (!q || `${i.title} ${i.summary} ${i.tag || ''} ${i.submittedByName || ''}`.toLowerCase().includes(q)) && match(i))
      .sort((a, b) => ((b.status === 'pending') + !!b.pendingEdit) - ((a.status === 'pending') + !!a.pendingEdit));
    const nPending = items.filter((i) => i.status === 'pending').length;
    const nEdits = items.filter((i) => i.pendingEdit).length;
    const notes = [];
    if (type === 'clans' && nPending) notes.push(h('div', { class: 'ad-note ad-note--alert' }, `🛡️ ${nPending} pedido(s) de clã à espera de análise.`));
    if (type === 'clans' && nEdits) notes.push(h('div', { class: 'ad-note ad-note--alert' }, `✏️ ${nEdits} alteração(ões) de anúncio à espera de aprovação.`));
    pendingNote.replaceChildren(...notes);
    if (!items.length) { listEl.replaceChildren(emptyState(`Ainda não há ${cfg.title.toLowerCase()}.`, btn(`+ Criar`, () => editItem(type, null, load), 'ad-btn--primary'))); return; }
    listEl.replaceChildren(h('table', { class: 'ad-table' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, type === 'clans' ? 'Clã' : 'Título'), h('th', {}, 'Estado'), h('th', {}, type === 'clans' ? 'Recrutamento' : 'Data'), h('th', {}, 'Ações'))),
      h('tbody', {}, shown.map((i) => h('tr', {},
        h('td', { class: 'ad-td-thumb' }, safeUrl(i.cover) ? h('img', { src: safeUrl(i.cover), alt: '' }) : h('span', { class: 'ad-thumb-empty' }, type === 'clans' ? '🛡' : '📰')),
        h('td', {}, h('strong', {}, i.title, i.tag ? ` [${i.tag}]` : ''), i.pinned ? h('span', { class: 'ad-pill ad-pill--green' }, 'fixado') : null, h('div', { class: 'ad-muted ad-small' }, (i.summary || '').slice(0, 90))),
        h('td', {}, i.status === 'pending' ? h('span', { class: 'ad-pill ad-pill--gold' }, 'Pendente')
          : i.status === 'rejected' ? h('span', { class: 'ad-pill ad-pill--red' }, 'Recusado')
          : h('span', { class: `ad-pill ad-pill--${i.published ? 'green' : 'grey'}` }, i.published ? 'Publicado' : 'Rascunho'),
          i.pendingEdit ? h('span', { class: 'ad-pill ad-pill--gold' }, '✏️ Alteração pendente') : null,
          i.submittedByName ? h('div', { class: 'ad-small ad-muted' }, `Enviado por ${i.submittedByName}`) : null,
          i.status === 'rejected' && i.rejectReason ? h('div', { class: 'ad-small ad-muted' }, `Motivo: ${i.rejectReason}`) : null),
        h('td', { class: 'ad-small' }, type === 'clans' ? (i.recruiting ? '● A recrutar' : 'Fechado') : fmtDate(i.publishedAt || i.createdAt)),
        h('td', {}, h('div', { class: 'ad-row ad-row--wrap' },
          type === 'clans' && i.status && i.status !== 'approved' ? btn('✓ Aprovar', async () => {
            try { await api(`/admin/clans/${i.id}/approve`, { method: 'POST' }); toast('Clã aprovado e publicado.'); load(); } catch (e) { toast(errorMsg(e), 'error'); }
          }, 'ad-btn--sm ad-btn--primary') : null,
          type === 'clans' && i.status === 'pending' ? btn('✕ Recusar', async () => {
            const reason = await promptDialog(`Recusar "${i.title}"`, { label: 'Motivo (o jogador vai ver esta mensagem)', placeholder: 'Ex.: falta o link do Discord' });
            if (reason === null) return;
            try { await api(`/admin/clans/${i.id}/reject`, { method: 'POST', body: { reason } }); toast('Pedido recusado.'); load(); } catch (e) { toast(errorMsg(e), 'error'); }
          }, 'ad-btn--sm ad-btn--danger-ghost') : null,
          i.pendingEdit ? btn('👁 Rever alteração', () => reviewEdit(i, load), 'ad-btn--sm ad-btn--primary') : null,
          btn('Editar', () => editItem(type, i, load), 'ad-btn--sm'),
          btn(i.published ? 'Despublicar' : 'Publicar', async () => {
            try { await api(`/admin/content/${type}/${i.id}`, { method: 'PUT', body: { published: !i.published } }); load(); } catch (e) { toast(errorMsg(e), 'error'); }
          }, 'ad-btn--sm ad-btn--ghost'),
          btn('Duplicar', async () => { try { await api(`/admin/content/${type}/${i.id}/duplicate`, { method: 'POST' }); toast('Duplicado (como rascunho).'); load(); } catch (e) { toast(errorMsg(e), 'error'); } }, 'ad-btn--sm ad-btn--ghost'),
          btn('Eliminar', async () => {
            if (!(await confirmDialog(`Eliminar "${i.title}"? Esta ação não pode ser anulada (fica disponível nos backups).`, { danger: true, ok: 'Eliminar' }))) return;
            try { await api(`/admin/content/${type}/${i.id}`, { method: 'DELETE' }); toast('Eliminado.'); load(); } catch (e) { toast(errorMsg(e), 'error'); }
          }, 'ad-btn--sm ad-btn--danger-ghost'))))))));
  };
  async function load() {
    try { items = (await api(`/admin/content/${type}`)).items; draw(); }
    catch (e) { listEl.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
  }
  search.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  root.replaceChildren(h('div', { class: 'ad-page' },
    h('div', { class: 'ad-page__head' }, h('div', {}, h('h1', {}, cfg.title), h('p', { class: 'ad-muted' }, `Aparecem nas secções "Lista dinâmica" do site (ex.: página ${cfg.page}).`)),
      h('div', { class: 'ad-row' }, btn('Ver no site ↗', () => window.open(cfg.page, '_blank', 'noopener'), 'ad-btn--ghost'), btn(`+ Nova ${cfg.singular}`, () => editItem(type, null, load), 'ad-btn--primary'))),
    h('div', { class: 'ad-row ad-filters' }, search, filter), pendingNote, settingsSlot, listEl));
  load();
}

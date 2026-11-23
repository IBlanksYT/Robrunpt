// Moderação: clips, utilizadores/permissões e registo de atividade.
import { h, fmtDate, fmtDateTime, toast } from '../dom.js';
import { api } from '../api.js';
import { modal, btn, confirmDialog, spinner, emptyState, errorMsg } from './ui.js';
import { safeUrl } from '../sanitize-client.js';

const ROLE_LABEL = { player: 'Jogador', moderator: 'Moderador', admin: 'Administrador' };

export async function clipsView(root, { me, onOpenUser } = {}) {
  const grid = h('div', { class: 'ad-clip-grid' }, spinner());
  const search = h('input', { type: 'search', placeholder: 'Pesquisar título ou autor…', class: 'ad-search' });
  const filter = h('select', {}, h('option', { value: '' }, 'Todos'), h('option', { value: 'visible' }, 'Visíveis'), h('option', { value: 'hidden' }, 'Ocultos'), h('option', { value: 'featured' }, 'Destacados'));
  const userFilter = new URLSearchParams(location.hash.split('?')[1] || '').get('user');
  let items = [];
  let cursor = 0;
  const more = btn('Carregar mais', () => load(false), 'ad-btn--ghost');
  const patch = async (c, body, msg) => {
    try { const r = await api(`/admin/clips/${c.id}`, { method: 'PATCH', body }); Object.assign(c, r.clip); toast(msg); draw(); }
    catch (e) { toast(errorMsg(e), 'error'); }
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter((c) => (!q || `${c.title} ${c.author?.name}`.toLowerCase().includes(q))
      && (!filter.value || (filter.value === 'hidden' ? c.hidden : filter.value === 'visible' ? !c.hidden : c.featured)));
    if (!items.length) { grid.replaceChildren(emptyState('Ainda não há clips publicados.')); return; }
    grid.replaceChildren(...shown.map((c) => h('article', { class: `ad-clip ${c.hidden ? 'is-hidden' : ''}` },
      h('a', { href: safeUrl(c.url), target: '_blank', rel: 'noopener noreferrer', class: 'ad-clip__thumb' },
        safeUrl(c.thumbnail) ? h('img', { src: safeUrl(c.thumbnail), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', {}, c.platform === 'tiktok' ? 'TikTok' : 'YouTube'),
        h('span', { class: 'ad-clip__platform' }, c.platform === 'tiktok' ? 'TikTok' : c.kind === 'shorts' ? 'Shorts' : 'YouTube')),
      h('div', { class: 'ad-clip__body' },
        h('strong', {}, c.title),
        h('div', { class: 'ad-muted ad-small' }, `${c.author?.name || 'Jogador'} · ${fmtDateTime(c.createdAt)}`),
        h('div', { class: 'ad-row' }, c.hidden ? h('span', { class: 'ad-pill ad-pill--red' }, 'Oculto') : h('span', { class: 'ad-pill ad-pill--green' }, 'Visível'), c.featured ? h('span', { class: 'ad-pill ad-pill--gold' }, '★ Destaque') : null),
        c.moderationNote ? h('div', { class: 'ad-small ad-muted' }, `Nota: ${c.moderationNote}`) : null,
        h('div', { class: 'ad-row ad-row--wrap' },
          btn('Editar', async () => {
            const t = h('input', { type: 'text', value: c.title, maxlength: 100 });
            const d = h('textarea', { rows: 3, maxlength: 500 }, c.description || '');
            const n = h('input', { type: 'text', value: c.moderationNote || '', maxlength: 200, placeholder: 'Visível apenas para a moderação' });
            const ok = await modal({ title: 'Editar clip', body: h('div', { class: 'ad-fields' }, h('label', { class: 'ad-field' }, h('span', { class: 'ad-field__label' }, 'Título'), t), h('label', { class: 'ad-field' }, h('span', { class: 'ad-field__label' }, 'Descrição'), d), h('label', { class: 'ad-field' }, h('span', { class: 'ad-field__label' }, 'Nota interna de moderação'), n)), actions: [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, cls: 'ad-btn--primary' }] });
            if (ok) patch(c, { title: t.value, description: d.value, moderationNote: n.value }, 'Clip atualizado.');
          }, 'ad-btn--sm'),
          btn(c.hidden ? 'Mostrar' : 'Ocultar', () => patch(c, { hidden: !c.hidden }, c.hidden ? 'Clip visível.' : 'Clip ocultado.'), 'ad-btn--sm ad-btn--ghost'),
          btn(c.featured ? 'Tirar destaque' : 'Destacar', () => patch(c, { featured: !c.featured }, 'Atualizado.'), 'ad-btn--sm ad-btn--ghost'),
          btn('Eliminar', async () => {
            if (!(await confirmDialog(`Eliminar o clip "${c.title}"?`, { danger: true, ok: 'Eliminar' }))) return;
            try { await api(`/clips/${c.id}`, { method: 'DELETE' }); items = items.filter((x) => x.id !== c.id); toast('Clip eliminado.'); draw(); } catch (e) { toast(errorMsg(e), 'error'); }
          }, 'ad-btn--sm ad-btn--danger-ghost'),
          c.userId !== me.id ? btn('Autor', () => onOpenUser?.(c.userId), 'ad-btn--sm ad-btn--ghost') : null)))));
  };
  async function load(reset = true) {
    if (reset) { items = []; cursor = 0; }
    try {
      const q = new URLSearchParams({ limit: '60', cursor: String(cursor) });
      if (userFilter) q.set('user', userFilter);
      const data = await api(`/admin/clips?${q}`);
      items = items.concat(data.items);
      cursor = data.nextCursor;
      more.hidden = cursor === null;
      draw();
    } catch (e) { grid.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
  }
  search.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  root.replaceChildren(h('div', { class: 'ad-page' },
    h('div', { class: 'ad-page__head' }, h('div', {}, h('h1', {}, 'Clips'), h('p', { class: 'ad-muted' }, userFilter ? 'Clips de um utilizador. ' : 'Publicação automática: modera aqui o que os jogadores publicam.', userFilter ? h('a', { href: '#clips' }, 'Ver todos') : null))),
    h('div', { class: 'ad-row ad-filters' }, search, filter), grid, h('div', { class: 'ad-row ad-row--center' }, more)));
  load();
}

export async function usersView(root, { me }) {
  const isAdmin = me.role === 'admin';
  const list = h('div', { class: 'ad-table-wrap' }, spinner());
  const search = h('input', { type: 'search', placeholder: 'Pesquisar nome ou email…', class: 'ad-search', value: new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '' });
  let items = [];
  const patch = async (u, body, msg) => {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body }); toast(msg); load(); }
    catch (e) { toast(errorMsg(e), 'error'); load(); }
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter((u) => !q || `${u.name} ${u.email} ${u.id}`.toLowerCase().includes(q));
    if (!items.length) { list.replaceChildren(emptyState('Ainda não há utilizadores registados. Os jogadores aparecem aqui depois de entrarem com Google.')); return; }
    list.replaceChildren(h('table', { class: 'ad-table' },
      h('thead', {}, h('tr', {}, ['Utilizador', 'Função', 'Clips', 'Registo', 'Último login', 'Estado', 'Ações'].map((t) => h('th', {}, t)))),
      h('tbody', {}, shown.map((u) => {
        const self = u.id === me.id;
        const roleSel = h('select', { disabled: !isAdmin || self ? true : null, 'aria-label': 'Função' }, Object.entries(ROLE_LABEL).map(([v, l]) => h('option', { value: v, selected: u.role === v ? true : null }, l)));
        roleSel.addEventListener('change', async () => {
          if (!(await confirmDialog(`Alterar a função de ${u.name} para ${ROLE_LABEL[roleSel.value]}?`))) { roleSel.value = u.role; return; }
          patch(u, { role: roleSel.value }, 'Permissões atualizadas.');
        });
        const canModerate = !self && (isAdmin || u.role === 'player');
        return h('tr', { class: u.banned ? 'is-banned' : '' },
          h('td', {}, h('div', { class: 'ad-user' }, safeUrl(u.picture) ? h('img', { src: safeUrl(u.picture), alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'ad-user__letter' }, u.name?.[0] || '?'),
            h('div', {}, h('strong', {}, u.name, self ? ' (tu)' : ''), h('div', { class: 'ad-muted ad-small' }, u.email)))),
          h('td', {}, roleSel),
          h('td', {}, u.clips ? h('a', { href: `#clips?user=${encodeURIComponent(u.id)}` }, String(u.clips)) : '0'),
          h('td', { class: 'ad-small' }, fmtDate(u.createdAt)),
          h('td', { class: 'ad-small' }, fmtDateTime(u.lastLoginAt)),
          h('td', {}, u.banned ? h('span', { class: 'ad-pill ad-pill--red' }, 'Suspenso') : h('span', { class: 'ad-pill ad-pill--green' }, 'Ativo')),
          h('td', {}, h('div', { class: 'ad-row' },
            h('a', { class: 'ad-btn ad-btn--sm ad-btn--ghost', href: `/perfil?u=${encodeURIComponent(u.id)}`, target: '_blank', rel: 'noopener' }, 'Perfil'),
            canModerate ? btn(u.banned ? 'Reativar' : 'Suspender', async () => {
              if (!u.banned && !(await confirmDialog(`Suspender ${u.name}? A sessão é terminada e deixa de poder publicar. Os clips mantêm-se (podes ocultá-los no separador Clips).`, { danger: true, ok: 'Suspender' }))) return;
              patch(u, { banned: !u.banned }, u.banned ? 'Conta reativada.' : 'Conta suspensa.');
            }, 'ad-btn--sm ad-btn--ghost') : null,
            isAdmin && !self ? btn('Eliminar', async () => {
              if (!(await confirmDialog(`Eliminar definitivamente ${u.name} e os seus ${u.clips} clip(s)?`, { danger: true, ok: 'Eliminar' }))) return;
              try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast('Utilizador eliminado.'); load(); } catch (e) { toast(errorMsg(e), 'error'); }
            }, 'ad-btn--sm ad-btn--danger-ghost') : null)));
      }))));
  };
  async function load() {
    try { items = (await api('/admin/users')).items; draw(); }
    catch (e) { list.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
  }
  search.addEventListener('input', draw);
  root.replaceChildren(h('div', { class: 'ad-page' },
    h('div', { class: 'ad-page__head' }, h('div', {}, h('h1', {}, 'Utilizadores & permissões'),
      h('p', { class: 'ad-muted' }, 'Jogador: publica clips. Moderador: gere conteúdos, clips e jogadores. Administrador: tudo, incluindo o editor do site, permissões e backups.'))),
    h('div', { class: 'ad-row ad-filters' }, search), list));
  load();
}

export async function auditView(root) {
  const list = h('div', {}, spinner());
  root.replaceChildren(h('div', { class: 'ad-page' }, h('div', { class: 'ad-page__head' }, h('div', {}, h('h1', {}, 'Atividade'), h('p', { class: 'ad-muted' }, 'Registo das ações de administração e moderação (guardado 180 dias).'))), list));
  try {
    const { items } = await api('/admin/audit');
    if (!items.length) { list.replaceChildren(emptyState('Sem atividade registada.')); return; }
    list.replaceChildren(h('table', { class: 'ad-table' }, h('thead', {}, h('tr', {}, ['Quando', 'Quem', 'Ação', 'Alvo'].map((t) => h('th', {}, t)))),
      h('tbody', {}, items.map((a) => h('tr', {}, h('td', { class: 'ad-small' }, fmtDateTime(a.at)), h('td', {}, a.actorName), h('td', {}, a.action), h('td', { class: 'ad-small ad-muted' }, a.target || '—'))))));
  } catch (e) { list.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
}

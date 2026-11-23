// Estatísticas, backups e estado da configuração.
import { h, fmtDateTime, toast } from '../dom.js';
import { api } from '../api.js';
import { btn, confirmDialog, promptDialog, spinner, emptyState, errorMsg } from './ui.js';

function kpi(label, value, sub) {
  return h('div', { class: 'ad-kpi' }, h('span', { class: 'ad-kpi__label' }, label), h('strong', { class: 'ad-kpi__value' }, String(value)), sub ? h('small', {}, sub) : null);
}

function barChart(series) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 760; const H = 220; const pad = 28;
  const max = Math.max(1, ...series.map((s) => s.views));
  const bw = (W - pad * 2) / series.length;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'ad-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Visitas por dia');
  const mk = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text) e.textContent = text; svg.append(e); return e; };
  for (let i = 0; i <= 4; i++) {
    const y = pad + ((H - pad * 2) * i) / 4;
    mk('line', { x1: pad, x2: W - pad, y1: y, y2: y, class: 'ad-chart__grid' });
    mk('text', { x: 4, y: y + 4, class: 'ad-chart__axis' }, String(Math.round(max * (1 - i / 4))));
  }
  series.forEach((s, i) => {
    const bh = ((H - pad * 2) * s.views) / max;
    const r = mk('rect', { x: pad + i * bw + 2, y: H - pad - bh, width: Math.max(1, bw - 4), height: Math.max(0, bh), rx: 3, class: 'ad-chart__bar' });
    const t = document.createElementNS(ns, 'title'); t.textContent = `${s.date}: ${s.views} visitas`; r.append(t);
    if (series.length <= 31 && (i % Math.ceil(series.length / 8) === 0)) mk('text', { x: pad + i * bw + bw / 2, y: H - 8, class: 'ad-chart__axis', 'text-anchor': 'middle' }, s.date.slice(5).split('-').reverse().join('/'));
  });
  return svg;
}

export async function statsView(root) {
  const body = h('div', {}, spinner());
  const period = h('select', {}, [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([v, l]) => h('option', { value: v, selected: v === 30 ? true : null }, l)));
  async function load() {
    body.replaceChildren(spinner());
    try {
      const s = await api(`/admin/stats?days=${period.value}`);
      const src = { direct: 'Direto', search: 'Pesquisa', social: 'Redes sociais', other: 'Outros' };
      const totalSrc = Object.values(s.sources).reduce((a, b) => a + b, 0) || 1;
      body.replaceChildren(
        h('div', { class: 'ad-kpis' },
          kpi('Visitas', s.totalViews, `últimos ${s.days} dias`),
          kpi('Utilizadores', s.users.total, `+${s.users.newInPeriod} novos · ${s.users.activeInPeriod} ativos`),
          kpi('Clips', s.clips.total, `+${s.clips.newInPeriod} no período`),
          kpi('Notícias / Guias / Clãs', `${s.content.news} / ${s.content.guides} / ${s.content.clans}`),
          kpi('Contas suspensas', s.users.banned)),
        h('div', { class: 'ad-card' }, h('h3', {}, 'Visitas por dia'), barChart(s.series)),
        h('div', { class: 'ad-grid-2' },
          h('div', { class: 'ad-card' }, h('h3', {}, 'Páginas mais vistas'), s.topPages.length
            ? h('table', { class: 'ad-table ad-table--compact' }, h('tbody', {}, s.topPages.map((p) => h('tr', {}, h('td', {}, p.path), h('td', { class: 'ad-num' }, String(p.views))))))
            : h('p', { class: 'ad-muted' }, 'Sem dados ainda.')),
          h('div', { class: 'ad-card' }, h('h3', {}, 'Origem das visitas'), ...Object.entries(src).map(([k, l]) => {
            const v = s.sources[k] || 0;
            return h('div', { class: 'ad-meter' }, h('div', { class: 'ad-meter__label' }, h('span', {}, l), h('span', {}, `${v} (${Math.round((v / totalSrc) * 100)}%)`)), h('div', { class: 'ad-meter__bar' }, h('span', { style: { width: `${(v / totalSrc) * 100}%` } })));
          }))),
        h('p', { class: 'ad-note' }, 'Estatísticas anónimas e agregadas: sem cookies, sem IPs e sem identificadores (conforme o RGPD).'));
    } catch (e) { body.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
  }
  period.addEventListener('change', load);
  root.replaceChildren(h('div', { class: 'ad-page' }, h('div', { class: 'ad-page__head' }, h('h1', {}, 'Estatísticas'), period), body));
  load();
}

export async function backupsView(root) {
  const list = h('div', { class: 'ad-table-wrap' }, spinner());
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  async function load() {
    try {
      const { items } = await api('/admin/backups');
      if (!items.length) { list.replaceChildren(emptyState('Ainda não há backups. É criado automaticamente um backup por dia; podes criar um agora.')); return; }
      list.replaceChildren(h('table', { class: 'ad-table' }, h('thead', {}, h('tr', {}, ['Data', 'Tipo', 'Conteúdo', 'Por', 'Ações'].map((t) => h('th', {}, t)))),
        h('tbody', {}, items.map((b) => h('tr', {},
          h('td', {}, h('strong', {}, fmtDateTime(b.createdAt)), b.note ? h('div', { class: 'ad-small ad-muted' }, b.note) : null),
          h('td', {}, h('span', { class: `ad-pill ad-pill--${b.kind === 'manual' ? 'green' : 'grey'}` }, b.kind)),
          h('td', { class: 'ad-small' }, `${b.counts?.content ?? 0} conteúdos · ${b.counts?.clips ?? 0} clips · ${b.counts?.users ?? 0} utilizadores`),
          h('td', { class: 'ad-small' }, b.by),
          h('td', {}, h('div', { class: 'ad-row' },
            h('a', { class: 'ad-btn ad-btn--sm ad-btn--ghost', href: `/api/admin/backups/${b.id}`, download: '' }, 'Descarregar'),
            btn('Restaurar', async () => {
              if (!(await confirmDialog('Restaurar este backup? O site (rascunho e publicado), conteúdos, clips e utilizadores voltam a este estado. É criado automaticamente um backup do estado atual antes.', { danger: true, ok: 'Restaurar' }))) return;
              try { await api(`/admin/backups/${b.id}/restore`, { method: 'POST' }); toast('Backup restaurado. Recarrega o editor para ver o site restaurado.'); load(); } catch (e) { toast(errorMsg(e), 'error'); }
            }, 'ad-btn--sm'),
            btn('Eliminar', async () => {
              if (!(await confirmDialog('Eliminar este backup?', { danger: true, ok: 'Eliminar' }))) return;
              try { await api(`/admin/backups/${b.id}`, { method: 'DELETE' }); load(); } catch (e) { toast(errorMsg(e), 'error'); }
            }, 'ad-btn--sm ad-btn--danger-ghost'))))))));
    } catch (e) { list.replaceChildren(h('p', { class: 'ad-error' }, errorMsg(e))); }
  }
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      await api('/admin/backups/import', { method: 'POST', body: data });
      toast('Backup importado. Usa "Restaurar" para o aplicar.');
      load();
    } catch (e) { toast(e instanceof SyntaxError ? 'Ficheiro JSON inválido.' : errorMsg(e), 'error'); }
  });
  root.replaceChildren(h('div', { class: 'ad-page' },
    h('div', { class: 'ad-page__head' }, h('div', {}, h('h1', {}, 'Backups'), h('p', { class: 'ad-muted' }, 'Cópias completas guardadas em Netlify Blobs. Backup automático diário (mantidos 14). As imagens ficam na biblioteca Media e não são apagadas por um restauro.')),
      h('div', { class: 'ad-row' }, btn('Importar ficheiro', () => fileIn.click(), 'ad-btn--ghost'), btn('+ Criar backup agora', async () => {
        const note = await promptDialog('Novo backup', { label: 'Nota (opcional)', value: '' });
        if (note === null) return;
        try { await api('/admin/backups', { method: 'POST', body: { note } }); toast('Backup criado.'); load(); } catch (e) { toast(errorMsg(e), 'error'); }
      }, 'ad-btn--primary'), fileIn)),
    list));
  load();
}

export async function healthBanner() {
  try {
    const hh = await api('/health');
    const issues = [];
    if (!hh.googleConfigured) issues.push('Login Google desativado: preenche "googleClientId" no config.json e volta a publicar.');
    if (!hh.adminPasswordConfigured) issues.push('ADMIN_PASSWORD não definida no Netlify.');
    return issues;
  } catch { return []; }
}

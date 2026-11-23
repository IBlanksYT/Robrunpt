// Estatísticas agregadas e anónimas: sem cookies, sem IPs, sem identificadores.
import { updateJSON, getMany, listKeys, del } from './store.mjs';
import { listUsers } from './users.mjs';
import { listContent } from './content.mjs';

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export async function recordView(path, referrerKind) {
  const p = String(path || '/').toLowerCase().replace(/[^a-z0-9/_-]/g, '').slice(0, 80) || '/';
  await updateJSON('stats', `d/${day()}`, (cur) => {
    const rec = cur || { total: 0, pages: {}, sources: {} };
    rec.total += 1;
    if (rec.pages[p] !== undefined || Object.keys(rec.pages).length < 300) rec.pages[p] = (rec.pages[p] || 0) + 1;
    const src = ['direct', 'search', 'social', 'other'].includes(referrerKind) ? referrerKind : 'other';
    rec.sources[src] = (rec.sources[src] || 0) + 1;
    return rec;
  });
}

export async function recordEvent(name) {
  await updateJSON('stats', `d/${day()}`, (cur) => {
    const rec = cur || { total: 0, pages: {}, sources: {} };
    rec.events = rec.events || {};
    rec.events[name] = (rec.events[name] || 0) + 1;
    return rec;
  });
}

export async function getStats(days = 30) {
  days = Math.min(365, Math.max(1, Number(days) || 30));
  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(day(Date.now() - i * 86400e3));
  const recs = await getMany('stats', dates.map((d) => `d/${d}`));
  const series = dates.map((d, i) => ({ date: d, views: recs[i]?.total || 0, events: recs[i]?.events || {} }));
  const pages = {};
  const sources = {};
  for (const r of recs) {
    if (!r) continue;
    for (const [k, v] of Object.entries(r.pages || {})) pages[k] = (pages[k] || 0) + v;
    for (const [k, v] of Object.entries(r.sources || {})) sources[k] = (sources[k] || 0) + v;
  }
  const users = await listUsers();
  const since = Date.now() - days * 86400e3;
  const clipKeys = await listKeys('clips', 'c/');
  const [news, guides, clans] = await Promise.all(['news', 'guides', 'clans'].map((t) => listContent(t, { includeDrafts: true })));
  return {
    days,
    series,
    totalViews: series.reduce((a, b) => a + b.views, 0),
    topPages: Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([path, views]) => ({ path, views })),
    sources,
    users: { total: users.length, newInPeriod: users.filter((u) => u.createdAt >= since).length, activeInPeriod: users.filter((u) => (u.lastLoginAt || 0) >= since).length, banned: users.filter((u) => u.banned).length },
    clips: { total: clipKeys.length, newInPeriod: series.reduce((a, b) => a + (b.events.clip || 0), 0) },
    content: { news: news.length, guides: guides.length, clans: clans.length },
  };
}

export async function pruneStats(keepDays = 400) {
  const cutoff = day(Date.now() - keepDays * 86400e3);
  const keys = await listKeys('stats', 'd/');
  let n = 0;
  for (const k of keys) if (k.slice(2) < cutoff) { await del('stats', k); n++; }
  return n;
}

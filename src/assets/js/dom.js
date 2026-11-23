// Pequenos utilitários de DOM. Todo o texto é inserido como texto (nunca como HTML).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [p, val] of Object.entries(v)) if (val !== undefined && val !== null && val !== '') el.style.setProperty(p, String(val));
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'agora mesmo';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const hh = Math.round(m / 60);
  if (hh < 24) return `há ${hh} h`;
  const d = Math.round(hh / 24);
  if (d < 30) return `há ${d} dia${d > 1 ? 's' : ''}`;
  return fmtDate(ts);
}

export function uid(prefix = 's') {
  return prefix + Math.random().toString(36).slice(2, 10);
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (o[k] == null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

export function toast(message, type = 'ok', ms = 3500) {
  let box = document.querySelector('.rr-toasts');
  if (!box) { box = h('div', { class: 'rr-toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `rr-toast rr-toast--${type}` }, message);
  box.append(t);
  setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); }, ms);
}

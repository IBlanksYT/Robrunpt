// Componentes de interface do painel: janelas, confirmações, botões.
import { h, toast } from '../dom.js';

export { toast };

export function btn(label, onClick, cls = '', attrs = {}) {
  return h('button', { type: 'button', class: `ad-btn ${cls}`, onclick: onClick, ...attrs }, label);
}

export function iconBtn(icon, title, onClick, cls = '') {
  return h('button', { type: 'button', class: `ad-icon ${cls}`, title, 'aria-label': title, onclick: onClick }, icon);
}

/** Janela modal. actions: [{label, value, cls}] — devolve a value escolhida (ou null ao fechar). */
export function modal({ title, body, actions = [{ label: 'Fechar', value: null }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const box = h('div', { class: `ad-modal ${wide ? 'ad-modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('header', { class: 'ad-modal__head' }, h('h2', {}, title), iconBtn('✕', 'Fechar', () => close(null))),
      h('div', { class: 'ad-modal__body' }, body),
      actions.length ? h('footer', { class: 'ad-modal__foot' }, actions.map((a) => btn(a.label, async () => {
        if (a.validate && !(await a.validate())) return;
        close(typeof a.value === 'function' ? await a.value() : a.value);
      }, a.cls || ''))) : null);
    const overlay = h('div', { class: 'ad-overlay', onmousedown: (e) => { if (e.target === overlay) close(null); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    setTimeout(() => { (box.querySelector('[autofocus]') || box.querySelector('input,textarea,select,button.ad-btn--primary') || box).focus?.(); onOpen?.(box, close); }, 20);
  });
}

export async function confirmDialog(message, { title = 'Confirmar', ok = 'Confirmar', danger = false } = {}) {
  const r = await modal({ title, body: h('p', {}, message), actions: [{ label: 'Cancelar', value: false }, { label: ok, value: true, cls: danger ? 'ad-btn--danger' : 'ad-btn--primary' }] });
  return r === true;
}

export async function promptDialog(title, { label = '', value = '', placeholder = '', ok = 'OK', multiline = false } = {}) {
  const input = multiline ? h('textarea', { rows: 3, placeholder, autofocus: true }, value) : h('input', { type: 'text', value, placeholder, autofocus: true });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) e.target.closest('.ad-modal').querySelector('.ad-btn--primary')?.click(); });
  const r = await modal({ title, body: h('label', { class: 'ad-field' }, h('span', {}, label), input), actions: [{ label: 'Cancelar', value: null }, { label: ok, value: () => input.value, cls: 'ad-btn--primary' }] });
  return r;
}

export function errorMsg(e) {
  return e?.message || 'Ocorreu um erro.';
}

export function emptyState(text, action) {
  return h('div', { class: 'ad-empty' }, h('p', {}, text), action || null);
}

export function spinner(text = 'A carregar…') {
  return h('div', { class: 'ad-loading' }, h('span', { class: 'rr-spinner' }), text);
}

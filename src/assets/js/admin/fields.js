// Gerador de formulários do inspetor a partir das definições de campos (sections.js).
import { h, getPath, uid } from '../dom.js';
import { safeUrl } from '../sanitize-client.js';
import { iconBtn, btn, promptDialog } from './ui.js';
import { openMediaPicker } from './media.js';

/**
 * fields: definições; getTarget(): objeto atual a editar; commit(path, value, opts): grava a alteração.
 * opts.linkOptions: lista de [label, url] para sugestões de links; opts.rerender(): redesenha o inspetor.
 */
export function renderFields(fields, getTarget, commit, opts = {}) {
  const wrap = h('div', { class: 'ad-fields' });
  for (const f of fields) {
    if (f.type === 'heading') { wrap.append(h('h4', { class: 'ad-fields__heading' }, f.label)); continue; }
    if (f.type === 'note') { wrap.append(h('p', { class: 'ad-note' }, f.label)); continue; }
    const path = opts.prefix ? `${opts.prefix}.${f.key}` : f.key;
    wrap.append(field(f, path, getTarget, commit, opts));
  }
  return wrap;
}

function labelEl(f, id) {
  return h('label', { class: 'ad-field__label', for: id }, f.label);
}

function field(f, path, getTarget, commit, opts) {
  const id = uid('f');
  const value = getPath(getTarget(), path);
  const row = h('div', { class: `ad-field ad-field--${f.type}` });
  const set = (v, o = {}) => commit(path, v, { coalesce: path, ...o });

  switch (f.type) {
    case 'text': {
      const input = h('input', { id, type: 'text', value: value ?? '', maxlength: 500 });
      input.addEventListener('input', () => set(input.value));
      row.append(labelEl(f, id), input);
      break;
    }
    case 'textarea': {
      const ta = h('textarea', { id, rows: 3, maxlength: 5000 }, value ?? '');
      ta.addEventListener('input', () => set(ta.value));
      row.append(labelEl(f, id), ta);
      break;
    }
    case 'number': {
      const input = h('input', { id, type: 'number', value: value ?? '', min: f.min, max: f.max });
      input.addEventListener('input', () => set(input.value === '' ? '' : Number(input.value)));
      row.append(labelEl(f, id), input);
      break;
    }
    case 'range': {
      const out = h('output', { class: 'ad-range__val' }, value === undefined || value === '' ? 'auto' : String(value));
      const input = h('input', { id, type: 'range', min: f.min, max: f.max, value: value === undefined || value === '' ? f.min : value });
      input.addEventListener('input', () => { out.textContent = input.value; set(Number(input.value)); });
      const reset = iconBtn('↺', 'Repor valor por omissão', () => { set(undefined, { coalesce: null }); out.textContent = 'auto'; });
      row.append(h('div', { class: 'ad-field__top' }, labelEl(f, id), out, reset), input);
      break;
    }
    case 'toggle': {
      const input = h('input', { id, type: 'checkbox', class: 'ad-switch', checked: value !== false && value !== undefined && value !== '' ? true : null });
      if (value === undefined && f.defaultOn) input.checked = true;
      input.addEventListener('change', () => set(input.checked, { coalesce: null }));
      row.append(h('label', { class: 'ad-toggle', for: id }, input, h('span', {}, f.label)));
      break;
    }
    case 'select': {
      const sel = h('select', { id }, f.options.map(([v, l]) => h('option', { value: String(v), selected: String(value ?? '') === String(v) ? true : null }, l)));
      sel.addEventListener('change', () => {
        const opt = f.options.find(([v]) => String(v) === sel.value);
        set(opt ? opt[0] : sel.value, { coalesce: null });
        if (f.rerender) opts.rerender?.();
      });
      row.append(labelEl(f, id), sel);
      break;
    }
    case 'color': {
      const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : (/^#[0-9a-f]{3}$/i.test(value || '') ? `#${value.slice(1).split('').map((c) => c + c).join('')}` : '#000000');
      const picker = h('input', { type: 'color', value: hex, 'aria-label': f.label });
      const text = h('input', { id, type: 'text', value: value ?? '', placeholder: 'por omissão', maxlength: 40 });
      picker.addEventListener('input', () => { text.value = picker.value; set(picker.value); });
      text.addEventListener('change', () => {
        const v = text.value.trim();
        if (v && !/^#[0-9a-f]{3,8}$/i.test(v) && !/^rgba?\(/i.test(v) && v !== 'transparent') { text.classList.add('is-bad'); return; }
        text.classList.remove('is-bad');
        if (/^#[0-9a-f]{6}$/i.test(v)) picker.value = v;
        set(v, { coalesce: null });
      });
      const clear = iconBtn('↺', 'Usar cor por omissão', () => { text.value = ''; set('', { coalesce: null }); });
      row.append(labelEl(f, id), h('div', { class: 'ad-color' }, picker, text, clear));
      break;
    }
    case 'url': {
      const listId = uid('dl');
      const input = h('input', { id, type: 'text', value: value ?? '', list: listId, placeholder: '/pagina, https://… ou {{discordUrl}}', maxlength: 2000 });
      const dl = h('datalist', { id: listId }, (opts.linkOptions || []).map(([l, u]) => h('option', { value: u }, l)));
      const hint = h('small', { class: 'ad-hint' });
      const check = () => {
        const v = input.value.trim();
        const ok = !v || /^\{\{\w+\}\}$/.test(v) || !!safeUrl(v);
        hint.textContent = ok ? '' : 'Link inválido (usa /pagina, https://… ou mailto:)';
        input.classList.toggle('is-bad', !ok);
      };
      input.addEventListener('input', () => { check(); set(input.value.trim()); });
      check();
      row.append(labelEl(f, id), input, dl, hint);
      break;
    }
    case 'image': {
      const thumb = h('div', { class: 'ad-thumb' });
      const paint = (v) => {
        const u = safeUrl(v);
        thumb.replaceChildren(u ? h('img', { src: u, alt: '' }) : h('span', {}, 'Sem imagem'));
      };
      paint(value);
      const choose = btn('Escolher / carregar', async () => {
        const url = await openMediaPicker();
        if (url !== null && url !== undefined) { set(url, { coalesce: null }); paint(url); }
      }, 'ad-btn--sm');
      const byUrl = btn('URL', async () => {
        const url = await promptDialog('Imagem por URL', { label: 'Endereço da imagem (https://…)', value: value || '' });
        if (url !== null) { const u = safeUrl(url.trim()); set(u, { coalesce: null }); paint(u); }
      }, 'ad-btn--sm ad-btn--ghost');
      const remove = btn('Remover', () => { set('', { coalesce: null }); paint(''); }, 'ad-btn--sm ad-btn--ghost');
      row.append(h('span', { class: 'ad-field__label' }, f.label), thumb, h('div', { class: 'ad-row' }, choose, byUrl, remove));
      break;
    }
    case 'rich': {
      row.append(h('span', { class: 'ad-field__label' }, f.label), richEditor(value || '', (html) => set(html)));
      break;
    }
    case 'list': {
      row.append(listField(f, path, getTarget, commit, opts));
      break;
    }
    default:
      row.append(h('p', {}, `Campo desconhecido: ${f.type}`));
  }
  if (f.help) row.append(h('small', { class: 'ad-hint' }, f.help));
  return row;
}

function listField(f, path, getTarget, commit, opts) {
  const items = getPath(getTarget(), path) || [];
  const box = h('div', { class: 'ad-list' }, h('div', { class: 'ad-list__head' }, h('span', { class: 'ad-field__label' }, `${f.label} (${items.length})`)));
  const write = (next) => { commit(path, next, { coalesce: null }); opts.rerender?.(); };
  items.forEach((item, i) => {
    const title = String(item?.[f.itemLabel] || '').slice(0, 40) || `Item ${i + 1}`;
    const det = h('details', { class: 'ad-list__item', open: items.length <= 2 ? true : null },
      h('summary', {},
        h('span', { class: 'ad-list__title' }, title),
        h('span', { class: 'ad-list__tools' },
          iconBtn('↑', 'Subir', (e) => { e.preventDefault(); if (i === 0) return; const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; write(n); }),
          iconBtn('↓', 'Descer', (e) => { e.preventDefault(); if (i === items.length - 1) return; const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; write(n); }),
          iconBtn('⧉', 'Duplicar', (e) => { e.preventDefault(); if (f.max && items.length >= f.max) return; const n = [...items]; n.splice(i + 1, 0, structuredClone(item)); write(n); }),
          iconBtn('✕', 'Remover', (e) => { e.preventDefault(); write(items.filter((_, j) => j !== i)); }, 'ad-icon--danger'))),
      renderFields(f.fields, getTarget, commit, { ...opts, prefix: `${path}.${i}` }));
    box.append(det);
  });
  const add = btn(`+ Adicionar`, () => write([...items, structuredClone(f.newItem || {})]), 'ad-btn--sm ad-btn--ghost', { disabled: f.max && items.length >= f.max ? true : null });
  box.append(add);
  return box;
}

// Editor de texto rico simples (contenteditable). O HTML é sanitizado no servidor e no renderer.
export function richEditor(html, onChange) {
  const area = h('div', { class: 'ad-rich__area', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' });
  area.innerHTML = '';
  import('../sanitize-client.js').then(({ sanitizeHtml }) => { area.append(sanitizeHtml(html)); });
  const exec = (cmd, val = null) => { area.focus(); document.execCommand(cmd, false, val); onChange(area.innerHTML); };
  const tools = [
    ['B', 'Negrito', () => exec('bold')], ['I', 'Itálico', () => exec('italic')], ['U', 'Sublinhado', () => exec('underline')],
    ['H2', 'Título', () => exec('formatBlock', 'h2')], ['H3', 'Subtítulo', () => exec('formatBlock', 'h3')], ['¶', 'Parágrafo', () => exec('formatBlock', 'p')],
    ['•', 'Lista', () => exec('insertUnorderedList')], ['1.', 'Lista numerada', () => exec('insertOrderedList')], ['❝', 'Citação', () => exec('formatBlock', 'blockquote')],
    ['🔗', 'Link', async () => {
      const sel = getSelection();
      const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const url = await promptDialog('Inserir link', { label: 'Endereço (https://… ou /pagina)', placeholder: 'https://' });
      if (!url) return;
      const u = safeUrl(url.trim());
      if (!u) return;
      area.focus();
      if (range) { sel.removeAllRanges(); sel.addRange(range); }
      document.execCommand('createLink', false, u);
      onChange(area.innerHTML);
    }],
    ['⨯', 'Limpar formatação', () => { exec('removeFormat'); exec('unlink'); }],
  ];
  const bar = h('div', { class: 'ad-rich__bar' }, tools.map(([l, t, fn]) => h('button', { type: 'button', title: t, 'aria-label': t, onmousedown: (e) => e.preventDefault(), onclick: fn }, l)));
  area.addEventListener('input', () => onChange(area.innerHTML));
  area.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  return h('div', { class: 'ad-rich' }, bar, area);
}

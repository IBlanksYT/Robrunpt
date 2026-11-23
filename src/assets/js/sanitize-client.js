// Sanitizador de HTML no browser (defesa em profundidade; o servidor sanitiza sempre ao gravar).
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR']);
const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'TEXTAREA', 'SELECT']);

export function safeUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/[\u0000-\u001F\u007F\s"'<>\\`]/.test(s)) return '';
  if (s.startsWith('#') || (s.startsWith('/') && !s.startsWith('//'))) return s;
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(s)) return s;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html');
  const out = document.createDocumentFragment();
  function walk(src, dest) {
    for (const node of [...src.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) { dest.append(node.textContent); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (DROP_WITH_CONTENT.has(node.tagName)) continue;
      if (!ALLOWED.has(node.tagName)) { walk(node, dest); continue; }
      const el = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === 'A') {
        const href = safeUrl(node.getAttribute('href'));
        if (href) el.setAttribute('href', href);
        if (/^https?:/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer nofollow'); }
      }
      walk(node, el);
      dest.append(el);
    }
  }
  walk(doc.body, out);
  return out;
}

// Cliente da API com cookie de sessão (HttpOnly, gerido pelo browser) e token CSRF.
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

export function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)__Host-rr_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function api(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { ...headers } };
  if (method !== 'GET') {
    if (!csrfToken()) await fetch('/api/auth/me', { credentials: 'same-origin' }).catch(() => {});
    opts.headers['x-csrf-token'] = csrfToken();
  }
  if (body !== undefined) {
    if (raw) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch(`/api${path}`, opts); }
  catch { throw new ApiError('Sem ligação ao servidor. Verifica a tua ligação à internet.', 0); }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const fallback = res.status === 404 && !data ? 'A API não está disponível (as funções Netlify estão publicadas?).' : `Erro ${res.status}`;
    throw new ApiError(data?.error || fallback, res.status, data);
  }
  return data;
}

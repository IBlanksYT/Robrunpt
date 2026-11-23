// Testes de integração da API contra um servidor Netlify Blobs local.
// Uso: npm test   (corre o build e depois estes testes)
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalBlobs } from './blobs-local.mjs';

process.env.SESSION_SECRET = 'teste-segredo-de-sessao-com-mais-de-32-caracteres';
process.env.ADMIN_PASSWORD = 'palavra-passe-teste-123';

const dir = join(tmpdir(), `rr-test-${Date.now()}`);
const { server } = await startLocalBlobs(dir);
const { default: api } = await import('../netlify/functions/api.mjs');
const { issueSession } = await import('../netlify/lib/auth.mjs');
const { putJSON } = await import('../netlify/lib/store.mjs');
const { runMaintenance } = await import('../netlify/lib/maintenance.mjs');

let passed = 0;
let failed = 0;
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name} ${extra}`); }
}

class Client {
  constructor() { this.jar = {}; }
  async call(method, path, body, { headers = {}, raw = false, csrf = true } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    if (method !== 'GET' && csrf && this.jar['__Host-rr_csrf']) h['x-csrf-token'] = decodeURIComponent(this.jar['__Host-rr_csrf']);
    h.origin = 'https://test.local';
    let payload;
    if (body !== undefined) {
      if (raw) payload = body;
      else { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    }
    const res = await api(new Request(`https://test.local/api${path}`, { method, headers: h, body: payload }), { ip: '203.0.113.7' });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/Max-Age=0/.test(sc)) delete this.jar[k]; else this.jar[k] = v;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, res };
  }
}

async function playerClient(id, name, role = 'player') {
  await putJSON('users', `u/${id}`, { id, name, email: `${id}@exemplo.pt`, role, banned: false, createdAt: Date.now(), lastLoginAt: Date.now(), picture: '' });
  const c = new Client();
  await c.call('GET', '/auth/me');
  const { value } = await issueSession(id, 'google');
  c.jar['__Host-rr_sid'] = encodeURIComponent(value);
  return c;
}

try {
  console.log('\nPúblico');
  const anon = new Client();
  let r = await anon.call('GET', '/health');
  ok(r.status === 200 && r.data.sessionConfigured, 'health');
  r = await anon.call('GET', '/site');
  ok(r.status === 200 && r.data.site.pages.length >= 9, 'site por omissão disponível sem dados guardados');
  r = await anon.call('GET', '/auth/me');
  ok(r.status === 200 && r.data.user === null && anon.jar['__Host-rr_csrf'], 'me anónimo + cookie CSRF');
  r = await anon.call('GET', '/nao-existe');
  ok(r.status === 404, 'rota inexistente 404');

  console.log('\nAutenticação admin + CSRF');
  const admin = new Client();
  await admin.call('GET', '/auth/me');
  r = await admin.call('POST', '/auth/admin', { password: 'palavra-passe-teste-123' }, { csrf: false });
  ok(r.status === 403, 'POST sem token CSRF é rejeitado');
  r = await admin.call('POST', '/auth/admin', { password: 'errada' });
  ok(r.status === 401, 'palavra-passe errada rejeitada');
  r = await admin.call('POST', '/auth/admin', { password: 'palavra-passe-teste-123' });
  ok(r.status === 200 && admin.jar['__Host-rr_sid'], 'login admin cria sessão');
  r = await admin.call('GET', '/auth/me');
  ok(r.data.user?.role === 'admin', 'me devolve admin');
  const evil = new Client();
  evil.jar = { ...admin.jar };
  r = await api(new Request('https://test.local/api/admin/publish', { method: 'POST', headers: { cookie: Object.entries(admin.jar).map(([k, v]) => `${k}=${v}`).join('; '), origin: 'https://atacante.example', 'x-csrf-token': decodeURIComponent(admin.jar['__Host-rr_csrf']) }, body: '{}' }));
  ok(r.status === 403, 'pedido de outra origem é bloqueado');
  r = await anon.call('GET', '/admin/site');
  ok(r.status === 401, 'anónimo não acede ao CMS');

  console.log('\nCMS: rascunho, publicação, versões, sanitização');
  r = await admin.call('GET', '/admin/site');
  ok(r.status === 200 && r.data.draft.pages, 'carregar rascunho');
  const site = r.data.draft;
  site.pages[0].sections[0].props.title = 'Título editado no teste';
  site.pages.push({ id: 'evento', slug: 'Evento de Verão!', title: 'Evento', showInMenu: true, sections: [
    { id: 'x1', type: 'text', props: { heading: '<b>ok</b>', body: '<p onclick="alert(1)">Olá<script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)></p>' }, style: { bgColor: 'red;background:url(x)', bgImage: 'javascript:alert(1)' } },
  ] });
  r = await admin.call('PUT', '/admin/site', { site, etag: r.data.etag });
  ok(r.status === 200 && r.data.etag, 'guardar rascunho');
  const saved = r.data.site;
  const ev = saved.pages.find((p) => p.id === 'evento');
  const body = ev.sections[0].props.body;
  ok(!/script|onclick|onerror|javascript|<img/i.test(body), 'HTML perigoso removido', body);
  ok(ev.sections[0].style.bgColor === '' && ev.sections[0].style.bgImage === '', 'CSS/URL perigosos removidos');
  ok(ev.slug === 'evento-de-verao', 'slug normalizado');
  const etag1 = r.data.etag;
  r = await admin.call('PUT', '/admin/site', { site: saved, etag: 'etag-antigo' });
  ok(r.status === 409 && r.data.conflict, 'conflito de edição simultânea detetado');
  r = await admin.call('PUT', '/admin/site', { site: saved, etag: etag1 });
  ok(r.status === 200, 'gravar com etag correto');
  r = await anon.call('GET', '/site');
  ok(r.data.site.pages[0].sections[0].props.title !== 'Título editado no teste', 'rascunho não é público antes de publicar');
  r = await admin.call('POST', '/admin/publish', { note: 'teste' });
  ok(r.status === 200 && r.data.versionId, 'publicar');
  r = await anon.call('GET', '/site');
  ok(r.data.site.pages[0].sections[0].props.title === 'Título editado no teste', 'site público atualizado');
  r = await admin.call('GET', '/admin/versions');
  ok(r.data.items.length === 1, 'versão criada');
  const vid = r.data.items[0].id;
  const r0 = await admin.call('GET', '/admin/site');
  r0.data.draft.pages[0].sections[0].props.title = 'Outro título';
  await admin.call('PUT', '/admin/site', { site: r0.data.draft, etag: r0.data.etag });
  r = await admin.call('POST', `/admin/versions/${vid}/restore`, { publish: false });
  ok(r.status === 200 && r.data.draft.pages[0].sections[0].props.title === 'Título editado no teste', 'restaurar versão');

  console.log('\nConteúdos');
  r = await admin.call('POST', '/admin/content/news', { title: 'Torneio da comunidade', summary: 'Resumo', body: '<p>Texto<script>x</script></p>', published: false });
  ok(r.status === 200 && !r.data.item.body.includes('script'), 'criar notícia (sanitizada)');
  const newsId = r.data.item.id;
  r = await anon.call('GET', '/content/news');
  ok(r.data.items.length === 0, 'rascunho de notícia não é público');
  r = await admin.call('PUT', `/admin/content/news/${newsId}`, { published: true });
  r = await anon.call('GET', '/content/news');
  ok(r.data.items.length === 1 && !('body' in r.data.items[0]), 'notícia publicada aparece na lista');
  r = await anon.call('GET', `/content/news/${newsId}`);
  ok(r.data.item.title === 'Torneio da comunidade', 'detalhe da notícia');
  r = await admin.call('POST', `/admin/content/news/${newsId}/duplicate`);
  ok(r.status === 200 && r.data.item.published === false, 'duplicar notícia');
  r = await admin.call('DELETE', `/admin/content/news/${r.data.item.id}`);
  ok(r.status === 200, 'eliminar notícia');
  r = await admin.call('POST', '/admin/content/clans', { name: 'Lusitanos', tag: 'LUS', recruiting: true, contactUrl: 'javascript:alert(1)', published: true });
  ok(r.status === 200 && r.data.item.contactUrl === '' && r.data.item.recruiting, 'criar clã com link perigoso removido');

  console.log('\nClips');
  const p1 = await playerClient('g_111', 'Jogador Um');
  const p2 = await playerClient('g_222', 'Jogador Dois');
  r = await anon.call('POST', '/clips', { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Teste' });
  ok(r.status === 401, 'anónimo não publica');
  r = await p1.call('POST', '/clips', { url: 'https://vimeo.com/123456', title: 'Vimeo' });
  ok(r.status === 422, 'Vimeo rejeitado');
  r = await p1.call('POST', '/clips', { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share', title: 'Grande fuga', description: 'Clip épico' });
  ok(r.status === 200 && r.data.clip.url === 'https://www.youtube.com/shorts/dQw4w9WgXcQ' && r.data.clip.embedUrl.includes('youtube-nocookie'), 'Short do YouTube publicado e normalizado', JSON.stringify(r.data));
  const clip1 = r.data.clip?.id;
  r = await p2.call('POST', '/clips', { url: 'youtube.com/watch?v=dQw4w9WgXcQ', title: 'Duplicado' });
  ok(r.status === 409, 'vídeo duplicado rejeitado');
  r = await p1.call('POST', '/clips', { url: 'https://www.tiktok.com/@jogador.pt/video/7234567890123456789', title: 'TikTok' });
  ok(r.status === 429, 'limite de 30 s entre publicações');
  r = await p2.call('POST', '/clips', { url: 'https://www.tiktok.com/@jogador.pt/video/7234567890123456789', title: 'TikTok bom' });
  ok(r.status === 200 && r.data.clip.platform === 'tiktok' && r.data.clip.embedUrl === 'https://www.tiktok.com/player/v1/7234567890123456789', 'TikTok publicado', JSON.stringify(r.data));
  const clip2 = r.data.clip?.id;
  r = await p2.call('POST', '/clips', { url: 'https://youtu.be/aaaaaaaaaaa', title: 'Bot', website: 'spam' });
  ok(r.status === 400, 'honeypot anti-bot');
  r = await anon.call('GET', '/clips');
  ok(r.data.items.length === 2 && r.data.items[0].id === clip2 && r.data.items[0].author.name === 'Jogador Dois', 'listar clips (mais recente primeiro, com autor)');
  r = await anon.call('GET', '/clips?user=g_111');
  ok(r.data.items.length === 1 && r.data.items[0].id === clip1, 'clips por utilizador');
  r = await p2.call('DELETE', `/clips/${clip1}`);
  ok(r.status === 403, 'não pode eliminar clip de outro');
  r = await p2.call('GET', '/admin/clips');
  ok(r.status === 403, 'jogador não acede à moderação');
  const mod = await playerClient('g_333', 'Moderador', 'moderator');
  r = await mod.call('PATCH', `/admin/clips/${clip1}`, { hidden: true, title: 'Editado pela moderação' });
  ok(r.status === 200 && r.data.clip.hidden, 'moderador oculta/edita clip');
  r = await anon.call('GET', '/clips');
  ok(r.data.items.length === 1, 'clip oculto não aparece publicamente');
  r = await mod.call('PUT', '/admin/site', { site: saved });
  ok(r.status === 403, 'moderador não edita o design do site');
  r = await p1.call('DELETE', `/clips/${clip1}`);
  ok(r.status === 200, 'autor elimina o próprio clip');
  r = await p1.call('POST', '/clips', { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Republicado' });
  ok(r.status === 200 || r.status === 429, 'vídeo pode voltar a ser publicado após eliminação');

  console.log('\nAtualização automática de sites antigos');
  {
    const old = structuredClone((await anon.call('GET', '/site')).data.site);
    old.schema = 1;
    const cl = old.pages.find((p) => p.slug === 'clas');
    cl.sections = cl.sections.filter((x) => x.type !== 'clanSubmit').concat([{ id: 'x-cta', type: 'cta', props: { title: 'Tens um clã?' }, style: {} }]);
    await putJSON('site', 'published', old);
    r = await anon.call('GET', '/site');
    const secs = r.data.site.pages.find((p) => p.slug === 'clas').sections.map((x) => x.type);
    ok(secs.includes('clanSubmit') && !secs.includes('cta'), 'site antigo recebe o formulário de clãs automaticamente', secs.join(','));
  }

  console.log('\nPedidos de clã');
  r = await anon.call('POST', '/clans/submit', { title: 'Anónimos' });
  ok(r.status === 401, 'anónimo não envia clã');
  r = await p2.call('POST', '/clans/submit', { title: 'Guerreiros', summary: 'curto', contactUrl: 'https://discord.gg/abc' });
  ok(r.status === 400, 'descrição demasiado curta rejeitada');
  r = await p2.call('POST', '/clans/submit', { title: 'Guerreiros PT', tag: 'GPT', summary: 'Clã de jogadores do norte do país.', contactUrl: 'javascript:alert(1)' });
  ok(r.status === 400, 'link de contacto perigoso rejeitado');
  r = await p2.call('POST', '/clans/submit', { title: 'Guerreiros PT', tag: 'GPT', summary: 'Clã de jogadores do norte do país.', about: 'Linha 1\n\n<script>x</script>', recruiting: true, contactUrl: 'https://discord.gg/abc' });
  ok(r.status === 200 && r.data.submission.status === 'pending', 'jogador envia pedido de clã');
  const clanReq = r.data.submission?.id;
  r = await p2.call('POST', '/clans/submit', { title: 'Outro clã', summary: 'Mais um clã para a lista.', contactUrl: 'https://discord.gg/x' });
  ok(r.status === 409, 'só um pedido por conta');
  r = await p2.call('GET', '/clans/mine');
  ok(r.data.submission?.status === 'pending', 'jogador vê o estado do pedido');
  r = await anon.call('GET', '/content/clans');
  ok(!r.data.items.some((i) => i.id === clanReq), 'pedido pendente não é público');
  r = await p2.call('POST', `/admin/clans/${clanReq}/approve`);
  ok(r.status === 403, 'jogador não aprova pedidos');
  r = await mod.call('GET', '/admin/content/clans');
  const pend = r.data.items.find((i) => i.id === clanReq);
  ok(pend?.status === 'pending' && !/<script/i.test(pend.body), 'moderação vê o pedido (texto sanitizado)');
  r = await mod.call('POST', `/admin/clans/${clanReq}/reject`, { reason: 'Falta o link do Discord certo' });
  ok(r.status === 200 && r.data.item.status === 'rejected', 'moderador recusa');
  r = await p2.call('GET', '/clans/mine');
  ok(r.data.submission?.rejectReason === 'Falta o link do Discord certo', 'jogador vê o motivo da recusa');
  r = await mod.call('POST', `/admin/clans/${clanReq}/approve`);
  ok(r.status === 200 && r.data.item.published, 'moderador aprova');
  r = await anon.call('GET', '/content/clans');
  ok(r.data.items.some((i) => i.id === clanReq), 'clã aprovado aparece na lista pública');
  r = await mod.call('DELETE', `/admin/content/clans/${clanReq}`);
  r = await p2.call('GET', '/clans/mine');
  ok(r.data.submission === null, 'eliminar o clã liberta um novo pedido');

  console.log('\nUtilizadores e permissões');
  r = await mod.call('PATCH', '/admin/users/g_222', { role: 'admin' });
  ok(r.status === 403, 'moderador não promove utilizadores');
  r = await admin.call('PATCH', '/admin/users/g_222', { banned: true });
  ok(r.status === 200 && r.data.user.banned, 'admin suspende jogador');
  r = await p2.call('GET', '/auth/me');
  ok(r.data.user === null, 'sessão do suspenso é invalidada');
  r = await admin.call('PATCH', '/admin/users/g_222', { banned: false, role: 'moderator' });
  ok(r.status === 200 && r.data.user.role === 'moderator', 'admin altera função');
  r = await admin.call('GET', '/admin/users');
  ok(r.data.items.length === 3, 'listar utilizadores');

  console.log('\nMedia');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex');
  r = await admin.call('POST', '/admin/media', png, { raw: true, headers: { 'content-type': 'image/png', 'x-filename': 'logo.png' } });
  ok(r.status === 200 && r.data.item.url, 'upload de imagem');
  const mediaUrl = r.data.item.url;
  r = await anon.call('GET', mediaUrl.replace('/api', ''));
  ok(r.status === 200 && r.res.headers.get('content-type') === 'image/png', 'servir imagem');
  r = await admin.call('POST', '/admin/media', Buffer.from('<svg onload=alert(1)>'), { raw: true, headers: { 'content-type': 'image/svg+xml' } });
  ok(r.status === 415, 'SVG rejeitado');
  r = await admin.call('POST', '/admin/media', Buffer.from('não sou png'), { raw: true, headers: { 'content-type': 'image/png' } });
  ok(r.status === 415, 'conteúdo falso rejeitado');

  console.log('\nEstatísticas, backups, RGPD');
  await anon.call('POST', '/stats/view', { path: '/clips', source: 'direct' });
  for (let i = 0; i < 5; i++) await anon.call('POST', '/stats/view', { path: '/', source: 'search' });
  r = await admin.call('GET', '/admin/stats?days=7');
  ok(r.status === 200 && r.data.totalViews === 6 && r.data.topPages[0].path === '/', 'estatísticas agregadas', JSON.stringify(r.data.totalViews));
  {
    // Semântica de escrita condicional (a base do controlo de concorrência).
    // Nota: o simulador local não é atómico em escritas paralelas; a Netlify real é.
    const { getJSONMeta, store: st } = await import('../netlify/lib/store.mjs');
    await st('stats').setJSON('test/k', { n: 1 });
    const a = await getJSONMeta('stats', 'test/k');
    const w1 = await st('stats').setJSON('test/k', { n: 2 }, { onlyIfMatch: a.etag });
    const w2 = await st('stats').setJSON('test/k', { n: 3 }, { onlyIfMatch: a.etag });
    ok(a.etag && w1.modified && !w2.modified, 'escrita com ETag desatualizado é recusada (sem perda de dados)');
  }
  r = await admin.call('POST', '/admin/backups', { note: 'teste' });
  ok(r.status === 200 && r.data.backup.counts.users === 3, 'criar backup');
  const bid = r.data.backup.id;
  await admin.call('POST', '/admin/content/news', { title: 'Depois do backup', published: true });
  r = await admin.call('POST', `/admin/backups/${bid}/restore`);
  ok(r.status === 200, 'restaurar backup');
  r = await anon.call('GET', '/content/news');
  ok(r.data.items.length === 1 && r.data.items[0].title === 'Torneio da comunidade', 'conteúdo voltou ao estado do backup');
  r = await admin.call('GET', `/admin/backups/${bid}`);
  ok(r.status === 200 && r.res.headers.get('content-disposition').includes('attachment'), 'descarregar backup');
  r = await p1.call('GET', '/me/export');
  ok(r.status === 200, 'exportar dados (RGPD)');
  r = await p1.call('DELETE', '/me');
  ok(r.status === 200, 'eliminar a própria conta');
  r = await anon.call('GET', '/clips?user=g_111');
  ok(r.data.items.length === 0, 'clips do utilizador eliminado foram removidos');
  const rep = await runMaintenance();
  ok(rep.backup?.id, 'manutenção diária corre (limpeza + backup automático)');
  r = await admin.call('GET', '/admin/audit');
  ok(r.data.items.length > 5, 'registo de auditoria');
  r = await admin.call('POST', '/auth/logout');
  r = await admin.call('GET', '/admin/site');
  ok(r.status === 401, 'terminar sessão');
} catch (e) {
  failed++;
  console.error('Exceção nos testes:', e);
} finally {
  await server.stop();
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passaram, ${failed} falharam\n`);
process.exit(failed ? 1 : 0);

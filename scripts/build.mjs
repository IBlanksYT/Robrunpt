// Build: copia src/ -> public/, gera configuração para as funções, fontes locais e validações.
// Não precisa de .env nem de segredos.
import { cp, rm, mkdir, readFile, writeFile, readdir, copyFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'public');
const log = (...a) => console.log('[build]', ...a);

function fail(msg) {
  console.error(`\n[build] ERRO: ${msg}\n`);
  process.exit(1);
}

// 1) Ler e validar config.json (público)
let config;
try { config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')); }
catch (e) { fail(`config.json inválido: ${e.message}`); }

const forbidden = [];
(function scan(o, path) {
  for (const [k, v] of Object.entries(o || {})) {
    if (/secret|password|passwd|token|private|apikey|api_key/i.test(k)) forbidden.push(path + k);
    if (v && typeof v === 'object') scan(v, `${path}${k}.`);
    if (typeof v === 'string' && /GOCSPX-|-----BEGIN/.test(v)) forbidden.push(path + k);
  }
})(config, '');
if (forbidden.length) fail(`config.json é público e não pode conter segredos (${forbidden.join(', ')}). Coloca-os nas variáveis de ambiente do Netlify.`);
if (config.googleClientId && !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(config.googleClientId)) {
  fail('googleClientId não parece válido (formato esperado: 1234-abc.apps.googleusercontent.com).');
}

// 2) Site por omissão, completado com os valores do config.json
const defaultSite = JSON.parse(await readFile(join(root, 'schema', 'site.default.json'), 'utf8'));
const c = config.community || {};
const l = config.links || {};
const v = config.visual || {};
Object.assign(defaultSite.settings, {
  siteName: c.name || defaultSite.settings.siteName,
  tagline: c.tagline || defaultSite.settings.tagline,
  description: c.description || defaultSite.settings.description,
  contactEmail: c.contactEmail || '',
  discordUrl: l.discord || '',
  social: { tiktok: l.tiktok || '', youtube: l.youtube || '', instagram: l.instagram || '', x: l.x || '', twitch: l.twitch || '' },
});
if (c.disclaimer) defaultSite.footer.disclaimer = c.disclaimer;
const col = defaultSite.theme.colors;
if (v.primary) col.primary = v.primary;
if (v.secondary) col.secondary = v.secondary;
if (v.background) col.bg = v.background;
if (v.headingFont) defaultSite.theme.fonts.heading = v.headingFont;
if (v.bodyFont) defaultSite.theme.fonts.body = v.bodyFont;

// 3) Copiar ficheiros estáticos
await rm(out, { recursive: true, force: true });
await cp(src, out, { recursive: true });
const publicConfig = { ...config };
delete publicConfig._aviso;
await writeFile(join(out, 'config.json'), JSON.stringify(publicConfig, null, 2));
await writeFile(join(out, 'assets', 'site.default.json'), JSON.stringify(defaultSite));
await copyFile(join(root, 'netlify', 'lib', 'video.mjs'), join(out, 'assets', 'js', 'video.js'));
log('ficheiros estáticos copiados para public/');

// 4) Configuração embebida nas funções
const gen = `// GERADO AUTOMATICAMENTE por scripts/build.mjs — não editar. Edita config.json e schema/site.default.json.
export const siteConfig = ${JSON.stringify(publicConfig, null, 2)};
export const defaultSite = ${JSON.stringify(defaultSite)};
`;
await writeFile(join(root, 'netlify', 'lib', 'generated-config.mjs'), gen);
log('netlify/lib/generated-config.mjs gerado');

// 5) Fontes locais (sem pedidos a servidores externos — melhor para o RGPD)
const FONTS = {
  Rajdhani: 'rajdhani', Inter: 'inter', 'Russo One': 'russo-one', Orbitron: 'orbitron', Oxanium: 'oxanium',
  'Chakra Petch': 'chakra-petch', 'Bebas Neue': 'bebas-neue', 'Exo 2': 'exo-2', Teko: 'teko',
  Poppins: 'poppins', Montserrat: 'montserrat', 'Barlow Condensed': 'barlow-condensed',
};
const fontDir = join(out, 'assets', 'fonts');
await mkdir(fontDir, { recursive: true });
let css = '/* Fontes servidas localmente (gerado no build) */\n';
let fontCount = 0;
for (const [family, pkg] of Object.entries(FONTS)) {
  const dir = join(root, 'node_modules', '@fontsource', pkg, 'files');
  if (!existsSync(dir)) { log(`aviso: fonte ${family} não instalada`); continue; }
  const files = await readdir(dir);
  for (const weight of [400, 500, 600, 700]) {
    for (const subset of ['latin', 'latin-ext']) {
      const f = `${pkg}-${subset}-${weight}-normal.woff2`;
      if (!files.includes(f)) continue;
      await copyFile(join(dir, f), join(fontDir, f));
      const range = subset === 'latin'
        ? 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
        : 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
      css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./${f}') format('woff2');unicode-range:${range};}\n`;
      fontCount++;
    }
  }
}
await writeFile(join(fontDir, 'fonts.css'), css);
log(`${fontCount} ficheiros de fonte copiados`);

// 6) Validações
async function walkFiles(dir) {
  const res = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) res.push(...(await walkFiles(p)));
    else res.push(p);
  }
  return res;
}
const all = await walkFiles(out);
for (const f of all.filter((x) => x.endsWith('.js') || x.endsWith('.mjs'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { fail(`erro de sintaxe em ${f}:\n${e.stderr}`); }
}
for (const f of [...all.filter((x) => x.endsWith('.js')), ...all.filter((x) => x.endsWith('.html'))]) {
  const text = await readFile(f, 'utf8');
  if (/ADMIN_PASSWORD\s*=|SESSION_SECRET\s*=|GOCSPX-/.test(text)) fail(`possível segredo exposto em ${f}`);
}
for (const f of [...(await walkFiles(join(root, 'netlify'))).filter((x) => x.endsWith('.mjs'))]) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { fail(`erro de sintaxe em ${f}:\n${e.stderr}`); }
}
const htmlPages = all.filter((x) => x.endsWith('.html')).length;
const size = (await Promise.all(all.map((f) => stat(f)))).reduce((a, s) => a + s.size, 0);
log(`OK — ${all.length} ficheiros (${htmlPages} páginas HTML, ${(size / 1024 / 1024).toFixed(2)} MB) em public/`);
if (!config.googleClientId) log('nota: googleClientId vazio em config.json — o login Google ficará desativado até o preencheres.');

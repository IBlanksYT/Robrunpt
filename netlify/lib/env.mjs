// Configuração: o config.json público é embebido no build; os segredos vêm SÓ do ambiente Netlify.
import { siteConfig, defaultSite } from './generated-config.mjs';
import { HttpError } from './http.mjs';

export { siteConfig, defaultSite };

export function sessionSecret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) {
    throw new HttpError(503, 'O servidor ainda não está configurado: falta a variável SESSION_SECRET no Netlify (mínimo 32 caracteres).');
  }
  return s;
}

export function adminPassword() {
  return process.env.ADMIN_PASSWORD || '';
}

export function googleClientId() {
  return (process.env.GOOGLE_CLIENT_ID || siteConfig.googleClientId || '').trim();
}

export function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function privacyConfig() {
  const p = siteConfig.privacy || {};
  return {
    sessionDays: clampInt(p.sessionDays, 1, 90, 30),
    inactiveAccountMonths: clampInt(p.inactiveAccountMonths, 0, 120, 24),
    autoBackupsToKeep: clampInt(p.autoBackupsToKeep, 1, 90, 14),
    versionsToKeep: clampInt(p.versionsToKeep, 10, 500, 100),
  };
}

function clampInt(v, min, max, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

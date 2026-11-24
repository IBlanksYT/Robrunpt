// Tarefas diárias: retenção de dados (RGPD), limpeza e backup automático.
import { listKeys, getMany, del } from './store.mjs';
import { privacyConfig } from './env.mjs';
import { createBackup, pruneAutoBackups } from './backups.mjs';
import { pruneVersions } from './site.mjs';
import { pruneStats } from './stats.mjs';
import { listUsers, deleteUserRecord } from './users.mjs';
import { deleteClipsOfUser } from './clips.mjs';
import { audit } from './audit.mjs';

export async function runMaintenance() {
  const now = Date.now();
  const report = {};

  // Sessões expiradas
  const sKeys = await listKeys('sessions', 's/');
  const sessions = await getMany('sessions', sKeys);
  let expired = 0;
  for (let i = 0; i < sKeys.length; i++) {
    if (!sessions[i] || sessions[i].expiresAt < now) { await del('sessions', sKeys[i]); expired++; }
  }
  report.expiredSessions = expired;

  // Registos de limitação de pedidos (contêm apenas pseudónimos temporários)
  const rKeys = await listKeys('ratelimit', '');
  const rl = await getMany('ratelimit', rKeys);
  let rlDeleted = 0;
  for (let i = 0; i < rKeys.length; i++) {
    if (!rl[i] || rl[i].reset < now) { await del('ratelimit', rKeys[i]); rlDeleted++; }
  }
  report.rateLimitEntries = rlDeleted;

  // Contas inativas (política de retenção)
  const months = privacyConfig().inactiveAccountMonths;
  report.inactiveAccountsRemoved = 0;
  if (months > 0) {
    const cutoff = now - months * 30 * 86400e3;
    for (const u of await listUsers()) {
      if (u.role === 'player' && (u.lastLoginAt || u.createdAt || now) < cutoff) {
        await deleteClipsOfUser(u.id);
        await deleteUserRecord(u.id);
        report.inactiveAccountsRemoved++;
      }
    }
  }

  // Auditoria com mais de 180 dias
  const aKeys = await listKeys('audit', 'a/');
  const audits = await getMany('audit', aKeys.slice(-500));
  let aDel = 0;
  for (let i = 0; i < audits.length; i++) {
    if (audits[i] && audits[i].at < now - 180 * 86400e3) { await del('audit', aKeys.slice(-500)[i]); aDel++; }
  }
  report.auditPruned = aDel;

  report.versionsPruned = await pruneVersions();
  report.statsPruned = await pruneStats();
  report.backup = await createBackup(null, 'automático', 'Backup diário automático');
  await pruneAutoBackups();
  await audit(null, 'manutenção diária', '', report);
  return report;
}

import { putJSON, newestFirstId, listKeys, getMany } from './store.mjs';

export async function audit(actor, action, target = '', details = {}) {
  try {
    await putJSON('audit', `a/${newestFirstId()}`, {
      at: Date.now(),
      actorId: actor?.id || 'sistema',
      actorName: actor?.name || 'Sistema',
      action,
      target: String(target).slice(0, 200),
      details,
    });
  } catch (e) {
    console.error('audit falhou', e);
  }
}

export async function listAudit(limit = 200) {
  const keys = (await listKeys('audit', 'a/')).slice(0, limit);
  return (await getMany('audit', keys)).filter(Boolean);
}

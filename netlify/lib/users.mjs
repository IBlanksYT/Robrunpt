import { getJSON, updateJSON, listKeys, getMany, del, isSafeId } from './store.mjs';
import { adminEmails } from './env.mjs';

export async function getUser(id) {
  if (!isSafeId(id)) return null;
  return getJSON('users', `u/${id}`);
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, picture: u.picture || '', createdAt: u.createdAt || null };
}

export function selfUser(u) {
  if (!u) return null;
  return { ...publicUser(u), email: u.email || '', role: u.role, virtual: !!u.virtual };
}

/** Cria ou atualiza o utilizador a partir do payload Google JÁ VERIFICADO no servidor. */
export async function upsertGoogleUser(payload) {
  const id = `g_${payload.sub}`;
  const email = String(payload.email || '').toLowerCase();
  const isBootstrapAdmin = payload.email_verified && adminEmails().includes(email);
  const now = Date.now();
  return updateJSON('users', `u/${id}`, (cur) => {
    const base = cur || { id, role: 'player', banned: false, createdAt: now };
    return {
      ...base,
      name: String(payload.name || payload.given_name || 'Jogador').slice(0, 80),
      picture: /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(payload.picture || '') ? payload.picture : '',
      email,
      role: isBootstrapAdmin ? 'admin' : base.role,
      lastLoginAt: now,
    };
  });
}

export async function listUsers() {
  const keys = await listKeys('users', 'u/');
  return (await getMany('users', keys)).filter(Boolean);
}

export async function updateUser(id, fn) {
  return updateJSON('users', `u/${id}`, (cur) => (cur ? fn(cur) : undefined));
}

export async function deleteUserRecord(id) {
  await del('users', `u/${id}`);
}

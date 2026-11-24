// Verificação do ID token Google NO SERVIDOR (assinatura, emissor, audiência e expiração).
import { OAuth2Client } from 'google-auth-library';
import { HttpError } from './http.mjs';
import { googleClientId } from './env.mjs';

const client = new OAuth2Client();

export async function verifyGoogleCredential(credential) {
  const clientId = googleClientId();
  if (!clientId) throw new HttpError(503, 'O login Google ainda não está configurado (googleClientId em config.json).');
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 5000) {
    throw new HttpError(400, 'Credencial Google inválida.');
  }
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Não foi possível validar a conta Google.');
  }
  if (!payload?.sub || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
    throw new HttpError(401, 'Token Google inválido.');
  }
  if (!payload.email_verified) throw new HttpError(401, 'O email da conta Google não está verificado.');
  return payload;
}

// Função agendada diária (Netlify Scheduled Functions): retenção RGPD, limpeza e backup automático.
import { runMaintenance } from '../lib/maintenance.mjs';

export default async () => {
  try {
    const report = await runMaintenance();
    console.log('Manutenção concluída', JSON.stringify(report));
    return new Response('ok');
  } catch (e) {
    console.error('Manutenção falhou', e);
    return new Response('erro', { status: 500 });
  }
};

export const config = { schedule: '@daily' };

// Emails to the people who run AYWO when something breaks. At most one email per kind of problem every 6 hours, so a
// broken thing does not flood the inbox. Without OPS_ALERT_EMAIL (or SendGrid) the alert only goes to the log.
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.ts';
import { asServer } from '../db.ts';
import { sendEmail } from './email.ts';

export async function opsAlert(log: FastifyBaseLogger | Console, key: string, title: string, body: string): Promise<void> {
  log.error({ alert: key }, `${title}: ${body}`);
  try {
    const claimed = await asServer(async (db) => (await db.query(`select ops_alert_claim($1) as ok`, [key])).rows[0].ok as boolean);
    if (!claimed || !config.OPS_ALERT_EMAIL) return;
    await sendEmail(config.OPS_ALERT_EMAIL, { title: `[AYWO alert] ${title}`, body }, `${config.WEB_URL}/admin/settings`, 'en');
  } catch (e) {
    // An alert that cannot be sent must never break the thing that raised it.
    log.error({ alert: key, err: (e as Error)?.message }, 'alert could not be sent');
  }
}

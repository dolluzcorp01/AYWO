// Keeping AYWO safe to run: the nightly database backup, and an hourly look for trouble that sends alert emails.
import type { FastifyBaseLogger } from 'fastify';
import type { Job } from '../jobs.ts';
import { backupKey, isProduction } from '../config.ts';
import { asServer } from '../db.ts';
import { opsAlert } from '../services/alerts.ts';
import { makeBackup } from '../services/backup.ts';

/** Backups run from 2 am India time, once a day. */
export const BACKUP_HOUR_IST = 2;
/** No good backup for this long means something is wrong even if no run reported a failure. */
export const STALE_HOURS = 36;
/** More server errors than this in an hour is worth an email. */
export const ERROR_SPIKE = 20;

export function istHour(now = new Date()): number {
  return new Date(now.getTime() + 330 * 60_000).getUTCHours();
}

/** Runs one backup and records it. Throws on failure, so the job runner counts it too. */
export async function backupNow(log: FastifyBaseLogger | Console): Promise<{ key: string; bytes: number }> {
  const id = await asServer(async (db) => (await db.query(`insert into backup_runs default values returning id`)).rows[0].id as number);
  try {
    const done = await makeBackup();
    await asServer((db) =>
      db.query(`update backup_runs set finished_at = now(), ok = true, object_key = $2, bytes = $3 where id = $1`, [id, done.key, done.bytes]),
    );
    log.info({ backup: done.key, bytes: done.bytes }, 'database backup done');
    return done;
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 500);
    await asServer((db) => db.query(`update backup_runs set finished_at = now(), ok = false, error = $2 where id = $1`, [id, message]));
    await opsAlert(log, 'backup:failed', 'Database backup failed', message);
    throw e;
  }
}

async function nightlyBackup(log: FastifyBaseLogger): Promise<void> {
  if (!backupKey() || istHour() < BACKUP_HOUR_IST) return;
  const due = await asServer(async (db) => {
    const { rows } = await db.query(
      `select not exists (select 1 from backup_runs where ok and started_at > now() - interval '20 hours')
          and not exists (select 1 from backup_runs where started_at > now() - interval '2 hours') as due`,
    );
    return rows[0].due as boolean;
  });
  if (due) await backupNow(log);
}

async function watch(log: FastifyBaseLogger): Promise<void> {
  if (isProduction && !backupKey()) {
    await opsAlert(log, 'backup:off', 'Database backups are off', 'BACKUP_KEY is not set, so no nightly backup is made. Set it in the DigitalOcean app settings.');
  }
  const facts = await asServer(async (db) => {
    const { rows } = await db.query(
      `select (select max(finished_at) from backup_runs where ok) as last_ok,
              (select count(*)::int from server_errors where created_at > now() - interval '1 hour') as errors,
              (select max(method || ' ' || route) from server_errors where created_at > now() - interval '1 hour') as route`,
    );
    return rows[0] as { last_ok: Date | null; errors: number; route: string | null };
  });
  if (backupKey() && facts.last_ok && Date.now() - facts.last_ok.getTime() > STALE_HOURS * 3_600_000) {
    await opsAlert(log, 'backup:stale', 'No good database backup recently', `The last good backup was at ${facts.last_ok.toISOString()}.`);
  }
  if (facts.errors > ERROR_SPIKE) {
    await opsAlert(log, 'errors:spike', 'Many server errors', `${facts.errors} server errors in the last hour, for example ${facts.route}. See Admin, App settings, App health.`);
  }
  await asServer((db) => db.query(`select ops_cleanup()`));
}

export const opsJobs: Job[] = [
  { name: 'db_backup', everyMinutes: 30, run: nightlyBackup },
  { name: 'ops_watch', everyMinutes: 60, run: watch },
];

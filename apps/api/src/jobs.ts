// LLD L11 scheduled jobs. One API instance runs them; a Postgres advisory lock stops a second instance doubling them.
// Each run's result is recorded (job_status), and a job that fails 3 times in a row sends an alert email.
import type { FastifyBaseLogger } from 'fastify';
import { asServer } from './db.ts';
import { safeError } from './errors.ts';
import { adminJobs } from './jobs/admin.ts';
import { deliveryJobs } from './jobs/delivery.ts';
import { opsJobs } from './jobs/ops.ts';
import { socialJobs } from './jobs/social.ts';
import { treeJobs } from './jobs/tree.ts';
import { opsAlert } from './services/alerts.ts';

export interface Job {
  name: string;
  everyMinutes: number;
  run: (log: FastifyBaseLogger) => Promise<void>;
}

const JOB_LOCK = 742001;
export const ALERT_AFTER_FAILURES = 3;

async function record(name: string, ok: boolean, error?: string): Promise<number> {
  return asServer(async (db) => (await db.query(`select job_record($1, $2, $3) as n`, [name, ok, error ?? null])).rows[0].n as number);
}

export async function runJob(job: Job, log: FastifyBaseLogger): Promise<void> {
  try {
    const ran = await asServer(async (db) => {
      const { rows } = await db.query(`select pg_try_advisory_xact_lock($1, hashtext($2)) as ok`, [JOB_LOCK, job.name]);
      if (!rows[0].ok) return false;
      await job.run(log);
      return true;
    });
    if (ran) await record(job.name, true);
  } catch (e) {
    const message = String((e as Error)?.message ?? e).slice(0, 500);
    log.error({ ...safeError(e), job: job.name }, 'job failed');
    try {
      const failures = await record(job.name, false, message);
      if (failures >= ALERT_AFTER_FAILURES) {
        await opsAlert(log, `job:${job.name}`, `Job "${job.name}" keeps failing`, `It has failed ${failures} times in a row. Last error: ${message}`);
      }
    } catch {
      // The database itself may be the problem; the log line above still shows it.
    }
  }
}

export function startJobs(log: FastifyBaseLogger): void {
  const jobs: Job[] = [...treeJobs, ...deliveryJobs, ...adminJobs, ...socialJobs, ...opsJobs];
  for (const job of jobs) setInterval(() => void runJob(job, log), job.everyMinutes * 60_000).unref();
}

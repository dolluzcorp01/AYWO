// LLD L11 scheduled jobs. One API instance runs them; a Postgres advisory lock stops a second instance doubling them.
import type { FastifyBaseLogger } from 'fastify';
import { asServer } from './db.ts';
import { safeError } from './errors.ts';
import { adminJobs } from './jobs/admin.ts';
import { deliveryJobs } from './jobs/delivery.ts';
import { socialJobs } from './jobs/social.ts';
import { treeJobs } from './jobs/tree.ts';

export interface Job {
  name: string;
  everyMinutes: number;
  run: () => Promise<void>;
}

const JOB_LOCK = 742001;

export function startJobs(log: FastifyBaseLogger): void {
  const jobs: Job[] = [...treeJobs, ...deliveryJobs, ...adminJobs, ...socialJobs];
  for (const job of jobs) {
    setInterval(async () => {
      try {
        await asServer(async (db) => {
          const { rows } = await db.query(`select pg_try_advisory_xact_lock($1, hashtext($2)) as ok`, [JOB_LOCK, job.name]);
          if (rows[0].ok) await job.run();
        });
      } catch (e) {
        log.error({ ...safeError(e), job: job.name }, 'job failed');
      }
    }, job.everyMinutes * 60_000).unref();
  }
}

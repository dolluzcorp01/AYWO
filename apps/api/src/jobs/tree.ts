// LLD L11: expire shares and requests hourly, merge scan nightly, successor rule daily.
// All three wake hourly. The two slower ones ask job_claim, so a restart neither skips them nor runs them twice.
import { asServer } from '../db.ts';
import type { Job } from '../jobs.ts';

async function whenDue(name: string, every: string, work: string): Promise<void> {
  await asServer(async (db) => {
    const { rows } = await db.query(`select job_claim($1, $2::interval) as due`, [name, every]);
    if (rows[0].due) await db.query(work);
  });
}

export const treeJobs: Job[] = [
  {
    // Old codes hold phone numbers, and the per-number limits only look back a day.
    name: 'auth_tidy_up',
    everyMinutes: 60,
    run: async () => {
      await asServer(async (db) => {
        await db.query(`delete from auth.otp_codes where created_at < now() - interval '2 days'`);
        await db.query(`delete from auth.refresh_tokens where expires_at < now() - interval '7 days'`);
        await db.query(`delete from plan_member_tries where tried_at < now() - interval '2 days'`);
      });
    },
  },
  {
    name: 'tree_expire_access',
    everyMinutes: 60,
    run: async () => {
      await asServer((db) => db.query(`select tree_expire_access()`));
    },
  },
  {
    name: 'tree_merge_scan',
    everyMinutes: 60,
    run: () => whenDue('tree_merge_scan', '20 hours', `select merge_scan_all()`),
  },
  {
    name: 'tree_successor_rule',
    everyMinutes: 60,
    run: () => whenDue('tree_successor_rule', '20 hours', `select tree_successor_rule()`),
  },
];

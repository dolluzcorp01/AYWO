// Operations release jobs. Each is safe to run again: finished work is marked and never done twice.
import { asServer } from '../db.ts';
import type { Job } from '../jobs.ts';
import { deleteObject, objectSize } from '../services/storage.ts';

const MB = 1_000_000;
// What each upload folder may hold. Signed upload links cannot limit size, so this job removes anything bigger.
const MAX_BYTES: Record<string, number> = { photos: 15 * MB, posts: 15 * MB, chat: 25 * MB, imports: 100 * MB };
const BATCH = 100;

/** Removes files nothing uses any more: memories deleted, photos replaced, accounts closed. */
async function emptyStorageTrash(): Promise<void> {
  const { rows } = await asServer((db) =>
    db.query(`select path from storage_trash where created_at < now() - interval '10 minutes' order by created_at limit $1`, [BATCH]),
  );
  for (const { path } of rows as { path: string }[]) {
    // A file put back in use (an undo, a revert) stays.
    const inUse = await asServer(async (db) => {
      const { rows: hit } = await db.query(`select storage_in_use($1) as used`, [path]);
      return hit[0].used as boolean;
    });
    if (!inUse) await deleteObject(path);
    await asServer((db) => db.query(`delete from storage_trash where path = $1`, [path]));
  }
}

/** Checks each new upload once its signed link has expired. Too big: the file is deleted. */
async function checkUploadSizes(): Promise<void> {
  const { rows } = await asServer((db) =>
    db.query(
      `select path, kind from upload_log where checked_at is null and created_at < now() - interval '11 minutes' order by created_at limit $1`,
      [BATCH],
    ),
  );
  for (const { path, kind } of rows as { path: string; kind: string }[]) {
    const size = await objectSize(path);
    if (size !== null && size > (MAX_BYTES[kind] ?? 15 * MB)) await deleteObject(path);
    await asServer((db) =>
      db.query(`update upload_log set checked_at = now() where path = $1`, [path]),
    );
  }
  await asServer((db) => db.query(`delete from upload_log where checked_at < now() - interval '30 days'`));
}

export const adminJobs: Job[] = [
  {
    name: 'work_overdue',
    everyMinutes: 15,
    run: async () => {
      await asServer((db) => db.query(`select work_overdue_notify()`));
    },
  },
  {
    name: 'referral_rewards',
    everyMinutes: 30,
    run: async () => {
      await asServer((db) => db.query(`select referral_rewards()`));
    },
  },
  {
    // Hourly, and the function itself waits until 8 in the morning India time and sends once a day.
    name: 'birthday_reminders',
    everyMinutes: 60,
    run: async () => {
      await asServer((db) => db.query(`select birthday_reminders()`));
    },
  },
  { name: 'storage_trash', everyMinutes: 15, run: emptyStorageTrash },
  { name: 'upload_sizes', everyMinutes: 10, run: checkUploadSizes },
  {
    name: 'tidy_operations',
    everyMinutes: 60,
    run: async () => {
      await asServer(async (db) => {
        await db.query(`delete from client_errors where created_at < now() - interval '30 days'`);
        await db.query(`delete from email_codes where expires_at < now() - interval '1 day'`);
        await db.query(`delete from staff_invites where expires_at < now() - interval '30 days'`);
      });
    },
  },
];

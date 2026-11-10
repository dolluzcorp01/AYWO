// LLD L11 for the social area. Both are safe to run often: finished work is marked and never done twice.
import { asServer } from '../db.ts';
import type { Job } from '../jobs.ts';

export const socialJobs: Job[] = [
  {
    // F-MEM-02: 'this day last year' to everyone tagged. Hourly, so a restart on the day does not lose it.
    name: 'memory_reminders',
    everyMinutes: 60,
    run: async () => {
      await asServer((db) => db.query(`select run_memory_reminders()`));
    },
  },
  {
    // Closes SOS events whose time ran out, and deletes location data 7 days after the end.
    name: 'sos_close_and_purge',
    everyMinutes: 5,
    run: async () => {
      await asServer((db) => db.query(`select sos_close_and_purge()`));
    },
  },
];

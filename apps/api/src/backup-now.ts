// pnpm backup:now  - makes one database backup right away (the same as the nightly one), and prints where it went.
// pnpm backup:list - lists the backups, newest first.
import { asServer } from './db.ts';
import { backupNow } from './jobs/ops.ts';
import { listBackups } from './services/backup.ts';

if (process.argv.includes('--list')) {
  for (const key of await listBackups()) console.log(key);
} else {
  const done = await backupNow(console);
  console.log(`Backup saved: ${done.key} (${(done.bytes / 1024 / 1024).toFixed(2)} MB)`);
}
await asServer(async () => undefined).catch(() => undefined);
process.exit(0);

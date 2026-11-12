// Restores a database backup. See docs/runbook-backups.md before using this on anything real.
//
//   pnpm backup:restore --latest --to postgres://user:pass@host:5432/new_database
//   pnpm backup:restore --key db/daily/2026-11-12T20-30-00-000Z.dump.enc --to postgres://...
//   pnpm backup:restore --latest --file ./aywo.dump        (only download and open it, restore nothing)
//
// --to must be an EMPTY database (create it first). It refuses the database in DATABASE_URL, so the live data can
// never be overwritten by mistake. Needs the same BACKUP_KEY that made the backup.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { config } from './config.ts';
import { databaseSsl } from './db.ts';
import { fetchBackup, listBackups, pgToolsUrl } from './services/backup.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function sameDatabase(a: string, b: string): boolean {
  const x = new URL(a);
  const y = new URL(b);
  return x.hostname === y.hostname && (x.port || '5432') === (y.port || '5432') && x.pathname === y.pathname;
}

/** The app's two database roles live on the server, not in the backup. A new server needs them before the restore. */
async function prepareRoles(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url, ssl: databaseSsl() });
  await client.connect();
  try {
    await client.query(`do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      end $$`);
    await client.query('grant anon, authenticated to current_user');
  } finally {
    await client.end();
  }
}

const key = arg('key') ?? (process.argv.includes('--latest') ? (await listBackups())[0] : undefined);
const to = arg('to');
const file = arg('file');
if (!key) throw new Error('Say which backup: --latest or --key <name> (pnpm backup:list shows them)');
if (!to && !file) throw new Error('Say where: --to <empty database url> to restore, or --file <path> to only download');
if (to && sameDatabase(to, config.DATABASE_URL)) {
  throw new Error('Refusing to restore over the database in DATABASE_URL. Restore into a new, empty database and switch over to it.');
}

const dir = await mkdtemp(join(tmpdir(), 'aywo-restore-'));
try {
  const dumpPath = file ? resolve(file) : join(dir, 'aywo.dump');
  console.log(`Downloading and opening ${key} ...`);
  await fetchBackup(key, dumpPath);
  console.log(`Opened: ${dumpPath}`);
  if (to) {
    console.log('Preparing the database roles ...');
    await prepareRoles(to);
    console.log('Restoring ...');
    const target = await pgToolsUrl(dir, to);
    const code = await new Promise<number>((done, fail) => {
      // Permissions are restored too: without them the app could not call a single database function.
      const p = spawn(process.env.PG_RESTORE_PATH || 'pg_restore', ['--no-owner', '--exit-on-error', '--single-transaction', `--dbname=${target}`, dumpPath], {
        stdio: 'inherit',
      });
      p.on('error', fail);
      p.on('close', (c) => done(c ?? -1));
    });
    if (code !== 0) throw new Error(`pg_restore exited ${code}`);
    console.log('Restore finished. Check it (docs/runbook-backups.md, step 5) before pointing the app at it.');
  }
} finally {
  if (!file) await rm(dir, { recursive: true, force: true });
}
process.exit(0);

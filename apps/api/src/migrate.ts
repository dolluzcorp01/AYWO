// Applies db/migrations in name order, once each. `--seed` also loads db/seed. Run: pnpm --filter @aywo/api migrate
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db');

async function main(): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await db.query(`select name from public.schema_migrations`)).rows.map((r) => r.name as string));
    const files = (await readdir(join(root, 'migrations'))).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      console.info(`applying ${file}`);
      await db.query('begin');
      try {
        await db.query(await readFile(join(root, 'migrations', file), 'utf8'));
        await db.query(`insert into public.schema_migrations (name) values ($1)`, [file]);
        await db.query('commit');
      } catch (e) {
        await db.query('rollback');
        throw e;
      }
    }
    if (process.argv.includes('--seed')) {
      // Every language's words: scripts/seed-kin-terms.ts adds a file here for each one.
      const words = (await readdir(join(root, 'seed', 'kin_terms'))).filter((f) => f.endsWith('.sql')).sort();
      for (const file of ['languages.sql', 'kin_paths.sql', ...words.map((f) => `kin_terms/${f}`)]) {
        console.info(`seeding ${file}`);
        await db.query(await readFile(join(root, 'seed', file), 'utf8'));
      }
    }
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import pg from 'pg';
import type { PoolClient } from 'pg';
import { config } from './config.ts';

// A birth date is a calendar date, not a moment. Without this, pg makes it a Date that can shift a day with the server's timezone.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

/**
 * TLS settings for every database connection. With the CA certificate the server's identity is checked.
 * Without it (local only; production refuses to start) the line is encrypted but not verified.
 */
export function databaseSsl(): pg.ConnectionConfig['ssl'] {
  if (config.DATABASE_SSL !== 'true') return undefined;
  if (config.DATABASE_CA_CERT) return { ca: config.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: databaseSsl(),
  max: 20,
});

/**
 * Runs as the signed-in person, or as a visitor when userId is null. Row rules apply.
 * Use this by default: an API bug then still cannot show someone data the database would refuse them.
 */
export async function asCaller<T>(userId: string | null, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId })]);
    await db.query(userId ? 'set local role authenticated' : 'set local role anon');
    const result = await work(db);
    await db.query('commit');
    return result;
  } catch (e) {
    await db.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    db.release();
  }
}

/** Ignores row rules. Only after the route has itself decided what is allowed: webhooks, jobs, the outsider link. */
export async function asServer<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    const result = await work(db);
    await db.query('commit');
    return result;
  } catch (e) {
    await db.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    db.release();
  }
}

// Makes the first AYWO Admin. After that, Admins add other staff on the Staff screen.
//
// Usage, from the repo root, after the migrations have run:
//   pnpm --filter @aywo/api exec tsx --env-file=../../.env src/create-admin.ts +919800000000
//
// The number must be in international form. The person then signs in on the web app with that number, as usual,
// and opens /admin. The number need not have signed in before.
// If an Admin already exists the script refuses, unless you add --another.
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { asServer, pool } from './db.ts';

class Refused extends Error {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const another = args.includes('--another');
  const input = args.find((a) => !a.startsWith('--'));
  const parsed = input ? parsePhoneNumberFromString(input) : undefined;
  if (!parsed || !parsed.isValid()) {
    throw new Refused('Give one phone number in international form, for example +919800000000.');
  }
  const phone = parsed.number;

  await asServer(async (db) => {
    const existing = await db.query(`select count(*)::int as n from app_admins where role = 'aywo_admin'`);
    if (existing.rows[0].n > 0 && !another) {
      throw new Refused('An AYWO Admin already exists. Add other staff on the Staff screen, or use --another.');
    }
    // A trigger creates the profile (0004). The number counts as verified only once they sign in with the code.
    const user = await db.query(
      `insert into auth.users (phone) values ($1)
       on conflict (phone) do update set phone = excluded.phone
       returning id, banned_at`,
      [phone],
    );
    if (user.rows[0].banned_at) throw new Refused('That account is blocked. Unblock it first.');
    const id = user.rows[0].id as string;
    await db.query(
      `insert into app_admins (profile_id, role) values ($1, 'aywo_admin')
       on conflict (profile_id) do update set role = 'aywo_admin'`,
      [id],
    );
    await db.query(`delete from app_admin_permissions where profile_id = $1`, [id]);
    await db.query(
      `insert into admin_audit_log (actor_id, action, target_type, target_id, details)
       values (null, 'staff.bootstrap', 'user', $1, '{"role":"aywo_admin"}')`,
      [id],
    );
  });
  console.info(`AYWO Admin ready: number ending ${phone.slice(-4)}. Sign in on the web app and open /admin.`);
}

main()
  .catch((e: unknown) => {
    // A refusal is a plain message. Anything else is unexpected, and the phone number is not part of it.
    console.error(e instanceof Refused ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

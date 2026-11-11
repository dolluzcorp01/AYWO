// DEVELOPMENT ONLY. Gives a test account AYWO Plus for some days, so chat, groups and other Plus screens can be tried
// without a real payment. Refuses to run when NODE_ENV=production; in production staff use Admin > Users > Give Plus.
//
// Usage, from the repo root, after the person has signed in once:
//   pnpm dev:plus +919800000123          (30 days)
//   pnpm dev:plus +919800000123 7        (7 days)
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { isProduction } from './config.ts';
import { asServer, pool } from './db.ts';

class Refused extends Error {}

async function main(): Promise<void> {
  if (isProduction) throw new Refused('dev-give-plus is for development only. Use Admin > Users > Give Plus.');
  const [input, daysText] = process.argv.slice(2).filter((a) => a !== '--');
  const parsed = input ? parsePhoneNumberFromString(input) : undefined;
  if (!parsed || !parsed.isValid()) throw new Refused('Give a phone number in international form, for example +919800000123.');
  const days = daysText ? Number(daysText) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Refused('Days must be a whole number from 1 to 365.');

  const until = await asServer(async (db) => {
    const { rows } = await db.query(
      `update profiles p set plus_bonus_until = greatest(coalesce(p.plus_bonus_until, now()), now()) + make_interval(days => $2)
       from auth.users u where u.id = p.id and u.phone = $1 and p.deleted_at is null
       returning p.plus_bonus_until`,
      [parsed.number, days],
    );
    return rows[0]?.plus_bonus_until as Date | undefined;
  });
  if (!until) throw new Refused('No account with that number. Sign in with it once on the app first.');
  console.info(`Plus on for the number ending ${parsed.number.slice(-4)} until ${until.toISOString().slice(0, 10)}.`);
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Refused ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

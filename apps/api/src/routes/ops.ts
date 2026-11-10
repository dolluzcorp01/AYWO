// Operations release, the people's side: public app settings and website banners, app crash reports and email
// verification. Everything else for people (report, block, help tickets, offers, referrals, emergency card) goes
// through POST /rpc, listed in rpc/ops.ts.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { optionalUser, requireUser } from '../auth-tokens.ts';
import { config } from '../config.ts';
import { asCaller, asServer } from '../db.ts';
import { ApiError } from '../errors.ts';
import { sendEmail } from '../services/email.ts';

const CONFIG_CACHE_MS = 30_000;
const EMAIL_CODE_MINUTES = 15;
const EMAIL_CODE_TRIES = 5;
const EMAIL_SENDS_PER_HOUR = 5;

let configCache: { value: unknown; until: number } | null = null;

/** Phone numbers, emails and long digit runs are taken out of crash text before it is stored. */
export function scrubCrashText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[number]')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]');
}

/** Same crash, same fingerprint: the message without numbers, and the first line of the stack. */
export function crashFingerprint(message: string, stack: string | null): string {
  const top = (stack ?? '').split('\n').find((line) => line.trim().length > 0) ?? '';
  return createHash('sha256').update(`${message.replace(/\d+/g, '#')}|${top.replace(/:\d+:\d+/g, '')}`).digest('hex').slice(0, 24);
}

function hashEmailCode(profileId: string, email: string, code: string): string {
  return createHash('sha256').update(`${config.OTP_SECRET}:email:${profileId}:${email.toLowerCase()}:${code}`).digest('hex');
}

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  // ----- Public: what every app and the website checks on start (forced update, maintenance, switches) -----
  app.get('/config', async () => {
    const now = Date.now();
    if (configCache && configCache.until > now) return configCache.value;
    const value = await asCaller(null, async (db) => {
      const { rows } = await db.query(`select app_config_public() as c`);
      return rows[0].c;
    });
    configCache = { value, until: now + CONFIG_CACHE_MS };
    return value;
  });

  // ----- Public: the website's scrolling banner for visitors -----
  app.get('/announcements/public', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async () =>
    asCaller(null, async (db) => {
      const { rows } = await db.query(`select announcements_public() as a`);
      return rows[0].a;
    }),
  );

  // ----- App crash reports. Kept 30 days, read only by staff with settings or analytics. -----
  app.post('/client-errors', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = z
      .object({
        platform: z.enum(['ios', 'android', 'web']),
        app_version: z.string().max(20).optional(),
        route: z.string().max(200).optional(),
        message: z.string().min(1).max(2000),
        stack: z.string().max(8000).optional(),
      })
      .parse(req.body);
    const userId = await optionalUser(req);
    const message = scrubCrashText(body.message).slice(0, 500);
    const stack = body.stack ? scrubCrashText(body.stack).slice(0, 4000) : null;
    // Routes can carry ids of people and trees; only the screen's shape is kept.
    const route = body.route ? body.route.replace(/[0-9a-f-]{36}/gi, '[id]').slice(0, 200) : null;
    await asServer((db) =>
      db.query(
        `insert into client_errors (profile_id, platform, app_version, route, message, stack, fingerprint)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, body.platform, body.app_version ?? null, route, message, stack, crashFingerprint(message, stack)],
      ),
    );
    return { ok: true };
  });

  // ----- Email verification: notification emails go only to a confirmed address -----
  app.post('/me/email/send-code', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const userId = await requireUser(req);
    const me = await asCaller(userId, async (db) => {
      const { rows } = await db.query(`select email, language_code from profiles where id = $1`, [userId]);
      return rows[0] as { email: string | null; language_code: string } | undefined;
    });
    if (!me?.email) throw new ApiError(422, 'email_missing');
    const email = me.email;
    const code = String(randomInt(100000, 1000000));
    const allowed = await asServer(async (db) => {
      const { rows } = await db.query(
        `insert into email_codes (profile_id, email, code_hash, expires_at)
         values ($1, $2, $3, now() + make_interval(mins => $4))
         on conflict (profile_id) do update set
           email = excluded.email, code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at,
           sent_count = case when email_codes.created_at > now() - interval '1 hour' then email_codes.sent_count + 1 else 1 end,
           created_at = case when email_codes.created_at > now() - interval '1 hour' then email_codes.created_at else now() end
         returning sent_count`,
        [userId, email, hashEmailCode(userId, email, code), EMAIL_CODE_MINUTES],
      );
      return Number(rows[0].sent_count) <= EMAIL_SENDS_PER_HOUR;
    });
    if (!allowed) throw new ApiError(429, 'too_many_requests');
    const tamil = me.language_code.startsWith('ta');
    await sendEmail(
      email,
      tamil
        ? { title: 'உங்கள் AYWO மின்னஞ்சல் குறியீடு', body: `உங்கள் குறியீடு ${code}. இது ${EMAIL_CODE_MINUTES} நிமிடங்கள் செல்லும்.` }
        : { title: 'Your AYWO email code', body: `Your code is ${code}. It works for ${EMAIL_CODE_MINUTES} minutes.` },
      `${config.WEB_URL}/settings/notifications`,
      me.language_code,
    );
    return { ok: true };
  });

  app.post('/me/email/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const userId = await requireUser(req);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const ok = await asServer(async (db) => {
      const { rows } = await db.query(
        `select c.email, c.code_hash, c.attempts, p.email as current_email
         from email_codes c join profiles p on p.id = c.profile_id
         where c.profile_id = $1 and c.expires_at > now() for update of c`,
        [userId],
      );
      const row = rows[0] as { email: string; code_hash: string; attempts: number; current_email: string | null } | undefined;
      if (!row || row.attempts >= EMAIL_CODE_TRIES || row.current_email !== row.email) return false;
      const expected = Buffer.from(row.code_hash);
      const given = Buffer.from(hashEmailCode(userId, row.email, code));
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        await db.query(`update email_codes set attempts = attempts + 1 where profile_id = $1`, [userId]);
        return false;
      }
      await db.query(`update profiles set email_verified_at = now() where id = $1 and email = $2`, [userId, row.email]);
      await db.query(`delete from email_codes where profile_id = $1`, [userId]);
      return true;
    });
    if (!ok) throw new ApiError(422, 'email_code_wrong');
    return { ok: true };
  });
}

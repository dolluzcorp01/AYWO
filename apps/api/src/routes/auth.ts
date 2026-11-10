// LLD L5 no. 1: phone OTP login, replacing Supabase Auth.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { hashToken, newRefreshToken, REFRESH_DAYS, signAccessToken } from '../auth-tokens.ts';
import { config, isReviewerLogin } from '../config.ts';
import { asServer } from '../db.ts';
import { ApiError } from '../errors.ts';
import { sendSms } from '../services/sms.ts';

const OTP_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_SENDS_PER_DAY = 15;
// Attempts are per code and a new code can always be asked for, so wrong guesses also count across codes.
const MAX_WRONG_PER_HOUR = 20;
// A lost answer can make a phone send the same token again straight away. Later than this, a used token is a stolen one.
const REUSE_GRACE_SECONDS = 60;

function e164(input: string): string {
  const parsed = parsePhoneNumberFromString(input);
  if (!parsed || !parsed.isValid()) throw new ApiError(422, 'phone_invalid');
  return parsed.number;
}

function hashCode(phone: string, code: string): string {
  return createHash('sha256').update(`${config.OTP_SECRET}:${phone}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function issueTokens(userId: string) {
  const access = await signAccessToken(userId);
  const refresh = newRefreshToken();
  await asServer((db) =>
    db.query(
      `insert into auth.refresh_tokens (token_hash, user_id, expires_at)
       values ($1, $2, now() + make_interval(days => $3))`,
      [refresh.hash, userId, REFRESH_DAYS],
    ),
  );
  return { access_token: access, refresh_token: refresh.token, user_id: userId };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } };

  app.post('/auth/otp/send', strict, async (req) => {
    const phone = e164(z.object({ phone: z.string() }).parse(req.body).phone);

    const recent = await asServer(async (db) => {
      const { rows } = await db.query(
        `select count(*) filter (where created_at > now() - interval '10 minutes')::int as window, count(*)::int as day
         from auth.otp_codes where phone = $1 and created_at > now() - interval '1 day'`,
        [phone],
      );
      return rows[0] as { window: number; day: number };
    });
    if (recent.window >= MAX_SENDS_PER_WINDOW || recent.day >= MAX_SENDS_PER_DAY) throw new ApiError(429, 'otp_too_many');

    // The reviewers' number never receives an SMS and uses its fixed code.
    const isReviewer = isReviewerLogin(phone);
    const code = isReviewer ? config.OTP_TEST_CODE : String(randomInt(100000, 1000000));
    await asServer((db) =>
      db.query(
        `insert into auth.otp_codes (phone, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
        [phone, hashCode(phone, code), OTP_MINUTES],
      ),
    );
    if (!isReviewer) await sendSms(phone, `${code} is your AYWO code. It works for ${OTP_MINUTES} minutes.`, code);
    return { ok: true };
  });

  app.post('/auth/otp/verify', strict, async (req) => {
    const body = z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
    const phone = e164(body.phone);

    const userId = await asServer(async (db) => {
      const wrong = await db.query(
        `select coalesce(sum(attempts), 0)::int as n from auth.otp_codes where phone = $1 and created_at > now() - interval '1 hour'`,
        [phone],
      );
      if (wrong.rows[0].n >= MAX_WRONG_PER_HOUR) return null;
      const { rows } = await db.query(
        `select id, code_hash, attempts from auth.otp_codes
         where phone = $1 and used_at is null and expires_at > now()
         order by created_at desc limit 1 for update`,
        [phone],
      );
      const row = rows[0];
      if (!row || row.attempts >= MAX_ATTEMPTS) return null;
      if (!sameHash(row.code_hash, hashCode(phone, body.code))) {
        await db.query(`update auth.otp_codes set attempts = attempts + 1 where id = $1`, [row.id]);
        return null;
      }
      await db.query(`update auth.otp_codes set used_at = now() where id = $1`, [row.id]);
      // A trigger on auth.users creates the profile (0004).
      const user = await db.query(
        `insert into auth.users (phone, phone_confirmed_at) values ($1, now())
         on conflict (phone) do update set phone_confirmed_at = coalesce(auth.users.phone_confirmed_at, now())
         returning id, banned_at`,
        [phone],
      );
      if (user.rows[0].banned_at) throw new ApiError(403, 'account_blocked');
      // The fixed code is known to outsiders, so it must never open a staff account.
      if (isReviewerLogin(phone)) {
        const staff = await db.query(`select 1 from app_admins where profile_id = $1`, [user.rows[0].id]);
        if (staff.rows[0]) throw new ApiError(403, 'not_allowed');
      } else {
        // Someone invited to the staff before their first sign-in becomes staff now.
        await db.query(`select staff_invite_claim($1)`, [user.rows[0].id]);
      }
      return user.rows[0].id as string;
    });
    if (!userId) throw new ApiError(422, 'otp_wrong');
    return issueTokens(userId);
  });

  app.post('/auth/refresh', async (req) => {
    const { refresh_token: token } = z.object({ refresh_token: z.string() }).parse(req.body);
    const userId = await asServer(async (db) => {
      // Each refresh token works once.
      const { rows } = await db.query(
        `update auth.refresh_tokens r set revoked_at = now()
         from auth.users u
         where r.token_hash = $1 and r.user_id = u.id and r.revoked_at is null and r.expires_at > now() and u.banned_at is null
         returning r.user_id`,
        [hashToken(token)],
      );
      if (rows[0]) return rows[0].user_id as string;
      // A token that was already used turning up again means two holders, and one is a thief. End every session.
      await db.query(
        `update auth.refresh_tokens set revoked_at = now()
         where revoked_at is null and user_id = (
           select user_id from auth.refresh_tokens
           where token_hash = $1 and revoked_at < now() - make_interval(secs => $2)
         )`,
        [hashToken(token), REUSE_GRACE_SECONDS],
      );
      return null;
    });
    if (!userId) throw new ApiError(401, 'session_ended');
    return issueTokens(userId);
  });

  app.post('/auth/logout', async (req) => {
    const { refresh_token: token } = z.object({ refresh_token: z.string() }).parse(req.body);
    await asServer((db) => db.query(`update auth.refresh_tokens set revoked_at = now() where token_hash = $1`, [hashToken(token)]));
    return { ok: true };
  });
}

// Staff calls and the second sign-in step. Staff sign in with their phone like everyone, then prove they hold their
// authenticator app (RFC 6238 codes). The proof is a short-lived signed token the admin web app sends with each call.
import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import type { PoolClient } from 'pg';
import { config, isProduction } from './config.ts';
import { asCaller, asServer } from './db.ts';
import { ApiError } from './errors.ts';
import { requireUser } from './auth-tokens.ts';

export const GRANTABLE = [
  'dictionary', 'takedowns', 'users', 'trees', 'payments', 'support', 'moderation', 'orders', 'marketing', 'analytics', 'settings',
] as const;
export type Gate = (typeof GRANTABLE)[number] | 'staff' | 'audit';

const proofKey = new TextEncoder().encode(`${config.JWT_SECRET}:staff-two-step`);
const PROOF_HOURS = 12;
const STEP_SECONDS = 30;
export const PROOF_HEADER = 'x-staff-proof';

/** Production always asks for the second step. Elsewhere only when STAFF_TWO_STEP=required, or once a person set it up. */
export const twoStepRequired = isProduction ? config.STAFF_TWO_STEP !== 'off' : config.STAFF_TWO_STEP === 'required';

// ----- RFC 4648 base32, as authenticator apps expect -----
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('bad base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The six digits an authenticator shows for one 30-second step. */
export function totp(secret: string, step: number): string {
  const counter = new Uint8Array(8);
  let rest = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = rest & 255;
    rest = Math.floor(rest / 256);
  }
  const digest = new Uint8Array(createHmac('sha1', Buffer.from(fromBase32(secret))).update(Buffer.from(counter)).digest());
  const offset = digest[digest.length - 1] & 15;
  const number = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(number % 1_000_000).padStart(6, '0');
}

/** The step a code belongs to, allowing one step of clock drift either way. A step already used is refused. */
export function matchStep(secret: string, code: string, lastStep: number, now = Date.now()): number | null {
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (const step of [current, current - 1, current + 1]) {
    if (step > lastStep && totp(secret, step) === code) return step;
  }
  return null;
}

// ----- Authenticator secrets are stored sealed (AES-256-GCM), so a copy of the database alone cannot make staff codes. -----
// The key comes from STAFF_SECRET_KEY, or from JWT_SECRET when that is not set. Changing the key means every staff member
// sets up their authenticator again (an AYWO Admin resets them on the Staff page).
const SEAL_PREFIX = 'v1:';
let sealKey: Promise<CryptoKey> | null = null;

function staffSealKey(): Promise<CryptoKey> {
  sealKey ??= (async () => {
    const material = new TextEncoder().encode(`${config.STAFF_SECRET_KEY || config.JWT_SECRET}:staff-authenticator`);
    const raw = await globalThis.crypto.subtle.digest('SHA-256', material);
    return globalThis.crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  })();
  return sealKey;
}

export async function sealSecret(secret: string): Promise<string> {
  const iv = new Uint8Array(randomBytes(12));
  const sealed = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await staffSealKey(), new TextEncoder().encode(secret));
  return `${SEAL_PREFIX}${Buffer.from(iv).toString('base64')}:${Buffer.from(new Uint8Array(sealed)).toString('base64')}`;
}

/** Opens a sealed secret. A secret saved before sealing existed is plain base32 and is returned as it is. */
export async function openSecret(stored: string): Promise<string> {
  if (!stored.startsWith(SEAL_PREFIX)) return stored;
  const [iv, data] = stored.slice(SEAL_PREFIX.length).split(':');
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(Buffer.from(iv, 'base64')) },
    await staffSealKey(),
    new Uint8Array(Buffer.from(data, 'base64')),
  );
  return new TextDecoder().decode(plain);
}

export function newTotpSecret(): string {
  return base32(new Uint8Array(randomBytes(20)));
}

export async function signStaffProof(userId: string): Promise<{ proof: string; expires_at: string }> {
  const expires = new Date(Date.now() + PROOF_HOURS * 3_600_000);
  const proof = await new SignJWT({ two_step: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('aywo-staff')
    .setIssuedAt()
    .setExpirationTime(Math.floor(expires.getTime() / 1000))
    .sign(proofKey);
  return { proof, expires_at: expires.toISOString() };
}

async function hasValidProof(req: FastifyRequest, userId: string): Promise<boolean> {
  const header = req.headers[PROOF_HEADER];
  if (typeof header !== 'string' || header.length === 0) return false;
  try {
    const { payload } = await jwtVerify(header, proofKey, { algorithms: ['HS256'], audience: 'aywo-staff' });
    return payload.sub === userId && payload.two_step === true;
  } catch {
    return false;
  }
}

/** Refuses a staff call until the second step is done: set up first if it must be, then a fresh code every 12 hours. */
export async function requireTwoStep(req: FastifyRequest, userId: string): Promise<void> {
  const row = await asServer(async (db) => {
    const { rows } = await db.query(
      `select a.profile_id, m.confirmed_at from app_admins a left join admin_mfa m on m.profile_id = a.profile_id where a.profile_id = $1`,
      [userId],
    );
    return rows[0] as { profile_id: string; confirmed_at: Date | null } | undefined;
  });
  // Not staff at all: the database function gives the usual refusal.
  if (!row) return;
  if (row.confirmed_at) {
    if (!(await hasValidProof(req, userId))) throw new ApiError(403, 'admin_two_step_required');
    return;
  }
  if (twoStepRequired) throw new ApiError(403, 'admin_two_step_setup');
}

/**
 * Calls one database function as the signed-in staff member. `call` is always a fixed name from the routes.
 * With `gate`, the caller must hold at least one of those permissions; null leaves the check to the function
 * (for screens every staff member may open, which show only what that person is granted).
 */
export async function staffCall(req: FastifyRequest, gate: Gate[] | null, call: string, params: unknown[] = []): Promise<unknown> {
  const userId = await requireUser(req);
  await requireTwoStep(req, userId);
  return asCaller(userId, async (db) => {
    await checkGate(db, gate);
    const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await db.query(`select public.${call}(${placeholders}) as result`, params);
    return rows[0].result ?? null;
  });
}

export async function checkGate(db: PoolClient, gate: Gate[] | null): Promise<void> {
  if (!gate) return;
  const check = await db.query(`select bool_or(has_admin_permission(g)) as ok from unnest($1::text[]) g`, [gate]);
  if (!check.rows[0].ok) throw new ApiError(403, 'admin_not_allowed');
}

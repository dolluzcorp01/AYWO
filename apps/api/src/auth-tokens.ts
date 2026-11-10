import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import { config } from './config.ts';
import { pool } from './db.ts';
import { ApiError } from './errors.ts';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const ACCESS_MINUTES = 15;
export const REFRESH_DAYS = 60;

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_MINUTES}m`)
    .sign(secret);
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// An access token outlives a block by up to 15 minutes, so each request checks. The short memory keeps that from being
// a query on every request; a block made on another server takes effect here within this time.
const BLOCK_MEMORY_MS = 30_000;
const BLOCK_MEMORY_MAX = 50_000;
const blockMemory = new Map<string, { blocked: boolean; until: number }>();

/** True for a blocked or deleted account, and for a token whose account no longer exists. */
export async function isUserBlocked(userId: string): Promise<boolean> {
  const now = Date.now();
  const known = blockMemory.get(userId);
  if (known && known.until > now) return known.blocked;
  const { rows } = await pool.query(`select banned_at is not null as blocked from auth.users where id = $1`, [userId]);
  const blocked = (rows[0]?.blocked as boolean | undefined) ?? true;
  if (blockMemory.size >= BLOCK_MEMORY_MAX) blockMemory.clear();
  blockMemory.set(userId, { blocked, until: now + BLOCK_MEMORY_MS });
  return blocked;
}

/** For when this server has just blocked or unblocked someone. */
export function forgetBlockMemory(userId: string): void {
  blockMemory.delete(userId);
}

/** The signed-in person's id, or null for a visitor. A bad or expired token, or a blocked account, counts as a visitor here. */
export async function optionalUser(req: FastifyRequest): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  let id: string | null;
  try {
    const { payload } = await jwtVerify(header.slice(7), secret, { algorithms: ['HS256'] });
    id = payload.sub ?? null;
  } catch {
    return null;
  }
  if (!id) return null;
  return (await isUserBlocked(id)) ? null : id;
}

/** For routes that need someone signed in. 401 tells the app to refresh its token and try again. A blocked account's refresh fails, which signs them out. */
export async function requireUser(req: FastifyRequest): Promise<string> {
  const id = await optionalUser(req);
  if (!id) throw new ApiError(401, 'not_signed_in');
  return id;
}

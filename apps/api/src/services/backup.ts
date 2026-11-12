// Nightly database backup. pg_dump's own compressed format, encrypted with AES-256-GCM (BACKUP_KEY), streamed to a
// separate private bucket: db/daily/<time>.dump.enc, plus the first good one of each month in db/monthly/<month>.dump.enc.
// Kept: the newest 30 daily and 12 monthly. DigitalOcean's own 7-day backups stay on as well: this is the longer,
// separate copy. File layout: "AYWOBK01" (8 bytes), a 12-byte IV, the encrypted dump, and the 16-byte GCM tag at the end.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { backupBucket, backupKey, config } from '../config.ts';
import { HEADER_BYTES, TAG_BYTES, decryptFile, encryptStream, toPrune } from './backupCrypto.ts';
import { s3 } from './storage.ts';

export const KEEP_DAILY = 30;
export const KEEP_MONTHLY = 12;

/** pg_dump and pg_restore need the certificate as a file, and must check it (verify-full), not just encrypt. */
export async function pgToolsUrl(dir: string, url = config.DATABASE_URL): Promise<string> {
  if (config.DATABASE_SSL !== 'true' || !config.DATABASE_CA_CERT.includes('BEGIN CERTIFICATE')) return url;
  const ca = join(dir, 'ca.crt');
  await writeFile(ca, config.DATABASE_CA_CERT, { mode: 0o600 });
  const u = new URL(url);
  u.searchParams.set('sslmode', 'verify-full');
  u.searchParams.set('sslrootcert', ca);
  return u.toString();
}

async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: backupBucket }));
  } catch {
    // A new bucket is private by default.
    await s3.send(new CreateBucketCommand({ Bucket: backupBucket }));
  }
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: backupBucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: backupBucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Makes one backup. Returns where it went and its size; throws on any failure. */
export async function makeBackup(now = new Date()): Promise<{ key: string; bytes: number }> {
  const key = backupKey();
  if (!key) throw new Error('BACKUP_KEY is not set');
  await ensureBucket();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const objectKey = `db/daily/${stamp}.dump.enc`;
  const dir = await mkdtemp(join(tmpdir(), 'aywo-backup-'));
  try {
    const url = await pgToolsUrl(dir);
    const dump = spawn(process.env.PG_DUMP_PATH || 'pg_dump', ['--format=custom', '--compress=6', '--no-owner', `--dbname=${url}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    dump.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    const exited = new Promise<number>((resolve, reject) => {
      dump.on('error', reject);
      dump.on('close', (code) => resolve(code ?? -1));
    });
    let bytes = 0;
    const counted = new PassThrough();
    counted.on('data', (c: Buffer) => {
      bytes += c.length;
    });
    const body = dump.stdout.pipe(encryptStream(key)).pipe(counted);
    const upload = new Upload({
      client: s3,
      params: { Bucket: backupBucket, Key: objectKey, Body: body, ContentType: 'application/octet-stream' },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
    });
    const [code] = await Promise.all([exited, upload.done()]);
    if (code !== 0) {
      // A dump that stopped half way must not be kept as if it were good.
      await s3.send(new DeleteObjectCommand({ Bucket: backupBucket, Key: objectKey })).catch(() => undefined);
      throw new Error(`pg_dump exited ${code}: ${stderr.trim().slice(-300)}`);
    }
    if (bytes < HEADER_BYTES + TAG_BYTES + 100) throw new Error(`backup is suspiciously small (${bytes} bytes)`);

    // The first good backup of a month is also kept as that month's copy.
    const monthKey = `db/monthly/${stamp.slice(0, 7)}.dump.enc`;
    if (!(await exists(monthKey))) {
      await s3.send(new CopyObjectCommand({ Bucket: backupBucket, Key: monthKey, CopySource: `${backupBucket}/${objectKey}` }));
    }
    for (const old of toPrune(await listKeys('db/daily/'), KEEP_DAILY)) await s3.send(new DeleteObjectCommand({ Bucket: backupBucket, Key: old }));
    for (const old of toPrune(await listKeys('db/monthly/'), KEEP_MONTHLY)) await s3.send(new DeleteObjectCommand({ Bucket: backupBucket, Key: old }));
    return { key: objectKey, bytes };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Daily backups newest first, then monthly ones newest first. The first one is the latest. */
export async function listBackups(): Promise<string[]> {
  const newestFirst = (keys: string[]) => [...keys].sort().reverse();
  return [...newestFirst(await listKeys('db/daily/')), ...newestFirst(await listKeys('db/monthly/'))];
}

/** Downloads one backup and decrypts it into a pg_restore file at outPath. */
export async function fetchBackup(objectKey: string, outPath: string): Promise<void> {
  const key = backupKey();
  if (!key) throw new Error('BACKUP_KEY is not set: a backup cannot be opened without it');
  const encrypted = `${outPath}.enc`;
  const result = await s3.send(new GetObjectCommand({ Bucket: backupBucket, Key: objectKey }));
  if (!result.Body) throw new Error('empty backup');
  await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(encrypted));
  try {
    await decryptFile(encrypted, key, createWriteStream(outPath));
  } catch (e) {
    // Wrong key or a changed file: what was written so far cannot be trusted, so it must not be left behind.
    await rm(outPath, { force: true });
    throw e;
  } finally {
    await rm(encrypted, { force: true });
  }
}

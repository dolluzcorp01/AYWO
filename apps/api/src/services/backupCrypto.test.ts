import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { MAGIC, decryptFile, encryptStream, toPrune } from './backupCrypto';

const dirs: string[] = [];
async function encryptTo(data: Buffer, key: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bk-test-'));
  dirs.push(dir);
  const path = join(dir, 'b.enc');
  // In several pieces, like pg_dump's output.
  const pieces = [data.subarray(0, 5), data.subarray(5, 70000), data.subarray(70000)];
  await pipeline(Readable.from(pieces), encryptStream(key), createWriteStream(path));
  return path;
}
async function decryptToBuffer(path: string, key: Buffer): Promise<Buffer> {
  const out = `${path}.out`;
  await decryptFile(path, key, createWriteStream(out));
  return readFile(out);
}
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('backup encryption', () => {
  const key = randomBytes(32);
  const data = randomBytes(150_000);

  it('opens back to exactly what went in', async () => {
    const path = await encryptTo(data, key);
    expect((await decryptToBuffer(path, key)).equals(data)).toBe(true);
  });

  it('starts with the AYWO header and does not contain the data in the clear', async () => {
    const path = await encryptTo(data, key);
    const file = await readFile(path);
    expect(file.subarray(0, 8).equals(MAGIC)).toBe(true);
    expect(file.includes(data.subarray(1000, 1032))).toBe(false);
  });

  it('refuses the wrong key', async () => {
    const path = await encryptTo(data, key);
    await expect(decryptToBuffer(path, randomBytes(32))).rejects.toThrow();
  });

  it('refuses a backup that was changed', async () => {
    const path = await encryptTo(data, key);
    const file = await readFile(path);
    file[5000] ^= 1;
    await writeFile(path, file);
    await expect(decryptToBuffer(path, key)).rejects.toThrow();
  });

  it('refuses a file that is not a backup', async () => {
    const path = await encryptTo(data, key);
    const file = await readFile(path);
    file[0] = 0x58;
    await writeFile(path, file);
    await expect(decryptToBuffer(path, key)).rejects.toThrow('wrong header');
  });

  it('handles an empty dump', async () => {
    const path = await encryptTo(Buffer.alloc(0), key);
    expect((await decryptToBuffer(path, key)).length).toBe(0);
  });
});

describe('toPrune', () => {
  it('keeps the newest and deletes the rest', () => {
    const keys = ['db/daily/2026-11-01.dump.enc', 'db/daily/2026-11-03.dump.enc', 'db/daily/2026-11-02.dump.enc'];
    expect(toPrune(keys, 2)).toEqual(['db/daily/2026-11-01.dump.enc']);
    expect(toPrune(keys, 30)).toEqual([]);
  });
});

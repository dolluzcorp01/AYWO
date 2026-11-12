// The backup file format and keep rules, with no settings or network: AES-256-GCM, "AYWOBK01" + 12-byte IV first,
// the 16-byte tag last, so a backup can be written as a stream and any change to it is detected when opening it.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAGIC = Buffer.from('AYWOBK01');
const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = 8 + IV_BYTES;

/** Encrypts a stream: writes the header and IV first and the GCM tag last. */
export function encryptStream(key: Buffer): Transform {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let started = false;
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (!started) {
        this.push(Buffer.concat([MAGIC, iv]));
        started = true;
      }
      done(null, cipher.update(chunk));
    },
    flush(done) {
      if (!started) this.push(Buffer.concat([MAGIC, iv]));
      this.push(cipher.final());
      done(null, cipher.getAuthTag());
    },
  });
}

/** Decrypts a backup file into out. Throws if the file is not a backup, the key is wrong, or it was changed. */
export async function decryptFile(path: string, key: Buffer, out: Writable): Promise<void> {
  const size = (await stat(path)).size;
  if (size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error('not an AYWO backup (too small)');
  const file = await open(path, 'r');
  const head = Buffer.alloc(MAGIC.length + IV_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await file.read(head, 0, head.length, 0);
    await file.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await file.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not an AYWO backup (wrong header)');
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  // Nothing between the header and the tag: there is no byte range to read, but the tag must still be checked.
  const source = size - TAG_BYTES > head.length ? createReadStream(path, { start: head.length, end: size - TAG_BYTES - 1 }) : Readable.from([]);
  await pipeline(source, decipher, out);
}

/** The daily copies to delete: everything older than the newest `keep`. Keys sort by time. */
export function toPrune(keys: string[], keep: number): string[] {
  return [...keys].sort().reverse().slice(keep);
}


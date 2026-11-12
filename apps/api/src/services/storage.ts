// DigitalOcean Spaces (S3-compatible; MinIO on a laptop). Private: the app gets short-lived signed links only.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.ts';

/** Shared with the backup service, which writes to its own bucket. */
export const s3 = new S3Client({
  endpoint: config.SPACES_ENDPOINT,
  region: config.SPACES_REGION,
  credentials: { accessKeyId: config.SPACES_KEY, secretAccessKey: config.SPACES_SECRET },
  // MinIO on a laptop serves files as /bucket/file; Spaces as bucket.host/file.
  forcePathStyle: config.SPACES_PATH_STYLE === 'true',
  // The SDK's default adds checksums that signed uploads from a browser or phone do not send, and Spaces may not support.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const READ_SECONDS = 3600;
const UPLOAD_SECONDS = 600;

export function signedUploadUrl(path: string, contentType: string): Promise<string> {
  // The presigner leaves content-type out of the signature unless told otherwise, and the type the route checked would
  // then not bind the upload: an 'image' could be stored as a web page and opened from a signed link.
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: config.SPACES_BUCKET, Key: path, ContentType: contentType }), {
    expiresIn: UPLOAD_SECONDS,
    signableHeaders: new Set(['content-type']),
  });
}

export function signedReadUrl(path: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.SPACES_BUCKET, Key: path }), { expiresIn: READ_SECONDS });
}

/** A signed link for each path, keyed by path. */
export async function signedReadUrls(paths: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter((p): p is string => !!p))];
  const urls = await Promise.all(wanted.map(async (p) => [p, await signedReadUrl(p)] as const));
  return new Map(urls);
}

export class FileTooBig extends Error {}

/** A signed upload link cannot limit size, so the file is measured here before it is read into memory. */
export async function downloadObject(path: string, maxBytes: number): Promise<Uint8Array> {
  const result = await s3.send(new GetObjectCommand({ Bucket: config.SPACES_BUCKET, Key: path }));
  if (!result.Body) throw new Error('empty object');
  if ((result.ContentLength ?? 0) > maxBytes) {
    result.Body.transformToWebStream().cancel().catch(() => undefined);
    throw new FileTooBig();
  }
  return result.Body.transformToByteArray();
}

export async function uploadObject(path: string, body: Uint8Array | string, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: config.SPACES_BUCKET, Key: path, Body: body, ContentType: contentType }));
}

/** The stored size in bytes, or null when the file is not there (an upload that never happened). */
export async function objectSize(path: string): Promise<number | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: config.SPACES_BUCKET, Key: path }));
    return head.ContentLength ?? 0;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as { name?: string }).name === 'NotFound') return null;
    throw e;
  }
}

/** Deleting a file that is already gone succeeds, so the cleanup job can safely try again. */
export async function deleteObject(path: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.SPACES_BUCKET, Key: path }));
}

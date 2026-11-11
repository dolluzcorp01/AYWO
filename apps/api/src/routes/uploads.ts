// POST /uploads/presign: a short-lived link to upload one file straight to DigitalOcean Spaces.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { readGedcom } from '@aywo/gedcom';
import { readLightenZip } from '@aywo/lighten';
import { z } from 'zod';
import { requireUser } from '../auth-tokens.ts';
import { asServer } from '../db.ts';
import { ApiError } from '../errors.ts';
import { downloadObject, FileTooBig, signedUploadUrl } from '../services/storage.ts';

const IMAGES = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
const KINDS = {
  photos: { types: /^image\/(jpeg|png|webp|heic)$/, extensions: IMAGES },
  imports: { types: /^(application\/(zip|octet-stream|x-zip-compressed)|text\/plain)$/, extensions: ['zip', 'ged', 'txt'] },
  chat: { types: /^(image\/(jpeg|png|webp|heic)|audio\/(aac|mp4|mpeg|m4a|webm))$/, extensions: [...IMAGES, 'aac', 'mp4', 'mp3', 'm4a', 'webm'] },
  posts: { types: /^image\/(jpeg|png|webp|heic)$/, extensions: IMAGES },
};
const MAX_IMPORT_BYTES = 100_000_000;

// An import file is read whole into memory (up to 100 MB, more once unzipped). On a 1 GB server two at once could
// run out of memory, so this server reads one at a time; the next one waits its turn instead of failing.
let importQueue: Promise<unknown> = Promise.resolve();
function oneImportAtATime<T>(work: () => Promise<T>): Promise<T> {
  const turn = importQueue.then(work, work);
  importQueue = turn.catch(() => undefined);
  return turn;
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/uploads/presign', async (req) => {
    const userId = await requireUser(req);
    const body = z
      .object({ kind: z.enum(['photos', 'imports', 'chat', 'posts']), content_type: z.string(), extension: z.string().regex(/^[a-z0-9]{1,8}$/) })
      .parse(req.body);
    const kind = KINDS[body.kind];
    if (!kind.types.test(body.content_type) || !kind.extensions.includes(body.extension)) throw new ApiError(422, 'file_type_not_allowed');
    // Everyone uploads only into a folder named after their own account.
    const path = `${body.kind}/${userId}/${randomUUID()}.${body.extension}`;
    // Listed so the size check can remove anything bigger than the folder allows (jobs/admin.ts).
    await asServer((db) => db.query(`insert into upload_log (path, profile_id, kind) values ($1, $2, $3)`, [path, userId, body.kind]));
    return { upload_url: await signedUploadUrl(path, body.content_type), path };
  });

  // LLD L5 no. 15: reads an uploaded file and returns a preview to correct. Nothing joins a tree until import_commit.
  app.post('/import/upload', async (req) => {
    const userId = await requireUser(req);
    const body = z.object({ source: z.enum(['lighten', 'gedcom']), file_path: z.string().max(300) }).parse(req.body);
    if (!body.file_path.startsWith(`imports/${userId}/`) || body.file_path.includes('..')) throw new ApiError(403, 'not_allowed');

    const preview = await oneImportAtATime(async () => {
      const bytes = await downloadObject(body.file_path, MAX_IMPORT_BYTES).catch((e: unknown) => {
        if (e instanceof FileTooBig) throw new ApiError(422, 'import_bad_file');
        throw new ApiError(404, 'import_file_not_found');
      });
      try {
        return body.source === 'lighten' ? readLightenZip(bytes) : readGedcom(new TextDecoder().decode(bytes));
      } catch {
        throw new ApiError(422, 'import_bad_file');
      }
    });
    const row = await asServer(async (db) => {
      const { rows } = await db.query(
        `insert into imports (created_by, source, file_path, preview) values ($1, $2, $3, $4) returning id`,
        [userId, body.source, body.file_path, JSON.stringify(preview)],
      );
      return rows[0];
    });
    return { import_id: row.id, preview };
  });
}

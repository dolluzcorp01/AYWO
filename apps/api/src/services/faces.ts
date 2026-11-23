// Account photos for lists that name people (Activity, Family plan members).
//
// Those lists come from database functions that return names only, so every face in them was drawn as a plain
// coloured figure even when the person had a photo. Call this only with accounts the caller is already shown by
// name: it adds a face to a name, it must never be the thing that reveals who someone is.
import { asServer } from '../db.ts';
import { signedReadUrls } from './storage.ts';

/** Account id -> short-lived link to their photo. Accounts without a photo are left out. */
export async function accountPhotoUrls(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  const found = new Map<string, string>();
  if (wanted.length === 0) return found;
  const rows = await asServer(async (db) => {
    const { rows } = await db.query(
      `select id, photo_path from profiles where id = any($1::uuid[]) and deleted_at is null and photo_path is not null`,
      [wanted],
    );
    return rows as { id: string; photo_path: string }[];
  });
  const links = await signedReadUrls(rows.map((row) => row.photo_path));
  for (const row of rows) {
    const link = links.get(row.photo_path);
    if (link) found.set(row.id, link);
  }
  return found;
}

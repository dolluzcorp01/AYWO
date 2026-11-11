// BUILD-CONTRACT 'Owned by tree': account, trees, persons, sharing, activity, history, merges, export, kin words,
// notifications. Everything runs as the caller, and the database functions in 0006 check rights themselves.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { writeGedcom } from '@aywo/gedcom';
import { languageChain } from '@aywo/shared';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { requireUser } from '../auth-tokens.ts';
import { config } from '../config.ts';
import { asCaller } from '../db.ts';
import { ApiError } from '../errors.ts';
import { signedReadUrl, signedReadUrls, uploadObject } from '../services/storage.ts';

const idParam = z.object({ id: z.uuid() });
const requestParam = z.object({ request_id: z.uuid() });

const isoDate = z.iso.date();
const isoMoment = z.iso.datetime({ offset: true });
const shortText = (max: number) => z.string().max(max).nullable().optional();

const personFields = z
  .object({
    display_name: z.string().trim().min(1).max(200).optional(),
    name_unknown: z.boolean().optional(),
    note_label: shortText(200),
    gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
    living: z.enum(['living', 'deceased', 'unknown']).optional(),
    birth_date: isoDate.nullable().optional(),
    death_date: isoDate.nullable().optional(),
    birth_precision: z.enum(['exact', 'month', 'year', 'about', 'unknown']).nullable().optional(),
    death_precision: z.enum(['exact', 'month', 'year', 'about', 'unknown']).nullable().optional(),
    birth_place: shortText(300),
    death_place: shortText(300),
    birth_order: z.number().int().min(1).max(1000).nullable().optional(),
    notes: shortText(10000),
    photo_path: z.string().max(300).nullable().optional(),
  })
  .strict();

const shareRole = z.enum(['viewer', 'commenter', 'editor', 'co_creator']);
const editMode = z.enum(['direct', 'approval']);

function e164(input: string): string {
  const parsed = parsePhoneNumberFromString(input);
  if (!parsed || !parsed.isValid()) throw new ApiError(422, 'phone_invalid');
  return parsed.number;
}

function linkUrl(token: string | null | undefined): string | null {
  return token ? `${config.WEB_URL}/link/${token}` : null;
}

/** One database function that returns jsonb. Names here are all fixed text in this file. */
async function call<T = unknown>(db: PoolClient, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query(`select ${sql} as result`, params);
  return rows[0].result as T;
}

interface ExportPerson {
  id: string;
  display_name: string;
  name_unknown: boolean;
  note_label: string | null;
  gender: 'male' | 'female' | 'other' | 'unknown';
  living: 'living' | 'deceased' | 'unknown';
  birth_date: string | null;
  death_date: string | null;
  birth_precision: 'exact' | 'month' | 'year' | 'about' | 'unknown' | null;
  death_precision: 'exact' | 'month' | 'year' | 'about' | 'unknown' | null;
  birth_place: string | null;
  death_place: string | null;
  birth_order: number | null;
  notes: string | null;
}

/** Reads a tree for export and builds the file. F-IO-02: those who run the tree. Contacts are never read. */
async function buildGedcom(userId: string, treeId: string, includeLiving: boolean): Promise<string> {
  return asCaller(userId, async (db) => {
    if (!(await call<boolean>(db, 'is_creator_or_cocreator($1)', [treeId]))) throw new ApiError(403, 'not_allowed');
    const tree = (await db.query(`select name from trees where id = $1`, [treeId])).rows[0];
    if (!tree) throw new ApiError(404, 'tree_not_found');
    const persons = (
      await db.query(
        `select id, display_name, name_unknown, note_label, gender, living, birth_date::text as birth_date, death_date::text as death_date,
           birth_precision, death_precision, birth_place, death_place, birth_order, notes
         from persons where tree_id = $1 and deleted_at is null order by created_at, id`,
        [treeId],
      )
    ).rows as ExportPerson[];
    const unions = (
      await db.query(
        `select id, partner1_id, partner2_id, kind, status, start_date::text as start_date, end_date::text as end_date
         from unions where tree_id = $1`,
        [treeId],
      )
    ).rows;
    const links = (await db.query(`select parent_id, child_id, union_id, kind from parent_child where tree_id = $1`, [treeId])).rows;
    return writeGedcom({ treeName: tree.name as string, persons, unions, links }, { includeLiving });
  });
}

/** The stored path stays on the server; the app gets a short-lived link. */
async function withPhotoUrl(account: { photo_path?: string | null }) {
  const { photo_path: path, ...rest } = account;
  return { ...rest, photo_url: path ? await signedReadUrl(path) : null };
}

interface ClaimDetails {
  photo_path: string | null;
  [key: string]: unknown;
}

export async function treeEditRoutes(app: FastifyInstance): Promise<void> {
  // ===== Me =====

  app.get('/me', async (req) => {
    const userId = await requireUser(req);
    return withPhotoUrl(await asCaller(userId, (db) => call<{ photo_path?: string | null }>(db, 'my_account()')));
  });

  app.patch('/me', async (req) => {
    const userId = await requireUser(req);
    const body = z
      .object({
        display_name: z.string().trim().min(1).max(200).optional(),
        email: z.string().trim().max(300).nullable().optional(),
        language_code: z.string().max(20).optional(),
        large_text: z.boolean().optional(),
        photo_path: z.string().max(300).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    return withPhotoUrl(await asCaller(userId, (db) => call<{ photo_path?: string | null }>(db, 'me_update($1::jsonb)', [JSON.stringify(body)])));
  });

  // Wireframe B2. Only entries the caller's verified number already matched, and never a contact value.
  app.post('/claim-candidates', async (req) => {
    const userId = await requireUser(req);
    const rows = await asCaller(userId, (db) => call<ClaimDetails[]>(db, 'claim_candidate_details()'));
    const photos = await signedReadUrls(rows.map((row) => row.photo_path));
    return rows.map(({ photo_path: path, ...row }) => ({ ...row, photo_url: path ? (photos.get(path) ?? null) : null }));
  });

  app.post('/me/consents', async (req) => {
    const userId = await requireUser(req);
    const body = z.object({ kind: z.enum(['terms', 'privacy', 'parental']), version: z.string().min(1).max(40) }).parse(req.body);
    await asCaller(userId, (db) =>
      db.query(`insert into consents (profile_id, kind, version) values ($1, $2, $3) on conflict do nothing`, [userId, body.kind, body.version]),
    );
    return { ok: true };
  });

  // ===== Trees =====

  app.get('/trees', async (req) => {
    const userId = await requireUser(req);
    return asCaller(userId, (db) => call(db, 'my_trees()'));
  });

  app.post('/trees', async (req) => {
    const userId = await requireUser(req);
    const body = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
    return asCaller(userId, (db) => call(db, 'tree_create($1)', [body.name]));
  });

  app.patch('/trees/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ name: z.string().trim().min(1).max(200).optional(), successor_id: z.uuid().nullable().optional() })
      .strict()
      .parse(req.body);
    await asCaller(userId, (db) => call(db, 'tree_update($1, $2::jsonb)', [id, JSON.stringify(body)]));
    return { ok: true };
  });

  app.delete('/trees/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    await asCaller(userId, (db) => call(db, 'tree_delete($1)', [id]));
    return { ok: true };
  });

  // For those who run the tree: who has joined, who it is shared with, and the current successor.
  app.get('/trees/:id/members', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    return asCaller(userId, (db) => call(db, 'tree_members($1)', [id]));
  });

  // Row rules decide who is found: a branch share finds only its branch.
  app.get('/trees/:id/search', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(req.query);
    return asCaller(userId, async (db) => {
      const { rows } = await db.query(
        `with term as (select aywo_normalize($2) as t)
         select p.id, p.display_name as name
         from persons p, term
         where p.tree_id = $1 and p.deleted_at is null
           and (p.name_normalized like '%' || replace(replace(replace(term.t, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
                or extensions.similarity(p.name_normalized, term.t) > 0.3)
         order by extensions.similarity(p.name_normalized, term.t) desc, p.display_name
         limit 20`,
        [id, q],
      );
      return rows;
    });
  });

  // ===== Persons =====

  // The answer is {status: 'saved', id, version}, or {status: 'requested', request_id} for anyone who must ask first.
  app.patch('/persons/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const raw = z.object({ version: z.number().int().min(1) }).passthrough().parse(req.body);
    const { version, ...rest } = raw;
    const fields = personFields.parse(rest);
    return asCaller(userId, (db) => call(db, 'person_update($1, $2, $3::jsonb)', [id, version, JSON.stringify(fields)]));
  });

  app.delete('/persons/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const { version } = z.object({ version: z.coerce.number().int().min(1).optional() }).parse(req.query);
    return asCaller(userId, (db) => call(db, 'person_delete($1, $2)', [id, version ?? null]));
  });

  app.get('/persons/:id/contacts-for-edit', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    return asCaller(userId, (db) => call(db, 'contacts_for_edit($1)', [id]));
  });

  app.get('/persons/:id/comments', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    return asCaller(userId, (db) => call(db, 'person_comments($1)', [id]));
  });

  app.post('/persons/:id/comments', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    return asCaller(userId, (db) => call(db, 'comment_add($1, $2)', [id, body.body]));
  });

  // ===== Sharing =====

  app.get('/trees/:id/shares', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const rows = await asCaller(userId, (db) => call<{ link_token: string | null }[]>(db, 'tree_shares($1)', [id]));
    return rows.map(({ link_token, ...share }) => ({ ...share, link_url: linkUrl(link_token) }));
  });

  app.post('/trees/:id/shares', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        scope_person_id: z.uuid().nullable().optional(),
        grantee_person_id: z.uuid().nullable().optional(),
        grantee_phone: z.string().max(30).nullable().optional(),
        role: shareRole,
        edit_mode: editMode.default('direct'),
        contacts_visible: z.boolean().default(false),
        expires_at: isoMoment.nullable().optional(),
      })
      .parse(req.body);
    const phone = body.grantee_phone ? e164(body.grantee_phone) : null;
    const share = await asCaller(userId, (db) =>
      call<{ id: string; link_token: string }>(
        db,
        `share_create(p_tree => $1, p_role => $2::share_role_t, p_edit_mode => $3::edit_mode_t, p_contacts_visible => $4,
           p_scope_person => $5, p_grantee_person => $6, p_grantee_phone => $7, p_expires_at => $8)`,
        [id, body.role, body.edit_mode, body.contacts_visible, body.scope_person_id ?? null, body.grantee_person_id ?? null, phone, body.expires_at ?? null],
      ),
    );
    return { id: share.id, link_url: linkUrl(share.link_token) };
  });

  app.patch('/shares/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        role: shareRole.optional(),
        edit_mode: editMode.optional(),
        contacts_visible: z.boolean().optional(),
        expires_at: isoMoment.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    await asCaller(userId, (db) => call(db, 'share_update($1, $2::jsonb)', [id, JSON.stringify(body)]));
    return { ok: true };
  });

  app.delete('/shares/:id', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    await asCaller(userId, (db) => call(db, 'share_revoke($1)', [id]));
    return { ok: true };
  });

  // ===== Activity and requests =====

  app.get('/activity', async (req) => {
    const userId = await requireUser(req);
    const { tab } = z.object({ tab: z.enum(['needs_you', 'changes', 'access', 'all']).default('all') }).parse(req.query);
    return asCaller(userId, (db) => call(db, 'activity_feed($1)', [tab]));
  });

  app.post('/requests/:id/decide', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ decision: z.enum(['approve', 'decline']), edited_payload: z.record(z.string(), z.unknown()).nullable().optional() })
      .parse(req.body);
    return asCaller(userId, (db) =>
      call(db, 'requests_decide($1, $2, $3::jsonb)', [id, body.decision, body.edited_payload ? JSON.stringify(body.edited_payload) : null]),
    );
  });

  // ===== History =====

  app.get('/trees/:id/history', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const query = z
      .object({ person_id: z.uuid().optional(), before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).optional() })
      .parse(req.query);
    return asCaller(userId, (db) =>
      call(db, 'history_list($1, $2, $3, $4)', [id, query.person_id ?? null, query.limit ?? 100, query.before ?? null]),
    );
  });

  app.post('/history/revert', async (req) => {
    const userId = await requireUser(req);
    const body = z
      .object({ history_id: z.coerce.number().int().positive().optional(), batch_id: z.uuid().optional() })
      .refine((b) => (b.history_id === undefined) !== (b.batch_id === undefined))
      .parse(req.body);
    return asCaller(userId, (db) => call(db, 'history_revert($1, $2)', [body.history_id ?? null, body.batch_id ?? null]));
  });

  // ===== Merges =====

  app.post('/trees/:id/merge-scan', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    return asCaller(userId, (db) => call(db, 'merge_scan($1)', [id]));
  });

  app.get('/merge/:request_id', async (req) => {
    const userId = await requireUser(req);
    const { request_id: requestId } = requestParam.parse(req.params);
    const preview = await asCaller(userId, (db) =>
      call<{ people: { photo_path: string | null }[] }>(db, 'merge_preview($1)', [requestId]),
    );
    const photos = await signedReadUrls(preview.people.map((p) => p.photo_path));
    return {
      ...preview,
      people: preview.people.map(({ photo_path: path, ...person }) => ({ ...person, photo_url: path ? (photos.get(path) ?? null) : null })),
    };
  });

  app.post('/merge/:request_id/apply', async (req) => {
    const userId = await requireUser(req);
    const { request_id: requestId } = requestParam.parse(req.params);
    const body = z.object({ keep_person_id: z.uuid().optional() }).parse(req.body ?? {});
    return asCaller(userId, (db) => call(db, 'merge_apply($1, $2)', [requestId, body.keep_person_id ?? null]));
  });

  // ===== Export =====

  const exportQuery = z.object({ include_living: z.enum(['0', '1']).default('0') });

  app.get('/trees/:id/export.ged', async (req, reply) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    const { include_living: living } = exportQuery.parse(req.query);
    const file = await buildGedcom(userId, id, living === '1');
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', 'attachment; filename="family-tree.ged"')
      .send(file);
  });

  app.get('/trees/:id/export-link', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    // The PDF picture is made in the app (F6), which has a font for every script. The server only hands out GEDCOM.
    const query = exportQuery.extend({ format: z.literal('gedcom').default('gedcom') }).parse(req.query);
    const file = await buildGedcom(userId, id, query.include_living === '1');
    const path = `exports/${userId}/${randomUUID()}.ged`;
    await uploadObject(path, file, 'text/plain; charset=utf-8');
    return { url: await signedReadUrl(path) };
  });

  // ===== Kinship words =====

  app.get('/kin/suggest', async (req) => {
    const userId = await requireUser(req);
    // path: only the words for this one relationship, which is what the word screen shows.
    const query = z
      .object({ lang: z.string().max(20).default('en'), q: z.string().trim().max(100).default(''), path: z.string().max(60).default('') })
      .parse(req.query);
    return asCaller(userId, async (db) => {
      const { rows } = await db.query(
        `select id, path_code, language_code, term, term_native, status, is_default
         from kin_terms
         where language_code = any($1) and status <> 'rejected'
           and ($3 = '' or path_code = $3)
           and ($2 = '' or normalized_term like '%' || replace(replace(replace(aywo_normalize($2), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
         order by is_default desc, term
         limit 30`,
        [languageChain(query.lang), query.q, query.path],
      );
      return rows;
    });
  });

  // T-KIN-01: a word that is already there, typed differently, is the same word and not a new one.
  app.post('/kin/terms', async (req) => {
    const userId = await requireUser(req);
    const body = z
      .object({ path_code: z.string().min(1).max(60), language_code: z.string().min(1).max(20), term: z.string().trim().min(1).max(120) })
      .parse(req.body);
    return asCaller(userId, async (db) => {
      const existing = await db.query(
        `select id, status from kin_terms where path_code = $1 and language_code = $2 and normalized_term = aywo_normalize($3) limit 1`,
        [body.path_code, body.language_code, body.term],
      );
      if (existing.rows[0]) return { ...existing.rows[0], existed: true };
      const { rows } = await db.query(
        `insert into kin_terms (path_code, language_code, term, submitted_by) values ($1, $2, $3, $4) returning id, status`,
        [body.path_code, body.language_code, body.term, userId],
      );
      return { ...rows[0], existed: false };
    });
  });

  app.post('/kin/reports', async (req) => {
    const userId = await requireUser(req);
    const body = z.object({ kin_term_id: z.uuid(), suggestion: z.string().trim().max(500).nullable().optional() }).parse(req.body);
    return asCaller(userId, async (db) => {
      const { rows } = await db.query(
        `insert into term_reports (kin_term_id, reporter_id, suggestion) values ($1, $2, $3) returning id`,
        [body.kin_term_id, userId, body.suggestion ?? null],
      );
      return rows[0];
    });
  });

  // ===== Notifications =====

  app.get('/notifications', async (req) => {
    const userId = await requireUser(req);
    return asCaller(userId, async (db) => {
      const { rows } = await db.query(
        `select id, kind, payload, read_at, created_at from notifications where recipient_id = $1 order by created_at desc limit 100`,
        [userId],
      );
      return rows;
    });
  });

  app.post('/notifications/:id/read', async (req) => {
    const userId = await requireUser(req);
    const { id } = idParam.parse(req.params);
    await asCaller(userId, (db) => db.query(`update notifications set read_at = coalesce(read_at, now()) where id = $1`, [id]));
    return { ok: true };
  });

  app.get('/notification-prefs', async (req) => {
    const userId = await requireUser(req);
    return asCaller(userId, async (db) => {
      const { rows } = await db.query(`select kind, push, sms, email from notification_prefs where profile_id = $1 order by kind`, [userId]);
      return rows;
    });
  });

  // One {kind, push?, sms?, email?} or a list of them. A kind with no row yet starts from the table's defaults.
  app.patch('/notification-prefs', async (req) => {
    const userId = await requireUser(req);
    const one = z.object({
      kind: z.string().regex(/^[a-z0-9_]{1,60}$/),
      push: z.boolean().optional(),
      sms: z.boolean().optional(),
      email: z.boolean().optional(),
    });
    const parsed = z.union([one, z.array(one).max(100)]).parse(req.body);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return asCaller(userId, async (db) => {
      for (const p of list) {
        await db.query(
          `insert into notification_prefs (profile_id, kind, push, sms, email)
           values ($1, $2, coalesce($3::boolean, true), coalesce($4::boolean, false), coalesce($5::boolean, true))
           on conflict (profile_id, kind) do update set
             push = coalesce($3::boolean, notification_prefs.push),
             sms = coalesce($4::boolean, notification_prefs.sms),
             email = coalesce($5::boolean, notification_prefs.email)`,
          [userId, p.kind, p.push ?? null, p.sms ?? null, p.email ?? null],
        );
      }
      const { rows } = await db.query(`select kind, push, sms, email from notification_prefs where profile_id = $1 order by kind`, [userId]);
      return rows;
    });
  });

  // ===== Account =====

  app.post('/account/export', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const userId = await requireUser(req);
    const data = await asCaller(userId, (db) => call(db, 'account_export()'));
    const path = `exports/${userId}/${randomUUID()}.json`;
    await uploadObject(path, JSON.stringify(data, null, 2), 'application/json');
    return { url: await signedReadUrl(path) };
  });

  // Books the deletion for 30 days ahead and signs out everywhere (0014). The daily account_deletions job deletes.
  app.post('/account/delete', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const userId = await requireUser(req);
    // 409 plan_cancel_first until a payer whose plan will renew has seen the warning (settings/privacy.tsx).
    const body = z.object({ plan_acknowledged: z.boolean().default(false) }).parse(req.body ?? {});
    return asCaller(userId, (db) => call(db, 'account_delete_request($1)', [body.plan_acknowledged]));
  });

  // "Keep my account": cancels a booked deletion.
  app.post('/account/keep', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const userId = await requireUser(req);
    return withPhotoUrl(await asCaller(userId, (db) => call<{ photo_path?: string | null }>(db, 'account_delete_cancel()')));
  });
}

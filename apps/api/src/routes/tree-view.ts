// LLD L5 nos. 5 and 6: the tree for family, and the tree through a shared link.
import type { FastifyInstance } from 'fastify';
import { labelTree } from '@aywo/kinship';
import type { KinGraph, KinTerm } from '@aywo/kinship';
import { branchIds, languageChain, toMemberNode, toOutsiderNode } from '@aywo/shared';
import type { Gender, PersonRow } from '@aywo/shared';
import { z } from 'zod';
import { optionalUser, requireUser } from '../auth-tokens.ts';
import { asCaller, asServer } from '../db.ts';
import { ApiError } from '../errors.ts';
import { signedReadUrls } from '../services/storage.ts';

const PERSON_FIELDS = `id, display_name, name_unknown, note_label, gender, living, birth_date, death_date, birth_precision,
  death_precision, birth_place, death_place, birth_order, photo_path, notes, claimed_by, version`;

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

export async function treeViewRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tree-view', async (req) => {
    const body = z
      .object({
        tree_id: z.uuid(),
        mode: z.enum(['names', 'mine', 'see_as']).default('mine'),
        lang: z.string().default('en'),
        focus_person_id: z.uuid().optional(),
      })
      .parse(req.body);
    const userId = await requireUser(req);

    // Reads as the caller, so a branch share gets only its branch.
    const answer = await asCaller(userId, async (db) => {
      const canView = await db.query(`select can_view_tree($1) as ok`, [body.tree_id]);
      if (!canView.rows[0].ok) throw new ApiError(404, 'tree_not_found');
      const role = (await db.query(`select tree_role($1) as role`, [body.tree_id])).rows[0].role as string;
      const tree = (await db.query(`select id, name, creator_person_id from trees where id = $1`, [body.tree_id])).rows[0];
      const persons = (await db.query(`select ${PERSON_FIELDS} from persons where tree_id = $1 and deleted_at is null`, [body.tree_id])).rows as PersonRow[];
      const unions = (await db.query(`select id, partner1_id, partner2_id, seq1, kind, status, version, start_date from unions where tree_id = $1`, [body.tree_id])).rows;
      const links = (await db.query(`select parent_id, child_id, union_id, kind from parent_child where tree_id = $1`, [body.tree_id])).rows;
      const contacts = (await db.query(`select tree_contacts($1) as c`, [body.tree_id])).rows[0].c;

      // Whose place are the words from? Your own card; 'see as' is for those who run the tree.
      // The Creator's card is 'you' only for the Creator: an invited relative with no card has no place to look from yet.
      let viewerPersonId: string | null =
        persons.find((p) => p.claimed_by === userId)?.id ?? (role === 'creator' ? tree.creator_person_id : null) ?? null;
      if (body.mode === 'see_as') {
        if (role !== 'creator' && role !== 'co_creator') throw new ApiError(403, 'not_allowed');
        viewerPersonId = body.focus_person_id ?? null;
      }

      let labels = {};
      if (body.mode !== 'names' && viewerPersonId && persons.some((p) => p.id === viewerPersonId)) {
        const chain = languageChain(body.lang);
        const termRows = (
          await db.query(
            `select id, path_code, language_code, term, term_native, speaker_gender, is_default, status
             from kin_terms where language_code = any($1) and status in ('ai_seeded', 'verified')`,
            [[...chain, 'en']],
          )
        ).rows;
        const terms: KinTerm[] = termRows.map((t) => ({
          id: t.id,
          pathCode: t.path_code,
          language: t.language_code,
          term: t.term,
          native: t.term_native,
          speakerGender: t.speaker_gender,
          isDefault: t.is_default,
          status: t.status,
        }));
        const graph: KinGraph = {
          persons: persons.map((p) => ({ id: p.id, gender: p.gender as Gender, birthOrder: p.birth_order, birthDate: p.birth_date })),
          unions: unions.map((u) => ({ id: u.id, partner1Id: u.partner1_id, partner2Id: u.partner2_id })),
          parentLinks: links.map((l) => ({ parentId: l.parent_id, childId: l.child_id, kind: l.kind })),
        };
        labels = labelTree(graph, viewerPersonId, { languages: chain, terms });
      }
      return { tree, role, persons, unions, links, contacts, labels, viewerPersonId };
    });

    const photos = await signedReadUrls(answer.persons.map((p) => p.photo_path));
    return {
      tree: { id: answer.tree.id, name: answer.tree.name },
      role: answer.role,
      viewer_person_id: answer.viewerPersonId,
      nodes: answer.persons.map((p) => toMemberNode(p, p.photo_path ? (photos.get(p.photo_path) ?? null) : null)),
      unions: answer.unions,
      links: answer.links,
      labels: answer.labels,
      contacts: answer.contacts,
    };
  });

  // Anyone with the link, signed in or not. Outsiders get names and photos only, built through toOutsiderNode.
  // No dates, notes or contact details are even read.
  app.get<{ Params: { token: string } }>(
    '/view-by-link/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const { token } = req.params;
      // One answer for every bad link, so links cannot be guessed by trying them.
      if (!TOKEN.test(token)) throw new ApiError(404, 'link_not_found');

      const data = await asServer(async (db) => {
        const share = (
          await db.query(
            `select id, tree_id, scope_person_id, created_by from shares
             where link_token = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
            [token],
          )
        ).rows[0];
        if (!share) throw new ApiError(404, 'link_not_found');
        const tree = (await db.query(`select name from trees where id = $1 and deleted_at is null`, [share.tree_id])).rows[0];
        if (!tree) throw new ApiError(404, 'link_not_found');
        const sharedBy = (await db.query(`select display_name from profiles where id = $1`, [share.created_by])).rows[0];
        const persons = (await db.query(`select id, display_name, name_unknown, photo_path from persons where tree_id = $1 and deleted_at is null`, [share.tree_id])).rows;
        const unions = (await db.query(`select id, partner1_id, partner2_id, seq1 from unions where tree_id = $1`, [share.tree_id])).rows;
        const links = (await db.query(`select parent_id, child_id, union_id from parent_child where tree_id = $1`, [share.tree_id])).rows;
        let inScope: Set<string> | null = null;
        if (share.scope_person_id) {
          const below = (await db.query(`select descendant_id from person_closure where ancestor_id = $1`, [share.scope_person_id])).rows;
          inScope = branchIds(below.map((r) => r.descendant_id as string), unions);
        }
        return { share, tree, sharedBy, persons, unions, links, inScope };
      });

      // Family who are signed in go to their own view instead.
      const userId = await optionalUser(req);
      if (userId) {
        const canView = await asCaller(userId, async (db) => (await db.query(`select can_view_tree($1) as ok`, [data.share.tree_id])).rows[0].ok as boolean);
        if (canView) return { mode: 'member', tree_id: data.share.tree_id };
      }

      const allowed = (id: string | null) => id !== null && (!data.inScope || data.inScope.has(id));
      const rows = (data.persons as PersonRow[]).filter((p) => allowed(p.id));
      const photos = await signedReadUrls(rows.map((p) => p.photo_path));
      return {
        mode: 'outsider',
        tree_name: data.tree.name,
        shared_by: data.sharedBy?.display_name ?? null,
        nodes: rows.map((p) => toOutsiderNode(p, p.photo_path ? (photos.get(p.photo_path) ?? null) : null)),
        unions: data.unions.filter((u) => allowed(u.partner1_id) && (!u.partner2_id || allowed(u.partner2_id))),
        links: data.links.filter((l) => allowed(l.parent_id) && allowed(l.child_id)),
      };
    },
  );
}

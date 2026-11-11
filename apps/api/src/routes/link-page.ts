// The family link (aywo.in/link/<token>) with a WhatsApp preview card.
// WhatsApp, Telegram and others read the page's <meta property="og:..."> tags to draw a card. The web app is one
// shared index.html, so this route serves that same page with the card tags added for this link: the same answer
// for a person and a link bot, so nothing differs by who asks. In production, aywo.in/link/* is routed here
// (.do/app.yaml); everything else on aywo.in is the web app.
//
// The card shows only what anyone holding the link already sees on the page: the tree's name, who shared it and
// how many people are in view. A revoked, expired or unknown link gets the plain AYWO card.
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { branchIds } from '@aywo/shared';
import { config } from '../config.ts';
import { asServer } from '../db.ts';
import { generations, previewTags, previewText, withPreview } from '../services/link-preview.ts';
import type { LinkPreview } from '../services/link-preview.ts';

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const CARD_IMAGE = readFileSync(new URL('../../assets/link-card.png', import.meta.url));
const SHELL_TTL_MS = 5 * 60_000;

const GENERIC: LinkPreview = {
  title: "AYWO - Across years, we're one",
  description: 'Your family tree, in your language, with everyone in it.',
};

let shellCache: { html: string; at: number } | null = null;

/** The web app's index.html from the web host, kept for a few minutes. Null when it cannot be reached. */
async function webShell(): Promise<string | null> {
  if (shellCache && Date.now() - shellCache.at < SHELL_TTL_MS) return shellCache.html;
  try {
    const res = await fetch(`${config.WEB_URL}/`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return shellCache?.html ?? null;
    const html = await res.text();
    shellCache = { html, at: Date.now() };
    return html;
  } catch {
    return shellCache?.html ?? null;
  }
}

async function previewFor(token: string): Promise<LinkPreview> {
  if (!TOKEN.test(token)) return GENERIC;
  return asServer(async (db) => {
    const share = (
      await db.query(
        `select tree_id, scope_person_id, created_by from shares
         where link_token = $1 and revoked_at is null and (expires_at is null or expires_at > now())`,
        [token],
      )
    ).rows[0];
    if (!share) return GENERIC;
    const tree = (await db.query(`select name from trees where id = $1 and deleted_at is null`, [share.tree_id])).rows[0];
    if (!tree) return GENERIC;
    const sharedBy = (await db.query(`select display_name from profiles where id = $1`, [share.created_by])).rows[0];
    const persons = (await db.query(`select id from persons where tree_id = $1 and deleted_at is null`, [share.tree_id])).rows;
    const links = (await db.query(`select parent_id, child_id from parent_child where tree_id = $1`, [share.tree_id])).rows;
    let ids = persons.map((p) => p.id as string);
    if (share.scope_person_id) {
      // A link for one branch counts only that branch, as the page itself shows only that branch.
      const unions = (await db.query(`select id, partner1_id, partner2_id, seq1 from unions where tree_id = $1`, [share.tree_id])).rows;
      const below = (await db.query(`select descendant_id from person_closure where ancestor_id = $1`, [share.scope_person_id])).rows;
      const inScope = branchIds(below.map((r) => r.descendant_id as string), unions);
      ids = ids.filter((id) => inScope.has(id));
    }
    const shown = new Set(ids);
    const gens = generations(ids, links.filter((l) => shown.has(l.parent_id) && shown.has(l.child_id)));
    return previewText(tree.name, sharedBy?.display_name || null, ids.length, gens);
  });
}

function fallbackPage(tags: string): string {
  // Only when the web app cannot be fetched: the card still works, and the page asks to try again.
  return `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    ${tags}\n  </head>\n  <body style="font-family: sans-serif; padding: 24px">\n    <p>AYWO is busy for a moment. Please open this link again.</p>\n  </body>\n</html>\n`;
}

export async function linkPageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { token: string } }>(
    '/link/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = req.params;
      const preview = await previewFor(token).catch(() => GENERIC);
      const tags = previewTags(preview, `${config.WEB_URL}/link/${encodeURIComponent(token)}`, `${config.PUBLIC_URL}/link-card.png`);
      const shell = await webShell();
      reply
        .header('content-type', 'text/html; charset=utf-8')
        // Short: a revoked link should lose its family details quickly.
        .header('cache-control', 'public, max-age=300');
      return shell ? withPreview(shell, tags) : fallbackPage(tags);
    },
  );

  app.get('/link-card.png', async (_req, reply) => {
    reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=86400');
    return CARD_IMAGE;
  });
}

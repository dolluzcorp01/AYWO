// The WhatsApp preview card for a family link: escaping, counts and the <meta> tags. No database or settings here,
// so it can be tested on its own (link-preview.test.ts). The route is routes/link-page.ts.

export interface LinkPreview {
  title: string;
  description: string;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Names are typed by families: every value goes into the page escaped, so a name can never become page code. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Generations shown in the tree: the longest parent-to-child chain, counted in people. */
export function generations(ids: string[], links: { parent_id: string; child_id: string }[]): number {
  if (ids.length === 0) return 0;
  const children = new Map<string, string[]>();
  for (const l of links) children.set(l.parent_id, [...(children.get(l.parent_id) ?? []), l.child_id]);
  const memo = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 1; // A broken loop in the data must not hang the page.
    seen.add(id);
    const below = (children.get(id) ?? []).map((c) => depth(c, seen));
    seen.delete(id);
    const d = 1 + (below.length ? Math.max(...below) : 0);
    memo.set(id, d);
    return d;
  };
  return Math.max(...ids.map((id) => depth(id, new Set())));
}

export function previewText(treeName: string, sharedBy: string | null, people: number, gens: number): LinkPreview {
  const counts = `${people} ${people === 1 ? 'person' : 'people'}${gens > 1 ? ` · ${gens} generations` : ''}`;
  return {
    title: sharedBy ? `${sharedBy} invited you to ${treeName}` : `You're invited to ${treeName}`,
    description: `${counts} on AYWO. See the family and where you fit.`,
  };
}

/** The tags WhatsApp and others read, escaped. */
export function previewTags(preview: LinkPreview, pageUrl: string, imageUrl: string): string {
  const title = escapeHtml(preview.title);
  const description = escapeHtml(preview.description);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="AYWO" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join('\n    ');
}

/** The web app's own index.html, with its <title> swapped for the card tags. */
export function withPreview(shell: string, tags: string): string {
  const withoutTitle = shell.replace(/<title>[\s\S]*?<\/title>/i, '');
  return withoutTitle.replace(/<head([^>]*)>/i, (open) => `${open}\n    ${tags}`);
}

// Links that look half done, offered as a one-tap fix on a person's Family links.
import type { TreeViewAnswer } from '@/tree/useTreeView';

export interface Suggestion {
  key: string;
  parentId: string;
  childId: string;
}

/** Links that look half done: a child with one parent whose partner is not linked to them. */
export function linkSuggestions(data: Pick<TreeViewAnswer, 'nodes' | 'links' | 'unions'>, personId: string): Suggestion[] {
  const parentsOf = (id: string) => data.links.filter((l) => l.child_id === id).map((l) => l.parent_id);
  const partnersOf = (id: string) =>
    data.unions
      .filter((u) => u.partner1_id === id || u.partner2_id === id)
      .map((u) => (u.partner1_id === id ? u.partner2_id : u.partner1_id))
      .filter((p): p is string => !!p);
  const known = (id: string) => data.nodes.some((n) => n.id === id && !n.nameUnknown);
  const out: Suggestion[] = [];
  const add = (parentId: string, childId: string) => {
    const key = `${parentId}:${childId}`;
    if (known(parentId) && !out.some((s) => s.key === key)) out.push({ key, parentId, childId });
  };
  // This person has one parent, married to someone not linked to them.
  const mine = parentsOf(personId);
  if (mine.length === 1) for (const p of partnersOf(mine[0])) if (p !== personId) add(p, personId);
  // This person's partner has children who have only that partner as parent.
  for (const partner of partnersOf(personId)) {
    for (const l of data.links.filter((x) => x.parent_id === partner)) {
      const theirs = parentsOf(l.child_id);
      if (theirs.length === 1 && l.child_id !== personId) add(personId, l.child_id);
    }
  }
  return out;
}

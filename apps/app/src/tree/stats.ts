/** The longest line of parent to child, counted in generations: 38 people, 5 generations. */
export function generationCount(
  nodes: { id: string }[],
  links: { parent_id: string; child_id: string }[],
): number {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const link of links) {
    const list = childrenOf.get(link.parent_id);
    if (list) list.push(link.child_id);
    else childrenOf.set(link.parent_id, [link.child_id]);
    hasParent.add(link.child_id);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  function depth(id: string): number {
    const known = memo.get(id);
    if (known !== undefined) return known;
    // Bad data must not hang the screen.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 1;
    for (const child of childrenOf.get(id) ?? []) best = Math.max(best, depth(child) + 1);
    visiting.delete(id);
    memo.set(id, best);
    return best;
  }
  let most = 0;
  for (const node of nodes) if (!hasParent.has(node.id)) most = Math.max(most, depth(node.id));
  return most;
}

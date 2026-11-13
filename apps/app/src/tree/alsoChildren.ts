// Adding a mother or father: the brothers and sisters who could share them. The same rule as add_relative on the
// server: only someone whose one parent is the anchor's one parent (so a half brother with his own second parent is
// never offered). They start ticked; the person unticks anyone with a different mother or father.
interface Link {
  parent_id: string;
  child_id: string;
}

export function alsoChildCandidates<N extends { id: string }>(nodes: N[], links: Link[], anchorId: string): N[] {
  const parentsOf = (id: string) => links.filter((l) => l.child_id === id).map((l) => l.parent_id);
  const mine = parentsOf(anchorId);
  if (mine.length !== 1) return [];
  return nodes.filter((n) => {
    if (n.id === anchorId) return false;
    const theirs = parentsOf(n.id);
    return theirs.length === 1 && theirs[0] === mine[0];
  });
}

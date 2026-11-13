// 'My view' (wireframes A8, B3): one person in the centre, parents above, family below (children with their
// partners, then grandchildren). Tap anyone to re-centre.
import { bySiblingOrder, indexGraph, partnerOf } from './graph.ts';
import type { TreeGraph } from './graph.ts';

export interface FocusView {
  focusId: string;
  grandparents: { viaParentId: string; ids: string[] }[];
  parents: string[];
  partners: string[];
  siblings: string[];
  /** The brothers and sisters with the focus person among them, in birth order: a fixed order, so tapping someone
   * never moves them to another place in the row. */
  siblingRow: string[];
  children: string[];
  /** Each child's partner (the first one), so a grandparent sees the couple. */
  childPartners: { childId: string; ids: string[] }[];
  /** Each child's own children: the grandchildren, two levels down. */
  grandchildren: { childId: string; ids: string[] }[];
  siblingsChildren: { siblingId: string; ids: string[] }[];
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function focusView(graph: TreeGraph, focusId: string): FocusView {
  const index = indexGraph(graph);
  const parentsOf = (id: string) => index.parentsOf.get(id) ?? [];
  const childrenOf = (id: string) => (index.childLinks.get(id) ?? []).map((l) => l.childId);

  const partnersOf = (id: string) =>
    unique((index.unionsOf.get(id) ?? []).map((u) => partnerOf(u, id)).filter((p): p is string => p !== null));
  const parents = unique(parentsOf(focusId));
  const children = bySiblingOrder(index, unique(childrenOf(focusId)));
  const siblings = bySiblingOrder(
    index,
    unique(parents.flatMap(childrenOf)).filter((id) => id !== focusId),
  );
  return {
    focusId,
    parents,
    grandparents: parents
      .map((viaParentId) => ({ viaParentId, ids: unique(parentsOf(viaParentId)) }))
      .filter((g) => g.ids.length > 0),
    partners: partnersOf(focusId),
    siblings,
    siblingRow: bySiblingOrder(index, [...siblings, focusId]),
    children,
    childPartners: children.map((childId) => ({ childId, ids: partnersOf(childId) })).filter((g) => g.ids.length > 0),
    grandchildren: children
      .map((childId) => ({ childId, ids: bySiblingOrder(index, unique(childrenOf(childId))) }))
      .filter((g) => g.ids.length > 0),
    siblingsChildren: siblings
      .map((siblingId) => ({ siblingId, ids: bySiblingOrder(index, unique(childrenOf(siblingId))) }))
      .filter((g) => g.ids.length > 0),
  };
}

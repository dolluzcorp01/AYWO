// 'My view' (wireframes A8, B3): one person in the centre, parents above, family below. Tap anyone to re-centre.
import { bySiblingOrder, indexGraph, partnerOf } from './graph.ts';
import type { TreeGraph } from './graph.ts';

export interface FocusView {
  focusId: string;
  grandparents: { viaParentId: string; ids: string[] }[];
  parents: string[];
  partners: string[];
  siblings: string[];
  children: string[];
  siblingsChildren: { siblingId: string; ids: string[] }[];
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function focusView(graph: TreeGraph, focusId: string): FocusView {
  const index = indexGraph(graph);
  const parentsOf = (id: string) => index.parentsOf.get(id) ?? [];
  const childrenOf = (id: string) => (index.childLinks.get(id) ?? []).map((l) => l.childId);

  const parents = unique(parentsOf(focusId));
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
    partners: unique(
      (index.unionsOf.get(focusId) ?? []).map((u) => partnerOf(u, focusId)).filter((id) => id !== null),
    ),
    siblings,
    children: bySiblingOrder(index, unique(childrenOf(focusId))),
    siblingsChildren: siblings
      .map((siblingId) => ({ siblingId, ids: bySiblingOrder(index, unique(childrenOf(siblingId))) }))
      .filter((g) => g.ids.length > 0),
  };
}

// Shapes get-tree-view's answer into the graph the layout needs.
import type { TreeGraph } from './graph.ts';

/** The fields the layout reads from each person. Screens add more (photo, name unknown, and so on). */
export interface ApiNode {
  id: string;
  name: string;
  birthOrder?: number | null;
  birthDate?: string | null;
}

/** N is the screen's own node type, so its extra fields stay typed (an intersection of two arrays would lose them). */
export interface ApiTree<N extends ApiNode = ApiNode> {
  nodes: N[];
  unions: { id: string; partner1_id: string; partner2_id: string | null; seq1?: number | null }[];
  links: { parent_id: string; child_id: string; union_id: string | null }[];
}

export function graphFromApi(tree: ApiTree): TreeGraph {
  return {
    persons: tree.nodes.map((n) => ({ id: n.id, name: n.name, birthOrder: n.birthOrder, birthDate: n.birthDate })),
    unions: tree.unions.map((u) => ({ id: u.id, partner1Id: u.partner1_id, partner2Id: u.partner2_id, seq1: u.seq1 })),
    links: tree.links.map((l) => ({ parentId: l.parent_id, childId: l.child_id, unionId: l.union_id })),
  };
}

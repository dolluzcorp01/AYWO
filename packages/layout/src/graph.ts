export interface TreePerson {
  id: string;
  name?: string;
  birthOrder?: number | null;
  birthDate?: string | null;
}
export interface TreeUnion {
  id: string;
  partner1Id: string;
  partner2Id?: string | null;
  seq1?: number | null;
}
export interface TreeLink {
  parentId: string;
  childId: string;
  unionId?: string | null;
}
export interface TreeGraph {
  persons: TreePerson[];
  unions: TreeUnion[];
  links: TreeLink[];
}

export interface GraphIndex {
  people: Map<string, TreePerson>;
  parentsOf: Map<string, string[]>;
  childLinks: Map<string, TreeLink[]>;
  unionsOf: Map<string, TreeUnion[]>;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function indexGraph(graph: TreeGraph): GraphIndex {
  const index: GraphIndex = { people: new Map(), parentsOf: new Map(), childLinks: new Map(), unionsOf: new Map() };
  for (const p of graph.persons) index.people.set(p.id, p);
  for (const l of graph.links) {
    pushTo(index.parentsOf, l.childId, l.parentId);
    pushTo(index.childLinks, l.parentId, l);
  }
  for (const u of graph.unions) {
    pushTo(index.unionsOf, u.partner1Id, u);
    if (u.partner2Id) pushTo(index.unionsOf, u.partner2Id, u);
  }
  return index;
}

export function partnerOf(union: TreeUnion, id: string): string | null {
  return union.partner1Id === id ? (union.partner2Id ?? null) : union.partner1Id;
}

/** L7 step 3: birth order, then birth date, then name. */
export function bySiblingOrder(index: GraphIndex, ids: string[]): string[] {
  const rank = (v: number | null | undefined) => (v === null || v === undefined ? Number.MAX_SAFE_INTEGER : v);
  return ids.slice().sort((x, y) => {
    const a = index.people.get(x);
    const b = index.people.get(y);
    const order = rank(a?.birthOrder) - rank(b?.birthOrder);
    if (order !== 0) return order;
    const da = a?.birthDate ?? '9999';
    const db = b?.birthDate ?? '9999';
    if (da !== db) return da < db ? -1 : 1;
    return (a?.name ?? '').localeCompare(b?.name ?? '');
  });
}

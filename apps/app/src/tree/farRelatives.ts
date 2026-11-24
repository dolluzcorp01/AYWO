// "More relatives" on Add a relative: an uncle, a cousin, a grandparent, an in-law.
//
// The tree holds four links only: parent, partner, child, sibling. So an uncle is "a sibling of my father", and until
// now the person adding him had to know that, and to change whose relative they were adding first. People think
// "I want to add my mama", not "I want to add a sibling of my mother". Each choice here names the relative in family
// words and says which person it hangs from and by which of the four links.
import type { Relation } from '@/tree/useEdit';

interface Person {
  id: string;
  gender: string;
}
interface Link {
  parent_id: string;
  child_id: string;
}
interface Union {
  partner1_id: string;
  /** Empty when the other partner is not known. */
  partner2_id: string | null;
}
export interface FamilyShape {
  nodes: Person[];
  links: Link[];
  unions: Union[];
}

/** The people a far relative can hang from, seen from the person being added to. */
export type Through = 'father' | 'mother' | 'parentSibling' | 'sibling' | 'child' | 'partner';

export const FAR_RELATIVES = [
  { key: 'fatherParent', through: 'father', relation: 'parent' },
  { key: 'motherParent', through: 'mother', relation: 'parent' },
  { key: 'fatherSibling', through: 'father', relation: 'sibling' },
  { key: 'motherSibling', through: 'mother', relation: 'sibling' },
  { key: 'uncleAuntPartner', through: 'parentSibling', relation: 'spouse' },
  { key: 'cousin', through: 'parentSibling', relation: 'child' },
  { key: 'siblingPartner', through: 'sibling', relation: 'spouse' },
  { key: 'siblingChild', through: 'sibling', relation: 'child' },
  { key: 'childPartner', through: 'child', relation: 'spouse' },
  { key: 'grandchild', through: 'child', relation: 'child' },
  { key: 'partnerParent', through: 'partner', relation: 'parent' },
  { key: 'partnerSibling', through: 'partner', relation: 'sibling' },
] as const satisfies readonly { key: string; through: Through; relation: Relation }[];

export type FarRelative = (typeof FAR_RELATIVES)[number];

/** Everyone the relative could hang from. Empty when that person is not in the tree yet. */
export function throughPeople(family: FamilyShape, anchorId: string, through: Through): string[] {
  const { nodes, links, unions } = family;
  const known = new Set(nodes.map((n) => n.id));
  const genderOf = (id: string) => nodes.find((n) => n.id === id)?.gender;
  const parentsOf = (id: string) => links.filter((l) => l.child_id === id).map((l) => l.parent_id);
  const childrenOf = (id: string) => links.filter((l) => l.parent_id === id).map((l) => l.child_id);
  // Brothers and sisters, half ones too: anyone who shares a parent.
  const siblingsOf = (id: string) => unique(parentsOf(id).flatMap(childrenOf)).filter((other) => other !== id);

  let found: string[];
  if (through === 'father') found = parentsOf(anchorId).filter((id) => genderOf(id) === 'male');
  else if (through === 'mother') found = parentsOf(anchorId).filter((id) => genderOf(id) === 'female');
  else if (through === 'parentSibling') found = unique(parentsOf(anchorId).flatMap(siblingsOf));
  else if (through === 'sibling') found = siblingsOf(anchorId);
  else if (through === 'child') found = childrenOf(anchorId);
  else {
    found = unions
      .filter((u) => u.partner1_id === anchorId || u.partner2_id === anchorId)
      .map((u) => (u.partner1_id === anchorId ? u.partner2_id : u.partner1_id))
      .filter((id): id is string => !!id);
  }
  // The server may leave out people this viewer cannot see.
  return unique(found).filter((id) => known.has(id));
}

/**
 * A parent whose card does not say man or woman (the gender was never filled in, or it is a "Name unknown" stand-in)
 * may well be the father or mother being asked for. Before this the picker said "the father is not in the tree"
 * and offered to add him, which made a second father. These are offered as "is it one of these?" instead.
 * Empty when a parent of the asked-for gender is already known, or for any other kind of relative.
 */
export function maybeParents(family: FamilyShape, anchorId: string, through: Through): string[] {
  if (through !== 'father' && through !== 'mother') return [];
  if (throughPeople(family, anchorId, through).length > 0) return [];
  const known = new Set(family.nodes.map((n) => n.id));
  const genderOf = (id: string) => family.nodes.find((n) => n.id === id)?.gender;
  return unique(family.links.filter((l) => l.child_id === anchorId).map((l) => l.parent_id)).filter(
    (id) => known.has(id) && genderOf(id) !== 'male' && genderOf(id) !== 'female',
  );
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

// Which close family a person has not added yet: the order a new tree is built in (mother, father, partner, child).
// Drives the first-time family guide and the "Add your family" card. Pure, so it is easy to test and reuse.
import type { Relation } from '@/tree/useEdit';
import type { TreeViewAnswer } from '@/tree/useTreeView';

export type FamilyStep = 'mother' | 'father' | 'partner' | 'child';
export const FAMILY_STEPS: FamilyStep[] = ['mother', 'father', 'partner', 'child'];

/** The tree stops nudging once it has this many people: by then the family has found its own way in. */
export const GUIDE_UNTIL_PEOPLE = 5;

export interface StepTarget {
  step: FamilyStep;
  done: boolean;
  /** Add someone new next to `anchor` ... */
  relation: Relation;
  gender?: 'male' | 'female';
  /** ... or name the placeholder parent the tree already has (made when a brother or sister was added first). */
  personId?: string;
}

type Tree = Pick<TreeViewAnswer, 'nodes' | 'links' | 'unions'>;

export function familyGaps(tree: Tree, me: string): StepTarget[] {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const parents = tree.links.filter((l) => l.child_id === me).map((l) => byId.get(l.parent_id)).filter((n) => !!n);
  const named = parents.filter((p) => !p.nameUnknown);
  const placeholder = parents.find((p) => p.nameUnknown && p.gender !== 'male' && p.gender !== 'female');
  const hasMother = named.some((p) => p.gender === 'female');
  const hasFather = named.some((p) => p.gender === 'male');
  const hasPartner = tree.unions.some((u) => (u.partner1_id === me && !!u.partner2_id) || u.partner2_id === me);
  const hasChild = tree.links.some((l) => l.parent_id === me);
  // Two parents already, both named: nothing left to fill even if their genders were not set.
  const parentsFull = named.length >= 2;

  const parentStep = (step: 'mother' | 'father', done: boolean, gender: 'female' | 'male'): StepTarget => ({
    step,
    done: done || parentsFull,
    relation: 'parent',
    gender,
    ...(placeholder ? { personId: placeholder.id } : {}),
  });

  const mother = parentStep('mother', hasMother, 'female');
  const father = parentStep('father', hasFather, 'male');
  // One placeholder can become only one of them: once it is the mother, the father is a new person.
  if (placeholder && !mother.done && !father.done) delete father.personId;

  return [
    mother,
    father,
    { step: 'partner', done: hasPartner, relation: 'spouse' },
    { step: 'child', done: hasChild, relation: 'child' },
  ];
}

/** The add form for one step: a new person beside `me`, or the placeholder parent to name. */
export function stepRoute(treeId: string, me: string, target: StepTarget, back?: 'guide') {
  const extra = { ...(target.gender ? { gender: target.gender } : {}), ...(back ? { back } : {}) };
  if (target.personId) return { pathname: '/person-details' as const, params: { treeId, personId: target.personId, ...extra } };
  return {
    pathname: '/person-details' as const,
    params: { treeId, anchor: me, relation: target.relation, ...(target.relation === 'spouse' ? {} : { linkKind: 'birth' }), ...extra },
  };
}

/** Should this tree still show the "Add your family" card to this person? */
export function showFamilyGuide(tree: Tree, me: string | null): boolean {
  if (!me || tree.nodes.length >= GUIDE_UNTIL_PEOPLE) return false;
  return familyGaps(tree, me).some((s) => !s.done);
}

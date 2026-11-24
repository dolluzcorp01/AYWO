import { describe, expect, it } from 'vitest';
import { FAR_RELATIVES, maybeParents, throughPeople } from './farRelatives';

// me: father (dad) and mother (mom). dad has a brother (uncle) and a half sister (aunt, shares only grandpa).
// mom has no brother or sister. me has a sister (sis), a wife and a son.
const family = {
  nodes: [
    { id: 'me', gender: 'male' },
    { id: 'dad', gender: 'male' },
    { id: 'mom', gender: 'female' },
    { id: 'grandpa', gender: 'male' },
    { id: 'grandma', gender: 'female' },
    { id: 'uncle', gender: 'male' },
    { id: 'aunt', gender: 'female' },
    { id: 'sis', gender: 'female' },
    { id: 'wife', gender: 'female' },
    { id: 'son', gender: 'male' },
  ],
  links: [
    { parent_id: 'dad', child_id: 'me' },
    { parent_id: 'mom', child_id: 'me' },
    { parent_id: 'dad', child_id: 'sis' },
    { parent_id: 'mom', child_id: 'sis' },
    { parent_id: 'grandpa', child_id: 'dad' },
    { parent_id: 'grandma', child_id: 'dad' },
    { parent_id: 'grandpa', child_id: 'uncle' },
    { parent_id: 'grandma', child_id: 'uncle' },
    { parent_id: 'grandpa', child_id: 'aunt' },
    { parent_id: 'me', child_id: 'son' },
    { parent_id: 'wife', child_id: 'son' },
  ],
  unions: [
    { partner1_id: 'dad', partner2_id: 'mom' },
    { partner1_id: 'wife', partner2_id: 'me' },
  ],
};

describe('throughPeople', () => {
  it('finds the father and the mother by gender', () => {
    expect(throughPeople(family, 'me', 'father')).toEqual(['dad']);
    expect(throughPeople(family, 'me', 'mother')).toEqual(['mom']);
  });

  it("finds a parent's brothers and sisters once each, half ones too, and never the parent", () => {
    expect(throughPeople(family, 'me', 'parentSibling').sort()).toEqual(['aunt', 'uncle']);
  });

  it('finds brothers and sisters, children and partners', () => {
    expect(throughPeople(family, 'me', 'sibling')).toEqual(['sis']);
    expect(throughPeople(family, 'me', 'child')).toEqual(['son']);
    expect(throughPeople(family, 'me', 'partner')).toEqual(['wife']);
  });

  it('is empty when that person is not in the tree yet', () => {
    expect(throughPeople(family, 'grandpa', 'father')).toEqual([]);
    expect(throughPeople(family, 'son', 'child')).toEqual([]);
    expect(throughPeople(family, 'sis', 'partner')).toEqual([]);
  });

  it('does not take a parent of unknown gender for the father or the mother', () => {
    const unknown = { ...family, nodes: family.nodes.map((n) => (n.id === 'dad' ? { ...n, gender: 'unknown' } : n)) };
    expect(throughPeople(unknown, 'me', 'father')).toEqual([]);
  });

  it('leaves out people the server did not send', () => {
    const hidden = { ...family, nodes: family.nodes.filter((n) => n.id !== 'uncle') };
    expect(throughPeople(hidden, 'me', 'parentSibling')).toEqual(['aunt']);
  });
});

describe('FAR_RELATIVES', () => {
  it('names every relative once', () => {
    const keys = FAR_RELATIVES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('maybeParents', () => {
  // The father's card has no gender yet, as after an import or a quick add.
  const unsure = {
    nodes: [
      { id: 'me', gender: 'male' },
      { id: 'parent', gender: 'unknown' },
      { id: 'mom', gender: 'female' },
    ],
    links: [
      { parent_id: 'parent', child_id: 'me' },
      { parent_id: 'mom', child_id: 'me' },
    ],
    unions: [],
  };

  it('offers a parent with no gender as the father, so no second father is added', () => {
    expect(throughPeople(unsure, 'me', 'father')).toEqual([]);
    expect(maybeParents(unsure, 'me', 'father')).toEqual(['parent']);
  });

  it('does not ask when that parent is already known', () => {
    expect(maybeParents(unsure, 'me', 'mother')).toEqual([]);
    expect(maybeParents(family, 'me', 'father')).toEqual([]);
  });

  it('has nothing to offer when there is no such parent, or for other relatives', () => {
    expect(maybeParents(family, 'grandpa', 'father')).toEqual([]);
    expect(maybeParents(unsure, 'me', 'sibling')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { familyGaps, showFamilyGuide, stepRoute } from './familyGaps';

type Node = { id: string; name: string; nameUnknown: boolean; gender: string };
const person = (id: string, gender = 'unknown', nameUnknown = false): Node => ({ id, name: nameUnknown ? '' : id, nameUnknown, gender });
const tree = (nodes: Node[], links: [string, string][] = [], unions: [string, string | null][] = []) => ({
  nodes: nodes as never,
  links: links.map(([parent_id, child_id]) => ({ parent_id, child_id, union_id: null })),
  unions: unions.map(([partner1_id, partner2_id], i) => ({ id: `u${i}`, partner1_id, partner2_id })),
});
const done = (t: ReturnType<typeof tree>) => Object.fromEntries(familyGaps(t, 'me').map((s) => [s.step, s.done]));

describe('familyGaps', () => {
  it('a new tree with only me misses all four', () => {
    expect(done(tree([person('me')]))).toEqual({ mother: false, father: false, partner: false, child: false });
  });

  it('a named mother and father, a wife and a son: nothing missing', () => {
    const t = tree(
      [person('me', 'male'), person('amma', 'female'), person('appa', 'male'), person('wife', 'female'), person('son', 'male')],
      [['amma', 'me'], ['appa', 'me'], ['me', 'son']],
      [['me', 'wife']],
    );
    expect(done(t)).toEqual({ mother: true, father: true, partner: true, child: true });
    expect(showFamilyGuide(t, 'me')).toBe(false);
  });

  it('a partner counts on either side of the union, but a union without a partner does not', () => {
    expect(done(tree([person('me'), person('h')], [], [['h', 'me']])).partner).toBe(true);
    expect(done(tree([person('me')], [], [['me', null]])).partner).toBe(false);
  });

  it('the unknown parent made by adding a sister becomes the mother, and the father is then a new person', () => {
    const t = tree([person('me'), person('sis', 'female'), person('p', 'unknown', true)], [['p', 'me'], ['p', 'sis']]);
    const [mother, father] = familyGaps(t, 'me');
    expect(mother).toMatchObject({ step: 'mother', done: false, personId: 'p', gender: 'female' });
    expect(father.personId).toBeUndefined();
    expect(stepRoute('t1', 'me', mother)).toEqual({ pathname: '/person-details', params: { treeId: 't1', personId: 'p', gender: 'female' } });
  });

  it('with a named mother, the unknown parent becomes the father', () => {
    const t = tree([person('me'), person('amma', 'female'), person('p', 'unknown', true)], [['amma', 'me'], ['p', 'me']]);
    const [mother, father] = familyGaps(t, 'me');
    expect(mother.done).toBe(true);
    expect(father).toMatchObject({ done: false, personId: 'p', gender: 'male' });
  });

  it('two named parents with no gender set: both parent steps are done', () => {
    const t = tree([person('me'), person('a'), person('b')], [['a', 'me'], ['b', 'me']]);
    expect(done(t)).toMatchObject({ mother: true, father: true });
  });

  it('a new relative opens the add form beside me, by birth, with the gender and the way back', () => {
    const [mother, , partner] = familyGaps(tree([person('me')]), 'me');
    expect(stepRoute('t1', 'me', mother, 'guide')).toEqual({
      pathname: '/person-details',
      params: { treeId: 't1', anchor: 'me', relation: 'parent', linkKind: 'birth', gender: 'female', back: 'guide' },
    });
    expect(stepRoute('t1', 'me', partner).params).toEqual({ treeId: 't1', anchor: 'me', relation: 'spouse' });
  });

  it('the card goes away at 5 people even if steps are left', () => {
    const t = tree([person('me'), person('a'), person('b'), person('c'), person('d')]);
    expect(showFamilyGuide(t, 'me')).toBe(false);
    expect(showFamilyGuide(tree([person('me')]), 'me')).toBe(true);
    expect(showFamilyGuide(tree([person('me')]), null)).toBe(false);
  });
});

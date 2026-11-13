import { describe, expect, it } from 'vitest';
import { focusView } from './focus-view.ts';
import { cardsInView, layoutLineTree } from './line-tree.ts';
import type { TreeGraph } from './graph.ts';
import type { TreeLayout } from './line-tree.ts';

function links(parents: string[], children: string[], unionId: string | null) {
  const out = [];
  for (const parentId of parents) for (const childId of children) out.push({ parentId, childId, unionId });
  return out;
}
function people(...ids: string[]) {
  return ids.map((id) => ({ id, name: id }));
}
function spot(layout: TreeLayout, id: string) {
  return layout.cards.find((c) => c.personId === id && !c.ghost);
}
function overlaps(layout: TreeLayout, width = 84): string[] {
  const bad = [];
  for (let i = 0; i < layout.cards.length; i++) {
    for (let j = i + 1; j < layout.cards.length; j++) {
      const a = layout.cards[i];
      const b = layout.cards[j];
      if (a.y === b.y && Math.abs(a.x - b.x) < width) bad.push(`${a.personId}/${b.personId}`);
    }
  }
  return bad;
}

const twoWives: TreeGraph = {
  persons: people('pa', 'wife1', 'wife2', 'a', 'b', 'c'),
  unions: [
    { id: 'u1', partner1Id: 'pa', partner2Id: 'wife1', seq1: 1 },
    { id: 'u2', partner1Id: 'pa', partner2Id: 'wife2', seq1: 2 },
  ],
  links: [...links(['pa', 'wife1'], ['a'], 'u1'), ...links(['pa', 'wife2'], ['b', 'c'], 'u2')],
};

describe('T-TREE-02: several partners', () => {
  const layout = layoutLineTree(twoWives);
  it('first wife left, second wife right, on one row', () => {
    const pa = spot(layout, 'pa');
    expect((spot(layout, 'wife1')?.x ?? 0) < (pa?.x ?? 0)).toBe(true);
    expect((spot(layout, 'wife2')?.x ?? 0) > (pa?.x ?? 0)).toBe(true);
    expect(spot(layout, 'wife1')?.y).toBe(pa?.y);
  });
  it('children sit one row down, the first wife\'s child on the left', () => {
    expect((spot(layout, 'a')?.y ?? 0) > (spot(layout, 'pa')?.y ?? 0)).toBe(true);
    expect((spot(layout, 'a')?.x ?? 0) < (spot(layout, 'b')?.x ?? 0)).toBe(true);
  });
  it('nothing overlaps', () => {
    expect(overlaps(layout)).toEqual([]);
  });
  it('every child has a line from the right union', () => {
    expect(layout.lines.filter((l) => l.kind === 'child').length).toBe(3);
    expect(layout.lines.filter((l) => l.kind === 'partner').length).toBe(2);
  });
});

describe('sibling order', () => {
  it('birth order, then date, then name', () => {
    const graph: TreeGraph = {
      persons: [
        { id: 'p', name: 'p' },
        { id: 'late', name: 'Z', birthOrder: 3 },
        { id: 'first', name: 'Y', birthOrder: 1 },
        { id: 'dated', name: 'B', birthDate: '1950-01-01' },
        { id: 'plain', name: 'A' },
      ],
      unions: [],
      links: links(['p'], ['late', 'first', 'dated', 'plain'], null),
    };
    const layout = layoutLineTree(graph);
    const order = ['first', 'late', 'dated', 'plain'].map((id) => spot(layout, id)?.x ?? 0);
    expect(order.slice().sort((a, b) => a - b)).toEqual(order);
  });
});

const cousinMarriage: TreeGraph = {
  persons: people('top', 'x', 'y', 'son', 'daughter', 'kid'),
  unions: [{ id: 'u1', partner1Id: 'son', partner2Id: 'daughter' }],
  links: [
    ...links(['top'], ['x', 'y'], null),
    ...links(['x'], ['son'], null),
    ...links(['y'], ['daughter'], null),
    ...links(['son', 'daughter'], ['kid'], 'u1'),
  ],
};

describe('T-TREE-03: cousin marriage', () => {
  const layout = layoutLineTree(cousinMarriage);
  it('each person has one real card, and one ghost at the second position', () => {
    for (const p of cousinMarriage.persons) {
      expect(layout.cards.filter((c) => c.personId === p.id && !c.ghost).length).toBe(1);
    }
    expect(layout.cards.filter((c) => c.ghost).length).toBe(1);
  });
  it('a dotted line joins the ghost to the real card', () => {
    expect(layout.lines.filter((l) => l.kind === 'ghost').length).toBe(1);
  });
  it('the couple\'s child is drawn once', () => {
    expect(layout.cards.filter((c) => c.personId === 'kid').length).toBe(1);
    expect(overlaps(layout)).toEqual([]);
  });
});

describe('two families joined by marriage', () => {
  const graph: TreeGraph = {
    persons: people('gp1', 'dad', 'gp2', 'gg2', 'mum', 'me'),
    unions: [{ id: 'u', partner1Id: 'dad', partner2Id: 'mum' }],
    links: [
      ...links(['gg2'], ['gp2'], null),
      ...links(['gp1'], ['dad'], null),
      ...links(['gp2'], ['mum'], null),
      ...links(['dad', 'mum'], ['me'], 'u'),
    ],
  };
  it('both grandparents share a row even though one family goes back further', () => {
    const layout = layoutLineTree(graph, { focusId: 'me' });
    expect(spot(layout, 'gp1')?.y).toBe(spot(layout, 'gp2')?.y);
    expect(spot(layout, 'me')?.generation).toBe(0);
    expect(spot(layout, 'gp1')?.generation).toBe(-2);
    expect(overlaps(layout)).toEqual([]);
  });
});

describe('big trees', () => {
  const persons = people('root');
  const allLinks = [];
  for (let g = 0, parent = 'root'; g < 6; g++) {
    const child = `g${g}`;
    persons.push({ id: child, name: child });
    allLinks.push({ parentId: parent, childId: child, unionId: null });
    parent = child;
  }
  const chain: TreeGraph = { persons, unions: [], links: allLinks };

  it('collapses branches more than 3 generations below the focus', () => {
    const layout = layoutLineTree(chain, { focusId: 'root', collapseBeyond: 3 });
    expect(layout.cards.length).toBe(4);
    expect(spot(layout, 'g2')?.hiddenChildren).toBe(1);
  });
  it('opens when the user taps', () => {
    const layout = layoutLineTree(chain, { focusId: 'root', collapseBeyond: 3, expanded: ['g2'] });
    expect(layout.cards.length).toBe(5);
    expect(spot(layout, 'g3')?.hiddenChildren).toBe(1);
  });
  it('draws only what is on screen', () => {
    const layout = layoutLineTree(chain);
    expect(cardsInView(layout, 0, 0, 200, 150, 0).length).toBeLessThan(layout.cards.length);
  });
  it('1,000 people lay out without overlaps', () => {
    const many = people('p0');
    const manyLinks = [];
    for (let i = 1; i < 1000; i++) {
      many.push({ id: `p${i}`, name: `p${i}` });
      manyLinks.push({ parentId: `p${Math.floor((i - 1) / 3)}`, childId: `p${i}`, unionId: null });
    }
    const start = Date.now();
    const layout = layoutLineTree({ persons: many, unions: [], links: manyLinks }, { focusId: 'p500' });
    expect(Date.now() - start).toBeLessThan(500);
    expect(layout.cards.length).toBe(1000);
    expect(overlaps(layout)).toEqual([]);
  });
});

describe('focus view', () => {
  const graph: TreeGraph = {
    persons: people('gm', 'mum', 'dad', 'me', 'sis', 'wife', 'kid', 'niece'),
    unions: [{ id: 'u1', partner1Id: 'dad', partner2Id: 'mum' }, { id: 'u2', partner1Id: 'me', partner2Id: 'wife' }],
    links: [
      ...links(['gm'], ['mum'], null),
      ...links(['dad', 'mum'], ['me', 'sis'], 'u1'),
      ...links(['me', 'wife'], ['kid'], 'u2'),
      ...links(['sis'], ['niece'], null),
    ],
  };
  it('sorts everyone into the sections on the screen', () => {
    const view = focusView(graph, 'me');
    expect(view.parents.slice().sort()).toEqual(['dad', 'mum']);
    expect(view.grandparents).toEqual([{ viaParentId: 'mum', ids: ['gm'] }]);
    expect(view.partners).toEqual(['wife']);
    expect(view.siblings).toEqual(['sis']);
    expect(view.children).toEqual(['kid']);
    expect(view.siblingsChildren).toEqual([{ siblingId: 'sis', ids: ['niece'] }]);
  });
  it('re-centres on whoever is tapped', () => {
    const view = focusView(graph, 'sis');
    expect(view.siblings).toEqual(['me']);
    expect(view.children).toEqual(['niece']);
  });
  it('keeps brothers and sisters in the same order whoever is tapped (nobody jumps sides)', () => {
    expect(focusView(graph, 'me').siblingRow).toEqual(focusView(graph, 'sis').siblingRow);
    expect(focusView(graph, 'me').siblingRow.slice().sort()).toEqual(['me', 'sis']);
  });
  it('a grandparent sees two levels down: children with their partners, and the grandchildren', () => {
    const view = focusView(graph, 'mum');
    expect(view.children.slice().sort()).toEqual(['me', 'sis']);
    expect(view.childPartners).toEqual([{ childId: 'me', ids: ['wife'] }]);
    expect(view.grandchildren.map((g) => g.ids).flat().sort()).toEqual(['kid', 'niece']);
  });
});

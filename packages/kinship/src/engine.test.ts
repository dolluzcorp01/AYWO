import { describe, expect, it } from 'vitest';
import { describePath, labelTree, suggestTerms } from './engine.ts';
import type { KinGraph, KinPerson } from './engine.ts';
import { SEED_TERMS } from './seed-terms.ts';

const ta = { languages: ['ta'], terms: SEED_TERMS };

function person(id: string, gender: KinPerson['gender'], birthOrder?: number): KinPerson {
  return { id, gender, birthOrder: birthOrder ?? null };
}
function couple(id: string, a: string, b: string) {
  return { id, partner1Id: a, partner2Id: b };
}
function kids(parents: string[], children: string[]) {
  const links = [];
  for (const parentId of parents) for (const childId of children) links.push({ parentId, childId });
  return links;
}

// A small made-up family. Grandparents gf + gm; children mum, uncle, aunt; mum + dad have me and sis.
const family: KinGraph = {
  persons: [
    person('gf', 'male'), person('gm', 'female'),
    person('mum', 'female', 2), person('uncle', 'male', 1), person('aunt', 'female', 3), person('unclesWife', 'female'),
    person('dad', 'male', 2), person('dadsElder', 'male', 1), person('dadsYounger', 'male', 3), person('dadsNoOrder', 'male'),
    person('dadsFather', 'male'),
    person('me', 'male', 1), person('sis', 'female', 2), person('sibNoOrder', 'female'),
    person('auntsSon', 'male'),
  ],
  unions: [couple('u1', 'gf', 'gm'), couple('u2', 'dad', 'mum'), couple('u3', 'uncle', 'unclesWife')],
  parentLinks: [
    ...kids(['gf', 'gm'], ['mum', 'uncle', 'aunt']),
    ...kids(['dad', 'mum'], ['me', 'sis', 'sibNoOrder']),
    ...kids(['dadsFather'], ['dad', 'dadsElder', 'dadsYounger', 'dadsNoOrder']),
    ...kids(['aunt'], ['auntsSon']),
  ],
};

describe('path codes and Tamil words', () => {
  const labels = labelTree(family, 'me', ta);

  it('T-VIEW-02: mother\'s brother is Mama, mother\'s mother is Paati', () => {
    expect(labels.uncle.pathCode).toBe('M.B+');
    expect(labels.uncle.label).toBe('Mama');
    expect(labels.gm.pathCode).toBe('M.M');
    expect(labels.gm.label).toBe('Paati');
  });

  it('T-VIEW-04: father\'s brothers follow birth order; no order offers both words', () => {
    expect(labels.dadsElder.pathCode).toBe('F.B+');
    expect(labels.dadsElder.label).toBe('Periyappa');
    expect(labels.dadsYounger.pathCode).toBe('F.B-');
    expect(labels.dadsYounger.label).toBe('Chithappa');
    expect(labels.dadsNoOrder.pathCode).toBe('F.B');
    expect(labels.dadsNoOrder.source).toBe('ask');
    expect(labels.dadsNoOrder.label).toBe('Periyappa / Chithappa');
  });

  it('own siblings use elder and younger words', () => {
    expect(labels.sis.pathCode).toBe('Z-');
    expect(labels.sis.label).toBe('Thangai');
    expect(labels.sibNoOrder.source).toBe('ask');
    expect(labels.sibNoOrder.label).toBe('Akka / Thangai');
  });

  it('in-laws through marriage', () => {
    expect(labels.unclesWife.pathCode).toBe('M.B+.W');
    expect(labels.unclesWife.label).toBe('Mami');
  });

  it('T-VIEW-03: the same tree from another person\'s place', () => {
    const fromUncle = labelTree(family, 'uncle', ta);
    expect(fromUncle.gm.label).toBe('Amma');
    expect(fromUncle.gf.label).toBe('Appa');
    expect(fromUncle.me.pathCode).toBe('Z-.S');
    expect(fromUncle.me.label).toBe('Marumagan');
  });
});

describe('English and fallbacks', () => {
  it('uses the neutral English word when the order does not matter', () => {
    const labels = labelTree(family, 'me', { languages: ['en'], terms: SEED_TERMS });
    expect(labels.uncle.label).toBe('Uncle');
    expect(labels.sis.label).toBe('Younger sister');
  });

  it('falls back to English for a language with no words yet', () => {
    const labels = labelTree(family, 'me', { languages: ['fr'], terms: SEED_TERMS });
    expect(labels.uncle.source).toBe('english');
    expect(labels.uncle.label).toBe('Uncle');
  });

  it('builds a phrase when there is no word at all', () => {
    const labels = labelTree(family, 'me', { languages: ['en'], terms: [] });
    expect(labels.dadsElder.label).toBe("father's elder brother");
    expect(labels.dadsElder.source).toBe('phrase');
  });

  it('carries the dictionary row behind the word, so it can be reported', () => {
    const terms = [
      { id: 'row-uncle', pathCode: 'M.B', language: 'en', term: 'Uncle', isDefault: true, status: 'ai_seeded' as const },
      { id: 'row-elder', pathCode: 'F.B+', language: 'xx', term: 'Elder', isDefault: true, status: 'ai_seeded' as const },
      { id: 'row-younger', pathCode: 'F.B-', language: 'xx', term: 'Younger', isDefault: true, status: 'ai_seeded' as const },
    ];
    expect(labelTree(family, 'me', { languages: ['en'], terms }).uncle.kinTermId).toBe('row-uncle');
    expect(labelTree(family, 'me', { languages: ['xx'], terms }).dadsNoOrder.kinTermId).toBe('row-elder');
    expect(labelTree(family, 'me', { languages: ['en'], terms: [] }).uncle.kinTermId).toBe(undefined);
  });

  it('knows about 150 relationships in English, with every word consistent', () => {
    const english = SEED_TERMS.filter((t) => t.language === 'en');
    expect(english.length).toBeGreaterThanOrEqual(140);
    expect(new Set(english.map((t) => t.pathCode)).size).toBe(english.length);
    const labels = labelTree(family, 'me', { languages: ['en'], terms: SEED_TERMS });
    expect(labels.auntsSon.label).toBe('Cousin');
  });

  it('T-KIN-01: "MAMA " matches the existing word', () => {
    const found = suggestTerms(SEED_TERMS, 'ta', 'MAMA ');
    expect(found.some((t) => t.term === 'Mama')).toBe(true);
  });

  it('never shows pending or rejected words on labels', () => {
    const terms = [{ pathCode: 'M.B+', language: 'xx', term: 'Bad', isDefault: true, status: 'rejected' }];
    const labels = labelTree(family, 'me', { languages: ['xx'], terms: terms.map((t) => ({ ...t, status: 'rejected' as const })) });
    expect(labels.uncle.label).not.toBe('Bad');
  });
});

describe('elder or younger questions (wireframe D4)', () => {
  it('says which two siblings the question is about', () => {
    const labels = labelTree(family, 'me', ta);
    expect(labels.sibNoOrder.askAbout).toEqual({ linkId: 'me', siblingId: 'sibNoOrder' });
    expect(labels.dadsNoOrder.askAbout).toEqual({ linkId: 'dad', siblingId: 'dadsNoOrder' });
  });
  it('asks nothing when the order is known', () => {
    const labels = labelTree(family, 'me', ta);
    expect(labels.dadsElder.askAbout).toBe(undefined);
    expect(labels.auntsSon.source === 'ask').toBe(false);
  });
});

describe('describing a relation in words (wireframe D1)', () => {
  const english = {
    F: 'father', M: 'mother', P: 'parent', S: 'son', D: 'daughter', C: 'child',
    B: 'brother', Z: 'sister', G: 'sibling', H: 'husband', W: 'wife', E: 'spouse',
    elder: 'elder', younger: 'younger', half: 'half-', step: 'step-', join: "'s ",
  };
  it('reads naturally', () => {
    expect(describePath('M.B', english)).toBe("mother's brother");
    expect(describePath('F.B+', english)).toBe("father's elder brother");
    expect(describePath('Bh', english)).toBe('half-brother');
    expect(describePath('F.W~', english)).toBe("father's step-wife");
  });
  it('uses each language\'s own joining', () => {
    expect(describePath('M.B', { ...english, M: 'அம்மா', B: 'சகோதரர்', join: ' > ' })).toBe('அம்மா > சகோதரர்');
  });
});

describe('T-TREE-02: half and step relations', () => {
  const graph: KinGraph = {
    persons: [
      person('pa', 'male'), person('wife1', 'female'), person('wife2', 'female'),
      person('a', 'male'), person('b', 'male'),
    ],
    unions: [couple('u1', 'pa', 'wife1'), couple('u2', 'pa', 'wife2')],
    parentLinks: [...kids(['pa', 'wife1'], ['a']), ...kids(['pa', 'wife2'], ['b'])],
  };

  it('children of two wives are half-brothers', () => {
    const labels = labelTree(graph, 'a', { languages: ['en'], terms: [] });
    expect(labels.b.pathCode).toBe('Bh');
    expect(labels.b.label).toBe('half-brother');
  });

  it('father\'s other wife is a step-mother, not a mother', () => {
    const labels = labelTree(graph, 'a', { languages: ['en'], terms: [] });
    expect(labels.wife2.pathCode).toBe('F.W~');
    expect(labels.wife1.pathCode).toBe('M');
  });
});

describe('T-TREE-03: cousin marriage', () => {
  // Brother and sister x, y. x's son marries y's daughter.
  const graph: KinGraph = {
    persons: [
      person('top', 'male'), person('x', 'male'), person('y', 'female'),
      person('son', 'male'), person('daughter', 'female'),
    ],
    unions: [couple('u1', 'son', 'daughter')],
    parentLinks: [...kids(['top'], ['x', 'y']), ...kids(['x'], ['son']), ...kids(['y'], ['daughter'])],
  };

  it('your own partner is your partner first, with the blood relation as "also"', () => {
    const labels = labelTree(graph, 'son', { languages: ['en'], terms: [] });
    expect(labels.daughter.pathCode).toBe('W');
    expect(labels.daughter.also?.pathCode).toBe('F.Z.D');
  });

  it('for anyone else the blood label comes first', () => {
    const labels = labelTree(graph, 'x', { languages: ['en'], terms: [] });
    expect(labels.daughter.pathCode).toBe('Z.D');
    expect(labels.daughter.also?.pathCode).toBe('S.W');
  });
});

describe('performance', () => {
  it('labels 1,000 people quickly (target 100 ms; 300 here to keep CI stable)', () => {
    const persons: KinPerson[] = [];
    const parentLinks = [];
    for (let i = 0; i < 1000; i++) {
      persons.push(person(`p${i}`, i % 2 === 0 ? 'male' : 'female', i));
      if (i > 0) parentLinks.push({ parentId: `p${Math.floor((i - 1) / 3)}`, childId: `p${i}` });
    }
    const start = Date.now();
    const labels = labelTree({ persons, unions: [], parentLinks }, 'p500', ta);
    expect(Object.keys(labels).length).toBe(999);
    expect(Date.now() - start).toBeLessThan(300);
  });
});

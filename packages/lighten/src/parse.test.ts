import { describe, expect, it } from 'vitest';
import { applyGenderFixes, parseLighten } from './parse.ts';
import type { LightenContent } from './parse.ts';

// A made-up family with every pattern from the founder's file. Real names stay out of the repo.
const sample: LightenContent = {
  mapName: 'Test family',
  rootTopic: {
    id: 'root',
    title: 'Elder',
    subtopics: [
      {
        id: 'w1',
        title: 'Name Unknown (First Wife)',
        subtopics: [
          { id: 's1', title: 'Name Unknown (1st Son)' },
          { id: 's2', title: 'Kid Two (2nd Son)' },
        ],
      },
      {
        id: 'w2',
        title: 'Second Lady (Second Wife)',
        subtopics: [
          { id: 'p', title: 'Pat', subtopics: [{ id: 'cousin', title: 'Cousin Girl', subtopics: [{ id: 'g', title: 'Grandkid' }] }] },
          { id: 'q', title: 'Quinn / Other Person ', subtopics: [{ id: 'empty', title: 'Subtopic' }] },
          { id: 'r', title: 'Ravi / Cousin Girl' },
        ],
      },
    ],
  },
  relationships: [
    { startNodeId: 'r', endNodeId: 'cousin' },
    { startNodeId: 'q', endNodeId: 'nowhere' },
  ],
};

describe('parseLighten', () => {
  const preview = parseLighten(sample);
  const byName = (name: string) => preview.persons.find((p) => p.displayName === name);

  it('splits "A / B" into a couple', () => {
    expect(byName('Quinn')).toBeTruthy();
    expect(byName('Other Person')).toBeTruthy();
    expect(preview.counts.couplesSplit).toBe(2);
  });

  it('makes "(Second Wife)" a partner of the parent, not a child', () => {
    const elder = byName('Elder');
    const wife = byName('Second Lady');
    expect(elder?.gender).toBe('male');
    expect(wife?.gender).toBe('female');
    expect(preview.parentLinks.some((l) => l.childId === wife?.tempId)).toBe(false);
    expect(preview.unions.some((u) => u.partner1Id === elder?.tempId && u.partner2Id === wife?.tempId)).toBe(true);
  });

  it('puts children under the right wife', () => {
    const kid = byName('Kid Two');
    const parents = preview.parentLinks.filter((l) => l.childId === kid?.tempId).map((l) => l.parentId);
    expect(parents).toContain(byName('Elder')?.tempId);
    expect(parents.length).toBe(2);
    expect(kid?.birthOrder).toBe(2);
    expect(kid?.noteLabel).toBe('2nd Son');
    expect(kid?.gender).toBe('male');
  });

  it('keeps "Name Unknown" people, flagged', () => {
    expect(preview.persons.filter((p) => p.nameUnknown).length).toBe(2);
  });

  it('skips "Subtopic" and lists it', () => {
    expect(preview.placeholders.length).toBe(1);
    expect(preview.placeholders[0]).toMatchObject({ underPerson: 'Quinn', tempId: 'empty#p', unionId: 'q#u' });
    expect(preview.placeholders[0].parentIds).toEqual(['q#a', 'q#b']);
    expect(preview.persons.some((p) => p.displayName === 'Subtopic')).toBe(false);
  });

  it('T-TREE-03: merges the same person in two places, keeping the blood position', () => {
    const girls = preview.persons.filter((p) => p.displayName === 'Cousin Girl');
    expect(girls.length).toBe(1);
    expect(preview.counts.merges).toBe(1);
    expect(preview.parentLinks.some((l) => l.childId === girls[0].tempId && l.parentId === byName('Pat')?.tempId)).toBe(true);
    expect(preview.unions.some((u) => u.partner2Id === girls[0].tempId && u.partner1Id === byName('Ravi')?.tempId)).toBe(true);
  });

  it('children drawn under the merged person belong to the couple', () => {
    const kid = byName('Grandkid');
    const parents = preview.parentLinks.filter((l) => l.childId === kid?.tempId).map((l) => l.parentId);
    expect(parents).toContain(byName('Ravi')?.tempId);
    expect(parents.length).toBe(2);
  });

  it('records how to undo a merge, for "No, two people"', () => {
    const merge = preview.merges[0];
    expect(merge.dropped.displayName).toBe('Cousin Girl');
    expect(merge.dropped.tempId).toBe(merge.droppedId);
    expect(merge.undo.unions.length).toBe(1);
    // Undoing by position gives Ravi's partner back as the dropped person, and removes the link only the merge added.
    const { index, field } = merge.undo.unions[0];
    expect(preview.unions[index][field]).toBe(merge.keptId);
    expect(merge.undo.addedLinks.length).toBe(1);
    expect(preview.parentLinks[merge.undo.addedLinks[0]].parentId).toBe(byName('Ravi')?.tempId);
    expect(preview.parentLinks[merge.undo.linkUnions[0]].parentId).toBe(merge.keptId);
  });

  it('reports a link it cannot resolve instead of guessing', () => {
    expect(preview.problems.length).toBe(1);
    expect(preview.problems[0].code).toBe('link_not_matched');
  });

  it('counts generations and people with unknown gender', () => {
    expect(preview.counts.generations).toBe(4);
    expect(preview.counts.genderUnknown).toBeGreaterThan(0);
  });

  it('gender corrections from the preview are applied', () => {
    const pat = byName('Pat');
    const fixed = applyGenderFixes(preview, { [pat?.tempId ?? '']: 'female' });
    expect(fixed.persons.find((p) => p.displayName === 'Pat')?.gender).toBe('female');
    expect(fixed.counts.genderUnknown).toBe(preview.counts.genderUnknown - 1);
  });
});

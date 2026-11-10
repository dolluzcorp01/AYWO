import { describe, expect, it } from 'vitest';
import { branchIds, languageChain, toMemberNode, toOutsiderNode } from './tree-view.ts';
import type { PersonRow } from './tree-view.ts';

const row: PersonRow = {
  id: 'p1',
  display_name: 'Test Person',
  name_unknown: false,
  note_label: 'SECRET-NOTE-LABEL',
  gender: 'female',
  living: 'living',
  birth_date: '1970-02-03',
  death_date: null,
  birth_precision: 'exact',
  death_precision: null,
  birth_place: 'SECRET-PLACE',
  death_place: null,
  birth_order: 2,
  photo_path: 'SECRET-PATH/p.jpg',
  notes: 'SECRET-NOTES',
  claimed_by: 'SECRET-PROFILE-ID',
  version: 4,
};

describe('T-VIEW-01: outsiders', () => {
  const sent = JSON.stringify(toOutsiderNode(row, 'https://signed/url'));
  it('get the name and photo', () => {
    expect(sent.includes('Test Person')).toBe(true);
    expect(sent.includes('https://signed/url')).toBe(true);
  });
  it('get nothing else', () => {
    expect(sent.includes('SECRET')).toBe(false);
    expect(sent.includes('1970')).toBe(false);
    expect(sent.includes('female')).toBe(false);
  });
});

describe('members', () => {
  it('see the details, but never who claimed the card or the storage path', () => {
    const sent = JSON.stringify(toMemberNode(row, null));
    expect(sent.includes('1970-02-03')).toBe(true);
    expect(sent.includes('SECRET-PROFILE-ID')).toBe(false);
    expect(sent.includes('SECRET-PATH')).toBe(false);
  });
});

describe('branch of a share', () => {
  it('holds descendants and their partners, not the partners\' other relatives', () => {
    const ids = branchIds(['a', 'b'], [
      { partner1_id: 'b', partner2_id: 'wife' },
      { partner1_id: 'wife', partner2_id: 'other' },
      { partner1_id: 'x', partner2_id: 'y' },
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'wife']);
  });
});

describe('language fallback (LLD L12)', () => {
  it('follows the agreed chains', () => {
    expect(languageChain('zh-Hant-HK')).toEqual(['zh-Hant-HK', 'zh-Hant-TW', 'zh-Hans', 'zh']);
    expect(languageChain('pt-PT')).toEqual(['pt-PT', 'pt-BR', 'pt']);
    expect(languageChain('ms-SG')).toEqual(['ms-SG', 'ms-MY', 'ms']);
    expect(languageChain('ta')).toEqual(['ta']);
    expect(languageChain('en-GB')).toEqual(['en-GB', 'en-US', 'en']);
  });
});

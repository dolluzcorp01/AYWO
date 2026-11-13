import { describe, expect, it } from 'vitest';
import { alsoChildCandidates } from './alsoChildren';

const nodes = ['me', 'dad', 'sis', 'half', 'mum2', 'kid'].map((id) => ({ id }));
const link = (parent_id: string, child_id: string) => ({ parent_id, child_id });

describe('alsoChildCandidates', () => {
  it('offers the brothers and sisters who have only the same one parent', () => {
    const links = [link('dad', 'me'), link('dad', 'sis'), link('dad', 'half'), link('mum2', 'half')];
    expect(alsoChildCandidates(nodes, links, 'me').map((n) => n.id)).toEqual(['sis']);
  });
  it('offers no one when the person already has two parents or none', () => {
    expect(alsoChildCandidates(nodes, [link('dad', 'me'), link('mum2', 'me'), link('dad', 'sis')], 'me')).toEqual([]);
    expect(alsoChildCandidates(nodes, [link('dad', 'sis')], 'me')).toEqual([]);
  });
});

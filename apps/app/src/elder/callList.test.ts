import { describe, expect, it } from 'vitest';
import { callList } from './callList';

const nodes = [
  { id: 'me', name: 'Lakshmi', living: 'living' },
  { id: 'son', name: 'Ravi', living: 'living' },
  { id: 'girl', name: 'Anu', living: 'living' },
  { id: 'grandpa', name: 'Raman', living: 'deceased' },
  { id: 'aunt', name: 'Meena', living: 'living' },
  { id: 'nobody', name: 'Name unknown', nameUnknown: true, living: 'unknown' },
];
const contacts = {
  me: { values: [{ kind: 'mobile' as const, value: '+91 98000 00001', link_value: '+919800000001' }] },
  son: { values: [{ kind: 'mobile' as const, value: '+91 98000 00002', link_value: '+919800000002' }, { kind: 'whatsapp' as const, value: 'x', link_value: '+919800000002' }] },
  girl: { has_mobile: true },
  grandpa: { values: [{ kind: 'mobile' as const, value: 'x', link_value: '+919800000003' }] },
  aunt: { values: [{ kind: 'email' as const, value: 'm@x.in', link_value: 'm@x.in' }] },
  nobody: { values: [{ kind: 'mobile' as const, value: 'x', link_value: '+919800000004' }] },
};

describe('callList', () => {
  const list = callList(nodes, contacts, 'me');

  it('leaves out me, those who passed, unnamed people and email-only people', () => {
    expect(list.map((p) => p.id)).toEqual(['son', 'girl']);
  });

  it('gives call and WhatsApp links when the numbers are open', () => {
    expect(list[0]).toMatchObject({ call: 'tel:+919800000002', whatsapp: 'https://wa.me/919800000002', locked: false });
  });

  it('shows a locked number as locked, after the open ones', () => {
    expect(list[1]).toMatchObject({ id: 'girl', call: null, whatsapp: null, locked: true });
  });

  it('copes with no contacts at all', () => {
    expect(callList(nodes, undefined, 'me')).toEqual([]);
  });
});

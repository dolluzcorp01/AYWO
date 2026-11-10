import { describe, expect, it } from 'vitest';
import { contactActions, contactUrl } from './person-card.ts';

describe('T-CON-02: tapping a contact', () => {
  it('opens the dialler, WhatsApp and mail', () => {
    expect(contactUrl('mobile', '+919800000000')).toBe('tel:+919800000000');
    expect(contactUrl('whatsapp', '+91 98000 00000')).toBe('https://wa.me/919800000000');
    expect(contactUrl('email', 'a.b@test.local')).toBe('mailto:a.b@test.local');
  });
  it('stored text cannot turn into another kind of link', () => {
    expect(contactUrl('mobile', 'javascript:alert(1)')).toBe(null);
    expect(contactUrl('email', 'javascript:alert(1)')).toBe(null);
    expect(contactUrl('email', 'a@b.c?bcc=x@y.z')).toBe(null);
    expect(contactUrl('email', 'a@b.c?subject=x')).toBe('mailto:a@b.c%3Fsubject%3Dx');
  });
});

describe('contact buttons', () => {
  it('T-CON-02: values give working buttons, in the wireframe order', () => {
    const actions = contactActions({
      values: [
        { kind: 'email', value: 'a@b.c', link_value: 'a@b.c' },
        { kind: 'mobile', value: '98000 00000', link_value: '+919800000000' },
      ],
    });
    expect(actions.map((a) => a.kind)).toEqual(['mobile', 'email']);
    expect(actions[0].url).toBe('tel:+919800000000');
  });
  it('T-CON-01: no values gives grey buttons that open nothing', () => {
    const actions = contactActions({ has_mobile: true, has_whatsapp: false, has_email: true });
    expect(actions).toEqual([{ kind: 'mobile', url: null }, { kind: 'email', url: null }]);
  });
  it('nothing known, nothing shown', () => {
    expect(contactActions(null)).toEqual([]);
  });
});

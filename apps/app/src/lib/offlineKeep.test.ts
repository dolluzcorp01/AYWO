import { describe, expect, it } from 'vitest';
import { scrub, shouldKeep, withoutNumbers } from './offlineKeep';

describe('shouldKeep', () => {
  it('keeps the family and my account', () => {
    for (const key of ['me', 'trees', 'tree-view', 'person-card', 'calendar', 'family-dates']) expect(shouldKeep([key, 'x'], 'success')).toBe(true);
  });
  it('never keeps health, SOS, chat or admin data', () => {
    for (const key of ['emergency-card', 'sos-active', 'chats', 'admin', 'posts']) expect(shouldKeep([key], 'success')).toBe(false);
  });
  it('never keeps a failed or unfinished load', () => {
    expect(shouldKeep(['tree-view'], 'error')).toBe(false);
    expect(shouldKeep(['tree-view'], 'pending')).toBe(false);
  });
});

describe('scrub', () => {
  const contacts = {
    values: [
      { kind: 'mobile' as const, value: '+91 98000 00002', link_value: '+919800000002' },
      { kind: 'email' as const, value: 'ravi@x.in', link_value: 'ravi@x.in' },
    ],
  };

  it('removes every number from a tree but keeps that one exists', () => {
    const out = scrub('tree-view', { nodes: [1], contacts: { ravi: contacts } }) as { nodes: number[]; contacts: Record<string, unknown> };
    expect(out.nodes).toEqual([1]);
    expect(out.contacts.ravi).toEqual({ has_mobile: true, has_whatsapp: false, has_email: true });
    expect(JSON.stringify(out)).not.toContain('98000');
    expect(JSON.stringify(out)).not.toContain('ravi@x.in');
  });

  it('removes numbers from a person card', () => {
    const out = scrub('person-card', { name: 'Ravi', contacts });
    expect(JSON.stringify(out)).not.toContain('98000');
    expect(out).toMatchObject({ name: 'Ravi', contacts: { has_mobile: true } });
  });

  it('leaves other data alone', () => {
    const me = { display_name: 'Lakshmi' };
    expect(scrub('me', me)).toBe(me);
    expect(scrub('tree-view', null)).toBe(null);
  });

  it('keeps an existing flag when there are no values', () => {
    expect(withoutNumbers({ has_whatsapp: true })).toEqual({ has_mobile: false, has_whatsapp: true, has_email: false });
  });
});

describe('KEEP_DAYS', () => {
  it('fits in a JavaScript timer, or the restored copy would be dropped at once', async () => {
    const { KEEP_DAYS } = await import('./offlineKeep');
    expect(KEEP_DAYS * 24 * 60 * 60_000).toBeLessThan(2 ** 31 - 1);
  });
});

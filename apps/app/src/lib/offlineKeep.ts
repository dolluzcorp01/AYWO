// What the phone keeps for offline use, and what it never keeps. Only the family and the person's own account: the
// tree, person cards, the calendar and the Home dates. Other people's phone numbers and emails are taken out first, so a
// lost phone does not hand out the family's numbers.
import type { ContactsAnswer } from '@aywo/shared';

export const KEEP_KEYS = ['me', 'trees', 'tree-view', 'person-card', 'calendar', 'family-dates'] as const;
// 21 days. Not 30: the in-memory keep time is a JavaScript timer, and a timer over about 24.8 days (2^31 ms)
// fires at once, which would throw the restored family away the moment it loaded.
export const KEEP_DAYS = 21;
const keep = new Set<string>(KEEP_KEYS);

export function shouldKeep(queryKey: readonly unknown[], status: string): boolean {
  return status === 'success' && typeof queryKey[0] === 'string' && keep.has(queryKey[0]);
}

/** Keeps that a number exists (so the card can say so) but never the number itself. */
export function withoutNumbers(answer: ContactsAnswer | undefined): ContactsAnswer | undefined {
  if (!answer) return answer;
  const { values: _values, ...rest } = answer;
  const kinds = new Set((answer.values ?? []).map((v) => v.kind));
  return {
    ...rest,
    has_mobile: rest.has_mobile || kinds.has('mobile'),
    has_whatsapp: rest.has_whatsapp || kinds.has('whatsapp'),
    has_email: rest.has_email || kinds.has('email'),
  };
}

/** The same data with every contact value removed. Tree view has a map of contacts; a person card has one. */
export function scrub(key: unknown, data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  if (key === 'tree-view') {
    const tree = data as { contacts?: Record<string, ContactsAnswer> };
    if (!tree.contacts) return data;
    return { ...tree, contacts: Object.fromEntries(Object.entries(tree.contacts).map(([id, c]) => [id, withoutNumbers(c)])) };
  }
  if (key === 'person-card') {
    const card = data as { contacts?: ContactsAnswer };
    return card.contacts ? { ...card, contacts: withoutNumbers(card.contacts) } : data;
  }
  return data;
}

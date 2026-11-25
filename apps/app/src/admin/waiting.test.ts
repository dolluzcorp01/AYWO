import { describe, expect, it } from 'vitest';
import { arrivals, menuCounts, waitingFrom } from './waiting';

describe('what is waiting for staff', () => {
  it('lists only what has something waiting', () => {
    const items = waitingFrom({ support: { open: 2, waiting: 5 }, moderation: { open: 0, urgent: 0 }, dictionary: { pending_terms: 1, open_reports: 0 } });
    expect(items.map((item) => [item.key, item.count])).toEqual([
      ['tickets', 2],
      ['words', 1],
    ]);
  });

  it('is empty before the counts have arrived, and for areas the person is not granted', () => {
    expect(waitingFrom(undefined)).toEqual([]);
    expect(waitingFrom({ users: { total: 9, active_30d: 1, new_7d: 1, blocked: 0 } })).toEqual([]);
  });

  it('adds new words and reported words into one number on Dictionary', () => {
    const counts = menuCounts(waitingFrom({ dictionary: { pending_terms: 2, open_reports: 3 }, orders: { queued: 4, printing: 9, shipped: 9 } }));
    expect(counts).toEqual({ dictionary: 5, orders: 4 });
  });

  it('says nothing is new on the first look', () => {
    expect(arrivals(null, waitingFrom({ dictionary: { pending_terms: 2, open_reports: 0 } }))).toEqual([]);
  });

  it('names what grew and by how much', () => {
    const before = waitingFrom({ dictionary: { pending_terms: 1, open_reports: 0 }, support: { open: 3, waiting: 0 } });
    const now = waitingFrom({ dictionary: { pending_terms: 2, open_reports: 0 }, support: { open: 2, waiting: 0 }, takedowns: { open: 1 } });
    expect(arrivals(before, now).map((item) => [item.key, item.count])).toEqual([
      ['takedowns', 1],
      ['words', 1],
    ]);
  });
});

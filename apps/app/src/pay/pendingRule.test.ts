import { describe, expect, it } from 'vitest';
import { PENDING_MS, pendingSince } from './pendingRule';

describe('pendingSince', () => {
  const now = 1_800_000_000_000;
  const saved = (at: number, profile = 'p1') => JSON.stringify({ at, profile });

  it('remembers a recent purchase for the same person', () => {
    expect(pendingSince(saved(now - 60_000), 'p1', now)).toBe(now - 60_000);
  });
  it('forgets one that is too old', () => {
    expect(pendingSince(saved(now - PENDING_MS), 'p1', now)).toBeNull();
  });
  it("ignores another person's purchase on a shared phone", () => {
    expect(pendingSince(saved(now - 60_000, 'p2'), 'p1', now)).toBeNull();
  });
  it('ignores nothing, rubbish, and a time in the future', () => {
    expect(pendingSince(null, 'p1', now)).toBeNull();
    expect(pendingSince('not json', 'p1', now)).toBeNull();
    expect(pendingSince(saved(now + 5_000), 'p1', now)).toBeNull();
  });
});

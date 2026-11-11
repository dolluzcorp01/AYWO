import { describe, expect, it } from 'vitest';
import { addMonths, gridRange, monthGrid } from './month';

describe('monthGrid', () => {
  it('starts on Sunday and ends on Saturday', () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(weeks[0][0]).toEqual({ date: '2026-11-01', day: 1, inMonth: true });
    expect(weeks[weeks.length - 1][6].date).toBe('2026-12-05');
    expect(weeks).toHaveLength(5);
  });

  it('fills the first week with the end of the month before', () => {
    const weeks = monthGrid(2026, 11); // December 2026 starts on a Tuesday
    expect(weeks[0].map((d) => d.date)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][2].inMonth).toBe(true);
  });

  it('needs six weeks for a long month that starts late', () => {
    expect(monthGrid(2026, 7)).toHaveLength(6); // August 2026: Saturday 1st, 31 days
  });

  it('handles February in a leap year', () => {
    const days = monthGrid(2028, 1).flat().filter((d) => d.inMonth);
    expect(days).toHaveLength(29);
    expect(days[28].date).toBe('2028-02-29');
  });

  it('never asks the server for more than 62 days', () => {
    for (let m = 0; m < 24; m++) {
      const { from, to } = gridRange(2026 + Math.floor(m / 12), m % 12);
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
      expect(days).toBeLessThanOrEqual(62);
    }
  });
});

describe('addMonths', () => {
  it('crosses the year both ways', () => {
    expect(addMonths(2026, 11, 1)).toEqual([2027, 0]);
    expect(addMonths(2026, 0, -1)).toEqual([2025, 11]);
  });
});

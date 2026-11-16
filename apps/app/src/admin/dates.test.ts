import { describe, expect, it } from 'vitest';
import { checkDays, dayToIso, isoToDay, normalDay, todayInIndia } from './dates';

describe('normalDay', () => {
  it('pads a short month or day', () => {
    expect(normalDay('2026-12-5')).toBe('2026-12-05');
    expect(normalDay(' 2026-1-09 ')).toBe('2026-01-09');
  });
  it('refuses what is not a real day', () => {
    expect(normalDay('2026-02-30')).toBeNull();
    expect(normalDay('2026-13-01')).toBeNull();
    expect(normalDay('05-12-2026')).toBeNull();
    expect(normalDay('2026/12/05')).toBeNull();
    expect(normalDay('0206-12-05')).toBeNull();
    expect(normalDay('')).toBeNull();
  });
});

describe('day and server time', () => {
  it('writes the start and end of the day in India', () => {
    expect(dayToIso('2026-11-03', false)).toBe('2026-11-03T00:00:00+05:30');
    expect(dayToIso('2026-11-3', true)).toBe('2026-11-03T23:59:59+05:30');
    expect(dayToIso('3 Nov', false)).toBeNull();
  });

  it('reads the India day from a time the server wrote in UTC', () => {
    // Midnight on 3 Nov in India is 18:30 on 2 Nov in UTC.
    expect(isoToDay('2026-11-02T18:30:00Z')).toBe('2026-11-03');
    expect(isoToDay('2026-11-02T18:30:00.000+00:00')).toBe('2026-11-03');
    expect(isoToDay('2026-11-03T18:29:59Z')).toBe('2026-11-03');
    expect(isoToDay('2026-11-03T00:00:00+05:30')).toBe('2026-11-03');
    expect(isoToDay(null)).toBe('');
    expect(isoToDay('not a date')).toBe('');
  });

  it('keeps the same day through any number of edits', () => {
    for (const endOfDay of [false, true]) {
      let day = '2026-11-03';
      for (let edit = 0; edit < 5; edit += 1) {
        const saved = dayToIso(day, endOfDay) as string;
        // The server answers in UTC.
        day = isoToDay(new Date(saved).toISOString());
      }
      expect(day).toBe('2026-11-03');
    }
  });

  it('knows today in India late in the UTC evening', () => {
    expect(todayInIndia(new Date('2026-11-13T19:00:00Z'))).toBe('2026-11-14');
    expect(todayInIndia(new Date('2026-11-13T10:00:00Z'))).toBe('2026-11-13');
  });
});

describe('checkDays', () => {
  it('passes a start with no end, and an end on or after the start', () => {
    expect(checkDays('2026-11-03', '')).toEqual({ starts: null, ends: null });
    expect(checkDays('2026-11-03', '2026-11-03')).toEqual({ starts: null, ends: null });
    expect(checkDays('2026-11-03', '2026-12-5')).toEqual({ starts: null, ends: null });
  });
  it('says what is wrong', () => {
    expect(checkDays('', '')).toEqual({ starts: 'missing', ends: null });
    expect(checkDays('3/11/2026', '2026-12-32')).toEqual({ starts: 'bad', ends: 'bad' });
    expect(checkDays('2026-11-03', '2026-11-02')).toEqual({ starts: null, ends: 'beforeStart' });
  });
});

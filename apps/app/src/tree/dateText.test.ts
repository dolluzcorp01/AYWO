// The date helpers that apps/app/src/lib/contacts.ts hands out. They live here, with no imports, because contacts.ts
// also pulls in the phone-number code, which needs the device.
import { describe, expect, it } from 'vitest';
import { dateFromBox, dateToText, parseDateText } from './dateText';

describe('parseDateText', () => {
  it('reads a year', () => {
    expect(parseDateText(' 1968 ')).toEqual({ date: '1968-01-01', precision: 'year' });
  });

  it('reads a month and a year, either way round', () => {
    expect(parseDateText('03/1968')).toEqual({ date: '1968-03-01', precision: 'month' });
    expect(parseDateText('3-1968')).toEqual({ date: '1968-03-01', precision: 'month' });
    expect(parseDateText('1968-03')).toEqual({ date: '1968-03-01', precision: 'month' });
    expect(parseDateText('13/1968')).toBeNull();
    expect(parseDateText('0/1968')).toBeNull();
  });

  it('reads a full date, day first or year first', () => {
    expect(parseDateText('21/03/1968')).toEqual({ date: '1968-03-21', precision: 'exact' });
    expect(parseDateText('1968-3-21')).toEqual({ date: '1968-03-21', precision: 'exact' });
    expect(parseDateText('1.1.1968')).toEqual({ date: '1968-01-01', precision: 'exact' });
  });

  it('refuses a day that does not exist, and words', () => {
    expect(parseDateText('31/02/1968')).toBeNull();
    expect(parseDateText('about 1950')).toBeNull();
    expect(parseDateText('')).toBeNull();
  });
});

describe('dateToText', () => {
  it('shows only what is known', () => {
    expect(dateToText('1968-01-01', 'year')).toBe('1968');
    expect(dateToText('1968-03-01', 'month')).toBe('03/1968');
    expect(dateToText('1968-03-21', 'exact')).toBe('1968-03-21');
    expect(dateToText('1968-03-21', null)).toBe('1968-03-21');
    expect(dateToText('1950-01-01', 'about')).toBe('1950');
    expect(dateToText('1950-03-01', 'about')).toBe('03/1950');
    expect(dateToText('1950-03-21', 'about')).toBe('1950-03-21');
    expect(dateToText('1950-01-01', 'unknown')).toBe('1950');
    expect(dateToText(null, 'exact')).toBe('');
  });

  it('reads back what it wrote for year, month and exact', () => {
    for (const [date, precision] of [['1968-01-01', 'year'], ['1968-03-01', 'month'], ['1968-03-21', 'exact'], ['1968-01-01', 'exact']] as const) {
      expect(parseDateText(dateToText(date, precision))).toEqual({ date, precision });
    }
  });
});

describe('dateFromBox', () => {
  it('a box nobody touched keeps the stored date and precision', () => {
    for (const [date, precision] of [
      ['1950-01-01', 'about'],
      ['1950-03-01', 'about'],
      ['1950-03-21', 'about'],
      ['1968-03-01', 'month'],
      ['1968-01-01', 'year'],
      ['1968-03-21', 'exact'],
      ['1950-01-01', 'unknown'],
      ['1968-03-21', null],
    ] as const) {
      const original = { date, precision };
      expect(dateFromBox(dateToText(date, precision), original)).toEqual({ date, precision });
    }
  });

  it('keeps only the day part of a stored timestamp', () => {
    expect(dateFromBox('1950', { date: '1950-01-01T00:00:00.000Z', precision: 'about' })).toEqual({ date: '1950-01-01', precision: 'about' });
  });

  it('a changed box saves what was typed', () => {
    const original = { date: '1950-01-01', precision: 'about' };
    expect(dateFromBox('1951', original)).toEqual({ date: '1951-01-01', precision: 'year' });
    expect(dateFromBox('04/1950', original)).toEqual({ date: '1950-04-01', precision: 'month' });
    expect(dateFromBox('2/4/1950', original)).toEqual({ date: '1950-04-02', precision: 'exact' });
  });

  it('an emptied box clears the date, and nonsense is refused', () => {
    expect(dateFromBox('  ', { date: '1950-01-01', precision: 'about' })).toEqual({ date: null, precision: null });
    expect(dateFromBox('', null)).toEqual({ date: null, precision: null });
    expect(dateFromBox('long ago', null)).toBeUndefined();
  });

  it('a new person has no stored date to keep', () => {
    expect(dateFromBox('1968')).toEqual({ date: '1968-01-01', precision: 'year' });
  });
});

// The 'Born' and 'Died' boxes: a date as typed, and back. No imports, so it can be tested on its own.
// A date is stored as a full day plus how exact it is: 'exact', 'month' (the 1st of that month), 'year' (1 January),
// 'about' (imported "about 1950") or 'unknown'. Opening a person and pressing Save must never change that.

export type TypedPrecision = 'year' | 'month' | 'exact';

function validDay(year: number, month: number, day: number): boolean {
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/**
 * 'Born (year is fine)': 1968, 03/1968 (a month), 1968-03-21 or 21/03/1968.
 * Null means the text could not be read as a date.
 */
export function parseDateText(text: string): { date: string; precision: TypedPrecision } | null {
  const value = text.trim();
  if (/^\d{4}$/.test(value)) return { date: `${value}-01-01`, precision: 'year' };

  // A month and a year: 03/1968, 3-1968, 03.1968 or 1968-03.
  let monthOnly = value.match(/^(\d{1,2})[/.-](\d{4})$/);
  let monthParts: [string, string] | null = monthOnly ? [monthOnly[2], monthOnly[1]] : null;
  if (!monthParts) {
    monthOnly = value.match(/^(\d{4})[/.-](\d{1,2})$/);
    if (monthOnly) monthParts = [monthOnly[1], monthOnly[2]];
  }
  if (monthParts) {
    const m = Number(monthParts[1]);
    if (m < 1 || m > 12) return null;
    return { date: `${monthParts[0]}-${monthParts[1].padStart(2, '0')}-01`, precision: 'month' };
  }

  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let parts: [string, string, string] | null = match ? [match[1], match[2], match[3]] : null;
  if (!parts) {
    match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (match) parts = [match[3], match[2], match[1]];
  }
  if (!parts) return null;
  const [year, month, day] = parts;
  if (!validDay(Number(year), Number(month), Number(day))) return null;
  return { date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, precision: 'exact' };
}

/** Back to what the box shows when editing: only as much of the date as is really known. */
export function dateToText(date: string | null | undefined, precision: string | null | undefined): string {
  if (!date) return '';
  const iso = date.slice(0, 10);
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  if (precision === 'year' || precision === 'unknown') return year;
  if (precision === 'month') return `${month}/${year}`;
  if (precision === 'about') {
    // "About 1950", "about March 1950", or a full day that is not certain.
    if (day !== '01') return iso;
    return month === '01' ? year : `${month}/${year}`;
  }
  return iso;
}

/**
 * A stored date as people say it, with only as much as is really known: "21 Mar 1968", "Mar 1968", "1968".
 * `about` is the word for an uncertain date in the reader's language ("About {{date}}").
 */
export function dateForReading(date: string | null | undefined, precision: string | null | undefined, locale: string, about: (date: string) => string): string {
  if (!date) return '';
  const iso = date.slice(0, 10);
  const [year, month, day] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
  if (!year) return '';
  // Built from the parts, at noon: a date has no time zone, and must never slip to the day before.
  const at = new Date(year, month - 1, day, 12);
  const full = () => at.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const monthYear = () => at.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
  if (precision === 'year' || precision === 'unknown') return String(year);
  if (precision === 'month') return monthYear();
  if (precision === 'about') return about(day !== 1 ? full() : month !== 1 ? monthYear() : String(year));
  return full();
}

export interface StoredDate {
  date: string | null | undefined;
  precision: string | null | undefined;
}

/**
 * What to save for a date box. A box left as it was opened saves the stored date and precision untouched, so
 * "about 1950" stays "about" and a month stays a month. Empty clears the date. Undefined: the text is not a date.
 */
export function dateFromBox(text: string, original?: StoredDate | null): { date: string | null; precision: string | null } | undefined {
  const value = text.trim();
  if (original?.date && value === dateToText(original.date, original.precision)) {
    return { date: original.date.slice(0, 10), precision: original.precision ?? null };
  }
  if (!value) return { date: null, precision: null };
  return parseDateText(value) ?? undefined;
}

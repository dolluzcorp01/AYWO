// Cleans a typed contact into the stored form used for 'Is this you?' matching and for opening the dialler.
import { getLocales } from 'expo-localization';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

export function normalizeContact(kind: 'mobile' | 'whatsapp' | 'email', value: string): string | null {
  const text = value.trim();
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.toLowerCase() : null;
  const region = (getLocales()[0]?.regionCode ?? 'IN') as CountryCode;
  const parsed = parsePhoneNumberFromString(text, region);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** 'Born (year is fine)': 1968, 1968-03-21 or 21/03/1968. Null means the text could not be read as a date. */
export function parseDateText(text: string): { date: string; precision: 'year' | 'exact' } | null {
  const value = text.trim();
  if (/^\d{4}$/.test(value)) return { date: `${value}-01-01`, precision: 'year' };
  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let parts: [string, string, string] | null = match ? [match[1], match[2], match[3]] : null;
  if (!parts) {
    match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (match) parts = [match[3], match[2], match[1]];
  }
  if (!parts) return null;
  const [year, month, day] = parts;
  const m = Number(month);
  const d = Number(day);
  const check = new Date(Date.UTC(Number(year), m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, precision: 'exact' };
}

/** Back to what the box shows when editing. */
export function dateToText(date: string | null | undefined, precision: string | null | undefined): string {
  if (!date) return '';
  const iso = date.slice(0, 10);
  return precision === 'year' || precision === 'about' ? iso.slice(0, 4) : iso;
}

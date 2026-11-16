// Day boxes on the Offers page. Staff type a day as year-month-day and always mean that day in India, whatever
// time zone the server or their browser uses. India has no summer time, so the offset is fixed.
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** `2026-12-5` becomes `2026-12-05`. Anything that is not a real day gives null. */
export function normalDay(text: string): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // 31 February rolls over to March, so the parts no longer match.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first or last second of that day in India, as the server wants it. Null when the day is not valid. */
export function dayToIso(day: string, endOfDay: boolean): string | null {
  const normal = normalDay(day);
  return normal ? `${normal}T${endOfDay ? '23:59:59' : '00:00:00'}+05:30` : null;
}

/** The day in India of a server time, whatever offset the server wrote it with. Empty when there is none. */
export function isoToDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Date(time + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

export function todayInIndia(now: Date = new Date()): string {
  return isoToDay(now.toISOString());
}

export type DayProblem = 'missing' | 'bad' | 'beforeStart';

/** What is wrong with a start day (needed) and an end day (empty means no end). Null means fine. */
export function checkDays(starts: string, ends: string): { starts: DayProblem | null; ends: DayProblem | null } {
  const start = normalDay(starts);
  const startProblem: DayProblem | null = starts.trim() ? (start ? null : 'bad') : 'missing';
  if (!ends.trim()) return { starts: startProblem, ends: null };
  const end = normalDay(ends);
  if (!end) return { starts: startProblem, ends: 'bad' };
  // Both are zero-padded, so comparing the text compares the days.
  return { starts: startProblem, ends: start && end < start ? 'beforeStart' : null };
}

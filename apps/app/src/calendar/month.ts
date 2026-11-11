// The month grid for the family calendar: whole weeks from Sunday to Saturday, as 'YYYY-MM-DD' text so no time zone
// can move a day. At most 6 weeks (42 days), well inside the 62 days the server answers for.

export interface Day {
  date: string;
  day: number;
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A date as 'YYYY-MM-DD', read in the phone's own time zone. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Weeks of the month, month0 counted from 0 (January). */
export function monthGrid(year: number, month0: number): Day[][] {
  const first = new Date(year, month0, 1);
  const start = new Date(year, month0, 1 - first.getDay());
  const last = new Date(year, month0 + 1, 0);
  const weeks: Day[][] = [];
  const d = new Date(start);
  while (weeks.length === 0 || d <= last) {
    const week: Day[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: ymd(d), day: d.getDate(), inMonth: d.getMonth() === month0 });
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** The first and last day shown in the grid: what to ask the server for. */
export function gridRange(year: number, month0: number): { from: string; to: string } {
  const weeks = monthGrid(year, month0);
  return { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date };
}

/** The month before or after, as [year, month0]. */
export function addMonths(year: number, month0: number, by: number): [number, number] {
  const d = new Date(year, month0 + by, 1);
  return [d.getFullYear(), d.getMonth()];
}

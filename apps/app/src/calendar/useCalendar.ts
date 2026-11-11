// The family calendar (0015 family_calendar): birthdays, wedding anniversaries, remembrance days and invitations.
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type CalendarKind = 'birthday' | 'anniversary' | 'remembrance' | 'event';

export interface CalendarItem {
  kind: CalendarKind;
  date: string;
  name: string;
  /** Age turned, years married, or years since passing. Null when the year is not known. */
  years?: number | null;
  /** My own birthday, or an invitation I am hosting. */
  me: boolean;
  person_id?: string;
  tree_id?: string;
  event_id?: string;
  event_kind?: string;
  starts_at?: string;
  place?: string | null;
}

export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.rpc<CalendarItem[]>('family_calendar', { p_from: from, p_to: to }),
    staleTime: 10 * 60_000,
  });
}

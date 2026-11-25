// The counts behind the admin panel's notifications, asked again every half minute while the panel is open.
// What to make of them is in waiting.ts.
import { useQuery } from '@tanstack/react-query';
import type { Dashboard } from '@/admin/types';
import { waitingFrom } from '@/admin/waiting';
import type { WaitingItem } from '@/admin/waiting';
import { api } from '@/lib/api';

const ASK_AGAIN_MS = 30_000;

/** `loaded` is false until the first counts are in: "nothing waiting" and "not known yet" are not the same. */
export function useAdminWaiting(): { items: WaitingItem[]; loaded: boolean } {
  const query = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api.get<Dashboard>('/admin/dashboard'),
    refetchInterval: ASK_AGAIN_MS,
  });
  return { items: waitingFrom(query.data), loaded: query.data !== undefined };
}

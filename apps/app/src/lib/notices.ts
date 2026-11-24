// The person's notifications: an answer to their invitation, a new invitation, a comment on a memory, an alert.
// The server sends each one ready to show (words in the person's language, and the screen a tap opens).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Notice {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** A screen of the app, such as /social/invites/<id>. */
  path: string;
  read_at: string | null;
  created_at: string;
}

export function useNotices() {
  return useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notice[]>('/notifications') });
}

/** How many are unread, for the number on the bell. Asked again every minute in case the live link is down. */
export function useUnreadNotices(): number {
  const count = useQuery({ queryKey: ['notifications-count'], queryFn: () => api.get<{ unread: number }>('/notifications/count'), refetchInterval: 60_000 });
  return count.data?.unread ?? 0;
}

export function refreshNotices(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['notifications'] });
  void client.invalidateQueries({ queryKey: ['notifications-count'] });
}

/** Marks one as read, or all of them when no id is given. */
export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id?: string) => api.post(id ? `/notifications/${id}/read` : '/notifications/read-all', {}),
    onSuccess: () => refreshNotices(client),
  });
}

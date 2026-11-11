import { QueryClient } from '@tanstack/react-query';
import { ApiFailure } from '@/lib/api';
import { KEEP_DAYS, KEEP_KEYS } from '@/lib/offlineKeep';

export function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Asking again will not change a refusal; a dropped connection may recover.
        retry: (count, error) => !(error instanceof ApiFailure && error.status < 500) && count < 2,
        // A failed screen shows an error beside parts that read the same query. Without this, each of those parts asks again
        // as it appears, which clears the error, unmounts them, fails again, and repeats forever. Try again buttons still work.
        retryOnMount: false,
      },
      // Changes are never queued for later: offline, they fail at once with a clear message (the app is read-only offline).
      mutations: { networkMode: 'always' },
    },
  });
  // What the phone keeps for offline use must stay in memory as long as the saved copy lasts.
  for (const key of KEEP_KEYS) client.setQueryDefaults([key], { gcTime: KEEP_DAYS * 24 * 60 * 60_000 });
  return client;
}

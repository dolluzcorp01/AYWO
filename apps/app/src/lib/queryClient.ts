import { QueryClient } from '@tanstack/react-query';
import { ApiFailure } from '@/lib/api';

export function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Asking again will not change a refusal; a dropped connection may recover.
        retry: (count, error) => !(error instanceof ApiFailure && error.status < 500) && count < 2,
        // A failed screen shows an error beside parts that read the same query. Without this, each of those parts asks again
        // as it appears, which clears the error, unmounts them, fails again, and repeats forever. Try again buttons still work.
        retryOnMount: false,
      },
    },
  });
}

// The app's way to move between screens: expo-router's, with one change. Opening the same screen twice in a row,
// within a moment, opens it once.
//
// On a slow phone a screen takes a moment to appear, and people tap again. Each tap used to open another copy of
// the same screen on top of the last, so Back had to be pressed once for every copy before anything changed.
// Every screen takes its router from here, so the fix covers every button and row, not only the ones that
// remembered to guard against it.
import { useRouter as useExpoRouter } from 'expo-router';
import { useMemo } from 'react';

type Router = ReturnType<typeof useExpoRouter>;

/** How long the same screen, asked for again, counts as the same tap. */
const SAME_TAP_MS = 1500;

// Shared by every screen: the second tap may come from a different button than the first.
let lastOpened = '';
let lastOpenedAt = 0;

function sameTap(href: unknown): boolean {
  let key: string;
  try {
    key = typeof href === 'string' ? href : JSON.stringify(href);
  } catch {
    return false;
  }
  const now = Date.now();
  const again = key === lastOpened && now - lastOpenedAt < SAME_TAP_MS;
  lastOpened = key;
  lastOpenedAt = now;
  return again;
}

export function useRouter(): Router {
  const router = useExpoRouter();
  return useMemo(
    () => ({
      ...router,
      push: ((href, options) => {
        if (!sameTap(href)) router.push(href, options);
      }) as Router['push'],
    }),
    [router],
  );
}

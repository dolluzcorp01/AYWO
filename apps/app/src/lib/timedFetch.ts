// fetch that gives up. On a stalled connection a plain fetch can hang for minutes, and every screen spins with it.
// A request that runs out of time fails the same way as one with no connection at all.

/** Ordinary calls. Long enough for a slow phone network, short enough that nobody stares at a spinner. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Calls where the server does real work before answering: imports, exports, the merge scan. */
export const SLOW_TIMEOUT_MS = 90_000;
/** Sending a photo or a file on a slow connection. */
export const UPLOAD_TIMEOUT_MS = 180_000;
/** Small background calls nobody waits for: the "are you there" check, sign-out, step notes. */
export const QUICK_TIMEOUT_MS = 10_000;

export async function timedFetch(url: string, init: RequestInit = {}, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

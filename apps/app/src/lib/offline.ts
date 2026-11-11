// Whether the app can reach AYWO right now. A failed request (no answer at all) marks the app offline; any answer marks
// it online again. While offline, React Query keeps showing saved data instead of errors, and a quiet check every
// 15 seconds notices when the connection is back. Web browsers also say when the connection drops or returns.
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

const CHECK_EVERY_MS = 15_000;

let offline = false;
/** When the app last heard from AYWO, or when the saved copy on this phone was made. */
let lastSync: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let healthUrl = '';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The API sets this, so the check can ask the server without a loop between the two files. */
export function setHealthUrl(url: string) {
  healthUrl = url;
}

export function isOffline(): boolean {
  return offline;
}

export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, () => offline, () => offline);
}

export function useLastSync(): number | null {
  return useSyncExternalStore(subscribe, () => lastSync, () => lastSync);
}

/** The saved copy on the phone was made at this time. */
export function setSavedAt(time: number) {
  if (lastSync === null || time > lastSync) {
    lastSync = time;
    emit();
  }
}

export function markOffline() {
  if (offline) return;
  offline = true;
  onlineManager.setOnline(false);
  emit();
  timer ??= setInterval(() => void checkNow(), CHECK_EVERY_MS);
}

export function markOnline() {
  const now = Date.now();
  // Every answer counts, but the screen only needs to hear about it now and then.
  const quiet = !offline && lastSync !== null && now - lastSync < 30_000;
  lastSync = now;
  if (quiet) return;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (offline) {
    offline = false;
    onlineManager.setOnline(true);
  }
  emit();
}

/** Asks the server if it is there. Used by the timer and the "Try now" button. */
export async function checkNow(): Promise<boolean> {
  if (!healthUrl) return false;
  try {
    const response = await fetch(healthUrl, { cache: 'no-store' });
    // Any answer means the server is reachable, even one that is not OK.
    markOnline();
    return response.ok;
  } catch {
    // No answer: a screen showing saved data sent no request of its own, so this is how the bar appears there too.
    markOffline();
    return false;
  }
}

// React Query's own guess (browser events) would fight ours; we decide.
onlineManager.setEventListener(() => () => undefined);

/** Called once when the app opens; phones also check each time the app comes back to the front. */
export function startOfflineChecks() {
  void checkNow();
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkNow();
    });
  }
}

if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('offline', markOffline);
  window.addEventListener('online', () => void checkNow());
}

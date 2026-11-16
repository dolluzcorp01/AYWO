// Anonymous step notes for the signup funnel (see db/migrations/0017_funnel.sql). Each step is sent once per device,
// with a random id made here, the platform and the language: never a name, number or account. A note that fails
// (offline, server busy) is simply tried again the next time that step happens. A note the server refuses as wrong
// (a 4xx answer) would be refused every time, so it is not sent again. Nothing here can slow or break the app.
import { Platform } from 'react-native';
import i18n from '@/i18n';
import { API_URL, deviceStore } from '@/lib/api';
import { isOffline } from '@/lib/offline';
import { QUICK_TIMEOUT_MS, timedFetch } from '@/lib/timedFetch';

export type Step = 'app_opened' | 'code_requested' | 'code_verified' | 'name_saved' | 'tree_started' | 'first_relative' | 'five_people' | 'invite_sent';

const DEVICE = 'aywo.deviceId';
const SENT = 'aywo.track.';
const inFlight = new Set<Step>();

/** A random version-4 id. Not secret and not tied to anyone: it only links one device's steps together. */
export function randomId(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * The language in the form POST /track accepts: a language and at most one more part. 'zh-Hant-TW' and 'zh-Hant-HK'
 * are sent as 'zh-Hant'; anything else that does not fit is sent as 'en'.
 */
export function trackLanguage(code: string | null | undefined): string {
  const short = (code ?? '').split(/[-_]/).slice(0, 2).join('-');
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(short) ? short : 'en';
}

async function deviceId(): Promise<string> {
  const saved = await deviceStore.get(DEVICE);
  if (saved) return saved;
  const made = randomId();
  await deviceStore.set(DEVICE, made);
  return made;
}

/** Notes that a step happened on this device. Fire and forget. */
export function track(step: Step): void {
  if (inFlight.has(step) || isOffline()) return;
  inFlight.add(step);
  void (async () => {
    try {
      if (await deviceStore.get(SENT + step)) return;
      const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
      const response = await timedFetch(
        `${API_URL}/track`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device: await deviceId(), event: step, platform, lang: trackLanguage(i18n.language) }),
        },
        QUICK_TIMEOUT_MS,
      );
      // Done, or refused for good. Only "too many, slow down" (429) and server trouble are worth another try.
      const refused = response.status >= 400 && response.status < 500 && response.status !== 429;
      if (response.ok || refused) await deviceStore.set(SENT + step, '1');
    } catch {
      // Tried again next time.
    } finally {
      inFlight.delete(step);
    }
  })();
}

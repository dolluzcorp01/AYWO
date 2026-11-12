// Anonymous step notes for the signup funnel (see db/migrations/0017_funnel.sql). Each step is sent once per device,
// with a random id made here, the platform and the language: never a name, number or account. A note that fails
// (offline, server busy) is simply tried again the next time that step happens. Nothing here can slow or break the app.
import { Platform } from 'react-native';
import i18n from '@/i18n';
import { API_URL, deviceStore } from '@/lib/api';
import { isOffline } from '@/lib/offline';

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
      const response = await fetch(`${API_URL}/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: await deviceId(), event: step, platform, lang: i18n.language || 'en' }),
      });
      if (response.ok) await deviceStore.set(SENT + step, '1');
    } catch {
      // Tried again next time.
    } finally {
      inFlight.delete(step);
    }
  })();
}

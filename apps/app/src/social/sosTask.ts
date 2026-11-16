// F-SOS-03: sends the phone's location while an SOS runs, with the app in the background or the phone locked.
// defineTask must run when the app starts, including when the system restarts it just for this task, so the root
// layout should import this file. It uses the event's own key: the sign-in token cannot be read on a locked iPhone.
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import i18n from '@/i18n';
import { api, API_URL } from '@/lib/api';

export const SOS_LOCATION_TASK = 'aywo-sos-location';
const KEY = 'aywo.sos';
const EVERY_MS = 20_000;
const EVERY_METRES = 15;

export interface RunningSos {
  id: string;
  writeToken: string;
  endsAt: string;
}

export type SosTracking = 'background' | 'foreground' | 'none';

async function loadRunning(): Promise<RunningSos | null> {
  const text =
    Platform.OS === 'web'
      ? (globalThis.localStorage?.getItem(KEY) ?? null)
      : await SecureStore.getItemAsync(KEY, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  return text ? (JSON.parse(text) as RunningSos) : null;
}

async function saveRunning(running: RunningSos | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (running) globalThis.localStorage?.setItem(KEY, JSON.stringify(running));
    else globalThis.localStorage?.removeItem(KEY);
    return;
  }
  if (running) await SecureStore.setItemAsync(KEY, JSON.stringify(running), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  else await SecureStore.deleteItemAsync(KEY, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
}

/** False when the server says the event is over. */
async function sendPlace(running: RunningSos, place: Location.LocationObject): Promise<boolean> {
  const response = await fetch(`${API_URL}/sos/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: running.writeToken,
      lat: place.coords.latitude,
      lng: place.coords.longitude,
      accuracy: place.coords.accuracy ?? null,
    }),
  });
  if (!response.ok) return response.status !== 403;
  const data = (await response.json()) as { active: boolean };
  return data.active;
}

let foregroundWatch: Location.LocationSubscription | null = null;
// Goes up on every start and every stop. A start that was waiting on a permission prompt when Stop was pressed sees
// that it is out of date and turns nothing on.
let turn = 0;
// A still phone gets no new place, so the clock ends tracking too, not only the next place.
let endTimer: ReturnType<typeof setTimeout> | undefined;

function endAt(endsAt: string): void {
  if (endTimer) clearTimeout(endTimer);
  const left = new Date(endsAt).getTime() - Date.now();
  if (Number.isNaN(left)) return;
  endTimer = setTimeout(() => void stopSosTracking().catch(() => undefined), Math.max(left, 0));
}

async function stopUpdates(): Promise<void> {
  foregroundWatch?.remove();
  foregroundWatch = null;
  if (Platform.OS === 'web') return;
  if (await Location.hasStartedLocationUpdatesAsync(SOS_LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(SOS_LOCATION_TASK).catch(() => undefined);
  }
}

/** Turns tracking off and forgets the key. Used on Stop, on signing out, and when the time has run out. */
export async function stopSosTracking(): Promise<void> {
  turn += 1;
  if (endTimer) clearTimeout(endTimer);
  endTimer = undefined;
  await stopUpdates();
  await saveRunning(null);
}

async function handlePlace(place: Location.LocationObject): Promise<void> {
  const running = await loadRunning();
  if (!running || new Date(running.endsAt).getTime() <= Date.now()) {
    await stopSosTracking();
    return;
  }
  // A dropped network must not stop tracking: the next place tries again.
  const stillActive = await sendPlace(running, place).catch(() => true);
  if (!stillActive) await stopSosTracking();
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(SOS_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await handlePlace(data.locations[data.locations.length - 1]);
  });
}

// When the app starts (opened by the person, or woken by the system): an SOS whose time ran out while the app was
// closed is turned off now, and one still running gets its end-of-time clock back.
void loadRunning()
  .then((running) => {
    if (!running) return undefined;
    if (new Date(running.endsAt).getTime() <= Date.now()) return stopSosTracking();
    endAt(running.endsAt);
    return undefined;
  })
  .catch(() => undefined);

async function begin(running: RunningSos): Promise<SosTracking> {
  turn += 1;
  const mine = turn;
  await saveRunning(running);
  if (turn !== mine) return 'none';
  endAt(running.endsAt);
  const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (turn !== mine || !foreground?.granted) return 'none';

  if (Platform.OS !== 'web') {
    const background = await Location.requestBackgroundPermissionsAsync().catch(() => null);
    if (turn !== mine) return 'none';
    if (background?.granted) {
      // Background updates carry on by themselves: a watcher left from before would only send everything twice.
      foregroundWatch?.remove();
      foregroundWatch = null;
      await Location.startLocationUpdatesAsync(SOS_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: EVERY_MS,
        distanceInterval: EVERY_METRES,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.Other,
        foregroundService: {
          notificationTitle: i18n.t('social.sos.trackingTitle'),
          notificationBody: i18n.t('social.sos.trackingBody'),
        },
      });
      if (turn !== mine) {
        // Stopped while this was starting.
        await stopUpdates();
        return 'none';
      }
      return 'background';
    }
  }

  const watch = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: EVERY_MS, distanceInterval: EVERY_METRES },
    (place) => void handlePlace(place).catch(() => undefined),
  );
  if (turn !== mine) {
    watch.remove();
    return 'none';
  }
  // Never two watchers: one that is replaced without being removed keeps the GPS on after Stop.
  foregroundWatch?.remove();
  foregroundWatch = watch;
  return 'foreground';
}

// One start at a time. A second call for the same SOS gets the answer of the one already going.
let starting: { id: string; done: Promise<SosTracking> } | null = null;

/** With 'always' permission, tracks in the background. Otherwise tracks while AYWO is open, and says so. */
export function startSosTracking(running: RunningSos): Promise<SosTracking> {
  if (starting?.id === running.id) return starting.done;
  const before = starting?.done.catch(() => 'none' as const);
  const done = (async () => {
    await before;
    return begin(running);
  })();
  const entry = { id: running.id, done };
  starting = entry;
  void done
    .catch(() => undefined)
    .then(() => {
      if (starting === entry) starting = null;
    });
  return done;
}

let resuming: { id: string; done: Promise<SosTracking> } | null = null;

async function resume(eventId: string): Promise<SosTracking> {
  if (starting?.id === eventId) return starting.done;
  const running = await loadRunning().catch(() => null);
  if (starting?.id === eventId) return starting.done;
  if (running && running.id === eventId) {
    if (new Date(running.endsAt).getTime() <= Date.now()) {
      await stopSosTracking();
      return 'none';
    }
    endAt(running.endsAt);
    if (Platform.OS !== 'web' && (await Location.hasStartedLocationUpdatesAsync(SOS_LOCATION_TASK).catch(() => false))) return 'background';
    if (foregroundWatch) return 'foreground';
    return startSosTracking(running);
  }
  // This phone has no key for the SOS: the reply to the start was lost, the app was put on again, or the SOS was
  // started on another phone. The server gives a new key (the old one stops working), so location can still be sent.
  const fresh = await api.rpc<{ write_token: string; ends_at: string } | null>('sos_resume', { p_event: eventId });
  if (!fresh?.write_token) return 'none';
  if (starting?.id === eventId) return starting.done;
  return startSosTracking({ id: eventId, writeToken: fresh.write_token, endsAt: fresh.ends_at });
}

/**
 * After the app was closed and opened again during an SOS, or when this phone never got the key.
 * Fails (rejects) only when the server could not be reached for a new key: the caller should try again.
 */
export function resumeSosTracking(eventId: string): Promise<SosTracking> {
  if (resuming?.id === eventId) return resuming.done;
  const done = resume(eventId);
  const entry = { id: eventId, done };
  resuming = entry;
  void done
    .catch(() => undefined)
    .then(() => {
      if (resuming === entry) resuming = null;
    });
  return done;
}

/** The quickest place the phone can give, without keeping the alert waiting. Null is fine. */
export async function quickPlace(): Promise<{ lat: number; lng: number } | null> {
  const permission = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!permission?.granted) return null;
  const place = await Location.getLastKnownPositionAsync().catch(() => null);
  return place ? { lat: place.coords.latitude, lng: place.coords.longitude } : null;
}

/** Asked ahead of time from the SOS screen, so no permission prompt gets in the way during an emergency. */
export async function prepareLocationPermission(): Promise<'always' | 'while_open' | 'denied'> {
  const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (!foreground?.granted) return 'denied';
  if (Platform.OS === 'web') return 'while_open';
  const background = await Location.requestBackgroundPermissionsAsync().catch(() => null);
  return background?.granted ? 'always' : 'while_open';
}

export async function locationPermissionNow(): Promise<'always' | 'while_open' | 'denied'> {
  const foreground = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (!foreground?.granted) return 'denied';
  if (Platform.OS === 'web') return 'while_open';
  const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
  return background?.granted ? 'always' : 'while_open';
}

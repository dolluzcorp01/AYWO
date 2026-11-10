// F-SOS-03: sends the phone's location while an SOS runs, with the app in the background or the phone locked.
// defineTask must run when the app starts, including when the system restarts it just for this task, so the root
// layout should import this file. It uses the event's own key: the sign-in token cannot be read on a locked iPhone.
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import i18n from '@/i18n';
import { API_URL } from '@/lib/api';

export const SOS_LOCATION_TASK = 'aywo-sos-location';
const KEY = 'aywo.sos';
const EVERY_MS = 20_000;
const EVERY_METRES = 15;

export interface RunningSos {
  id: string;
  writeToken: string;
  endsAt: string;
}

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

async function stopUpdates(): Promise<void> {
  foregroundWatch?.remove();
  foregroundWatch = null;
  if (Platform.OS === 'web') return;
  if (await Location.hasStartedLocationUpdatesAsync(SOS_LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(SOS_LOCATION_TASK).catch(() => undefined);
  }
}

/** Turns tracking off and forgets the key. Used on Stop, and when the time has run out. */
export async function stopSosTracking(): Promise<void> {
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

/** With 'always' permission, tracks in the background. Otherwise tracks while AYWO is open, and says so. */
export async function startSosTracking(running: RunningSos): Promise<'background' | 'foreground' | 'none'> {
  await saveRunning(running);
  const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (!foreground?.granted) return 'none';

  if (Platform.OS !== 'web') {
    const background = await Location.requestBackgroundPermissionsAsync().catch(() => null);
    if (background?.granted) {
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
      return 'background';
    }
  }

  foregroundWatch?.remove();
  foregroundWatch = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: EVERY_MS, distanceInterval: EVERY_METRES },
    (place) => void handlePlace(place),
  );
  return 'foreground';
}

/** After the app was closed and opened again during an SOS. */
export async function resumeSosTracking(eventId: string): Promise<'background' | 'foreground' | 'none'> {
  const running = await loadRunning().catch(() => null);
  if (!running || running.id !== eventId) return 'none';
  if (Platform.OS !== 'web' && (await Location.hasStartedLocationUpdatesAsync(SOS_LOCATION_TASK).catch(() => false))) return 'background';
  if (foregroundWatch) return 'foreground';
  return startSosTracking(running);
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

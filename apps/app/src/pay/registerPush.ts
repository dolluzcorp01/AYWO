// Push on Android and iOS. Call registerForPush() after login, and unregisterPush() before signing out.
// Expo has no push tokens on the web, so both do nothing there and expo-notifications is not even loaded.
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '@/lib/api';

let lastToken: string | null = null;

/** The sound file bundled through the expo-notifications plugin in app.json. The server names the same file. */
export const ALARM_SOUND = 'sos_alarm.wav';

/** Returns the token, or null on web, in a simulator, or when the person said no. Never throws: push is optional. */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    const Device = await import('expo-device');
    if (!Device.isDevice) return null;
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'AYWO',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      // A family SOS rings like an alarm, shows on the lock screen, and passes Do Not Disturb once the person allows it.
      await Notifications.setNotificationChannelAsync('sos-alarm', {
        name: 'Family SOS alarms',
        importance: Notifications.AndroidImportance.MAX,
        sound: ALARM_SOUND,
        vibrationPattern: [0, 800, 400, 800, 400, 800],
        enableVibrate: true,
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        audioAttributes: { usage: Notifications.AndroidAudioUsage.ALARM, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
      });
    }

    let { granted } = await Notifications.getPermissionsAsync();
    // allowCriticalAlerts only takes effect once Apple grants AYWO the Critical Alerts entitlement (docs/DEPLOY.md).
    if (!granted) ({ granted } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true, allowCriticalAlerts: true } }));
    if (!granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.post('/devices', { expo_push_token: token, platform: Platform.OS });
    lastToken = token;
    return token;
  } catch {
    return null;
  }
}

type PushData = { url?: unknown; kind?: unknown } | undefined;

/**
 * Shows notifications while the app is open, and reports taps. Returns the way to stop. Does nothing on the web.
 * A family SOS that arrives while the app is open goes straight to the alarm screen, which keeps ringing until seen.
 */
export function listenForPushTaps(onOpen: (url: string) => void): () => void {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return () => undefined;
  let stopped = false;
  let stop: (() => void) | null = null;
  void (async () => {
    const Notifications = await import('expo-notifications');
    if (stopped) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    const open = (response: { notification: { request: { content: { data?: unknown } } } } | null | undefined) => {
      const url = (response?.notification.request.content.data as PushData)?.url;
      if (typeof url === 'string') onOpen(url);
    };
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    const arrived = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as PushData;
      if (data?.kind === 'sos' && typeof data.url === 'string') onOpen(`${data.url}?alarm=1`);
    });
    stop = () => {
      tapped.remove();
      arrived.remove();
    };
    // The tap that started the app.
    open(await Notifications.getLastNotificationResponseAsync());
  })().catch(() => undefined);
  return () => {
    stopped = true;
    stop?.();
  };
}

/** Android: opens the screen where the person lets AYWO's SOS alarms ring through Do Not Disturb. */
export async function openDoNotDisturbAccess(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const IntentLauncher = await import('expo-intent-launcher');
  await IntentLauncher.startActivityAsync('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS').catch(() => undefined);
}

export async function unregisterPush(): Promise<void> {
  if (!lastToken) return;
  const token = lastToken;
  lastToken = null;
  await api.post('/devices/remove', { expo_push_token: token }).catch(() => undefined);
}

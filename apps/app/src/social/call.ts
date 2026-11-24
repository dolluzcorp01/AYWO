// F-SOS-04. Android: places the call, with the phone permission. iPhone: Apple allows only the call screen, ready for one tap.
// If the Android permission is refused, the dialler opens with the number filled in.
import { Linking, PermissionsAndroid, Platform } from 'react-native';

async function placeAndroidCall(phone: string): Promise<boolean> {
  const answer = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
  if (answer !== PermissionsAndroid.RESULTS.GRANTED) return false;
  const IntentLauncher = await import('expo-intent-launcher');
  await IntentLauncher.startActivityAsync('android.intent.action.CALL', { data: `tel:${phone}` });
  return true;
}

/**
 * A computer has nothing to call with: its browser takes a tel: link and does nothing, so the button looked broken.
 * Thrown there instead, so the screen can show the number to dial from a phone.
 */
export class NoDialler extends Error {}
function needDialler(): void {
  if (Platform.OS !== 'web') return;
  const nav = (globalThis as { navigator?: { maxTouchPoints?: number; userAgent?: string } }).navigator;
  const phoneLike = (nav?.maxTouchPoints ?? 0) > 0 || /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent ?? '');
  if (!phoneLike) throw new NoDialler();
}

export async function callNow(phone: string): Promise<void> {
  needDialler();
  if (Platform.OS === 'android') {
    const placed = await placeAndroidCall(phone).catch(() => false);
    if (placed) return;
  }
  await Linking.openURL(`tel:${phone}`);
}

/** The emergency number always goes through the phone's own dialler, one tap from the button. */
export async function dialEmergency(number: string): Promise<void> {
  needDialler();
  await Linking.openURL(`tel:${number}`);
}

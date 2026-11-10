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

export async function callNow(phone: string): Promise<void> {
  if (Platform.OS === 'android') {
    const placed = await placeAndroidCall(phone).catch(() => false);
    if (placed) return;
  }
  await Linking.openURL(`tel:${phone}`);
}

/** The emergency number always goes through the phone's own dialler, one tap from the button. */
export function dialEmergency(number: string): Promise<void> {
  return Linking.openURL(`tel:${number}`);
}

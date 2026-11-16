// Signing out, in the order that works: push and the store need the session that the last step ends.
import { signOut } from '@/lib/api';
import { unregisterPush } from '@/pay/registerPush';
import { signOutOfStore } from '@/pay/store';
import { stopSosTracking } from '@/social/sosTask';

export async function logOut(): Promise<void> {
  // An SOS left running must not keep sending this phone's location after the person has signed out.
  await stopSosTracking().catch(() => undefined);
  await unregisterPush().catch(() => undefined);
  await signOutOfStore().catch(() => undefined);
  await signOut();
}

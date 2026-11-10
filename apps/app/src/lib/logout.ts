// Signing out, in the order that works: push and the store need the session that the last step ends.
import { signOut } from '@/lib/api';
import { unregisterPush } from '@/pay/registerPush';
import { signOutOfStore } from '@/pay/store';

export async function logOut(): Promise<void> {
  await unregisterPush().catch(() => undefined);
  await signOutOfStore().catch(() => undefined);
  await signOut();
}

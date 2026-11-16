// A Plus purchase that has been paid for but not yet confirmed by the server (the provider's webhook can take a
// while). Remembered on the device, so closing and reopening the Plus screen cannot lead to paying a second time.
// It is forgotten once Plus appears, or after PENDING_MS, so a payment that truly never arrives does not block
// the person for ever.
import { deviceStore } from '@/lib/api';
import { pendingSince } from './pendingRule';

const KEY = 'aywo.plusPending';

export async function rememberPending(profileId: string): Promise<number> {
  const at = Date.now();
  await deviceStore.set(KEY, JSON.stringify({ at, profile: profileId })).catch(() => undefined);
  return at;
}

export async function readPending(profileId: string): Promise<number | null> {
  const saved = await deviceStore.get(KEY).catch(() => null);
  const since = pendingSince(saved, profileId, Date.now());
  // Someone else's, or too old: clear it away.
  if (saved && since === null) await deviceStore.remove(KEY).catch(() => undefined);
  return since;
}

export async function clearPending(): Promise<void> {
  await deviceStore.remove(KEY).catch(() => undefined);
}

// Web and type-checking version. Metro picks store.native.ts on Android and iOS, so react-native-purchases never
// reaches the web bundle. Keep the two files' exports the same.
import type { PlanPeriod } from './usePlan';

export interface StorePackage {
  price: string;
  freeTrial: boolean;
}
export type StorePackages = Partial<Record<PlanPeriod, StorePackage>>;

export const storeAvailable = false;

export async function loadStorePackages(_profileId: string): Promise<StorePackages> {
  return {};
}

export async function buyStorePlan(_period: PlanPeriod, _profileId: string): Promise<'bought' | 'cancelled'> {
  return 'cancelled';
}

export async function buyStoreInvite(_profileId: string): Promise<'bought' | 'cancelled'> {
  return 'cancelled';
}

export async function restoreStorePurchases(_profileId: string): Promise<boolean> {
  return false;
}

/** Call when signing out. */
export async function signOutOfStore(): Promise<void> {}

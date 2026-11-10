// Android and iOS: Google Play and Apple billing through RevenueCat (store rule). The purchase ends here; the plan
// changes when RevenueCat's webhook reaches our server, which is what the screens wait for.
import { Platform } from 'react-native';
import Purchases, { PRODUCT_CATEGORY } from 'react-native-purchases';
import type { PurchasesPackage } from 'react-native-purchases';
import { ApiFailure } from '@/lib/api';
import type { StorePackages } from './store';
import type { PlanPeriod } from './usePlan';

export type { StorePackage, StorePackages } from './store';

const ENTITLEMENT = 'plus';
const INVITE_PRODUCT = 'aywo_premium_invite';

// Public SDK keys that ship inside the app, read in full so that Expo can fill them in at build time.
const API_KEY =
  Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

export const storeAvailable = true;

function unavailable(): ApiFailure {
  return new ApiFailure(503, 'store_unavailable', 'errors.store_unavailable');
}

/** Purchases are tied to the AYWO profile, so the webhook knows who paid. */
async function ready(profileId: string): Promise<void> {
  if (!API_KEY) throw unavailable();
  if (await Purchases.isConfigured()) {
    if ((await Purchases.getAppUserID()) !== profileId) await Purchases.logIn(profileId);
    return;
  }
  Purchases.configure({ apiKey: API_KEY, appUserID: profileId });
}

async function packages(profileId: string): Promise<Partial<Record<PlanPeriod, PurchasesPackage>>> {
  await ready(profileId);
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  return { monthly: current?.monthly ?? undefined, yearly: current?.annual ?? undefined };
}

export async function loadStorePackages(profileId: string): Promise<StorePackages> {
  const found = await packages(profileId);
  const describe = (pkg: PurchasesPackage | undefined) =>
    pkg ? { price: pkg.product.priceString, freeTrial: pkg.product.introPrice?.price === 0 } : undefined;
  return { monthly: describe(found.monthly), yearly: describe(found.yearly) };
}

function wasCancelled(error: unknown): boolean {
  return !!(error as { userCancelled?: boolean | null })?.userCancelled;
}

export async function buyStorePlan(period: PlanPeriod, profileId: string): Promise<'bought' | 'cancelled'> {
  const pkg = (await packages(profileId))[period];
  if (!pkg) throw unavailable();
  try {
    await Purchases.purchasePackage(pkg);
    return 'bought';
  } catch (error) {
    if (wasCancelled(error)) return 'cancelled';
    throw unavailable();
  }
}

/** Premium invite designs are digital goods, so inside the apps they must use store billing. */
export async function buyStoreInvite(profileId: string): Promise<'bought' | 'cancelled'> {
  await ready(profileId);
  const [product] = await Purchases.getProducts([INVITE_PRODUCT], PRODUCT_CATEGORY.NON_SUBSCRIPTION);
  if (!product) throw unavailable();
  try {
    await Purchases.purchaseStoreProduct(product);
    return 'bought';
  } catch (error) {
    if (wasCancelled(error)) return 'cancelled';
    throw unavailable();
  }
}

/** True when the store holds a live Plus for this account. Plus itself still comes from the server. */
export async function restoreStorePurchases(profileId: string): Promise<boolean> {
  await ready(profileId);
  try {
    const info = await Purchases.restorePurchases();
    return info.entitlements.active[ENTITLEMENT] !== undefined;
  } catch {
    throw unavailable();
  }
}

export async function signOutOfStore(): Promise<void> {
  if (!(await Purchases.isConfigured())) return;
  if (await Purchases.isAnonymous()) return;
  await Purchases.logOut();
}

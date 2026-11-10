// GET /plan is the only source for Plus in the app. A purchase never unlocks anything until the server says so.
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { api, ApiFailure } from '@/lib/api';

export type WebMethod = 'upi' | 'debit' | 'credit' | 'apple_pay' | 'card';
export type PlanPeriod = 'monthly' | 'yearly';

export interface PlanMember {
  profile_id: string;
  display_name: string;
  is_payer: boolean;
}

export interface PriceTag {
  amount: number;
  currency: string;
  display: string;
}

export interface PlanInfo {
  profile_id: string;
  plus: boolean;
  status: 'trial' | 'active' | 'grace' | 'expired' | 'cancelled' | null;
  store: 'apple' | 'google' | 'razorpay' | 'stripe' | null;
  product_id: string | null;
  renews_at: string | null;
  trial_ends_at: string | null;
  will_renew: boolean;
  is_payer: boolean;
  trial_eligible: boolean;
  members: PlanMember[];
  country: string | null;
  provider: 'razorpay' | 'stripe';
  prices: { monthly: PriceTag; yearly: PriceTag & { trial_days: number } };
  web_methods: WebMethod[];
}

export const PLAN_KEY = ['plan'];
export const FAMILY_PLAN_MAX = 6;
export const PRODUCT_OF: Record<PlanPeriod, string> = { monthly: 'aywo_plus_monthly', yearly: 'aywo_plus_yearly' };

/** Set waitingForPlus after paying: webhooks take a moment, so this asks again until Plus appears. */
export function usePlan(waitingForPlus = false) {
  return useQuery({
    queryKey: PLAN_KEY,
    queryFn: () => api.get<PlanInfo>('/plan'),
    refetchInterval: (query) => (waitingForPlus && !query.state.data?.plus ? 3000 : false),
  });
}

export function payErrorText(t: TFunction, error: unknown): string {
  const key = error instanceof ApiFailure ? error.messageKey : 'errors.server_error';
  return t(key, { defaultValue: t('pay.somethingWrong') });
}

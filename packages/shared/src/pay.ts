// Payment rules with no outside calls: who pays through whom, what each provider's event means for a plan.
// The API uses these in its webhooks, and pay.test.ts checks them.

export type PlanStatus = 'trial' | 'active' | 'grace' | 'expired' | 'cancelled';
export type PlusProduct = 'aywo_plus_monthly' | 'aywo_plus_yearly';
export type PayProvider = 'razorpay' | 'stripe';
export type WebMethod = 'upi' | 'debit' | 'credit' | 'apple_pay' | 'card';

export const TRIAL_DAYS = 60;
export const FAMILY_PLAN_MAX = 6;

export interface PriceTag {
  amount: number;
  currency: 'INR' | 'USD';
  display: string;
}

export interface PlanChange {
  status: PlanStatus;
  willRenew: boolean;
  trialEndsAt: Date | null;
  renewsAt: Date | null;
}

const fromSeconds = (value: number | null | undefined): Date | null => (value ? new Date(value * 1000) : null);
const fromMillis = (value: number | null | undefined): Date | null => (value ? new Date(value) : null);

/** +91 pays through Razorpay; anyone else, including a profile with no phone, through Stripe. */
export function providerForPhone(phone: string | null | undefined): PayProvider {
  return phone?.startsWith('+91') ? 'razorpay' : 'stripe';
}

export function pricesFor(provider: PayProvider): { monthly: PriceTag; yearly: PriceTag & { trial_days: number } } {
  return provider === 'razorpay'
    ? {
        monthly: { amount: 29, currency: 'INR', display: '₹29' },
        yearly: { amount: 399, currency: 'INR', display: '₹399', trial_days: TRIAL_DAYS },
      }
    : {
        monthly: { amount: 0.99, currency: 'USD', display: '$0.99' },
        yearly: { amount: 9.99, currency: 'USD', display: '$9.99', trial_days: TRIAL_DAYS },
      };
}

export function webMethodsFor(provider: PayProvider): WebMethod[] {
  return provider === 'razorpay' ? ['upi', 'debit', 'credit'] : ['apple_pay', 'card'];
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export interface RazorpaySubscription {
  id: string;
  status?: string;
  plan_id?: string;
  start_at?: number | null;
  charge_at?: number | null;
  current_end?: number | null;
  notes?: Record<string, string> | unknown[] | null;
}

/** Null means the event says nothing about the plan. nowSeconds is the moment the event was created. */
export function razorpayPlanChange(event: string, sub: RazorpaySubscription, nowSeconds: number): PlanChange | null {
  const renewsAt = fromSeconds(sub.current_end ?? sub.charge_at);
  switch (event) {
    case 'subscription.authenticated':
      // The free months: the customer has approved the mandate and the first charge is on start_at.
      // A start within a day is an ordinary paid start, which 'activated' will report.
      if (!sub.start_at || sub.start_at <= nowSeconds + 86_400) return null;
      return { status: 'trial', willRenew: true, trialEndsAt: fromSeconds(sub.start_at), renewsAt: fromSeconds(sub.start_at) };
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.resumed':
      return { status: 'active', willRenew: true, trialEndsAt: null, renewsAt };
    case 'subscription.pending':
      return { status: 'grace', willRenew: true, trialEndsAt: null, renewsAt };
    case 'subscription.halted':
    case 'subscription.paused':
      return { status: 'expired', willRenew: false, trialEndsAt: null, renewsAt: null };
    case 'subscription.completed':
      return { status: 'expired', willRenew: false, trialEndsAt: null, renewsAt: null };
    case 'subscription.cancelled':
      return { status: 'cancelled', willRenew: false, trialEndsAt: null, renewsAt: null };
    default:
      return null;
  }
}

export interface StripeSubscriptionFacts {
  status: string;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  /** On the subscription item since Stripe API 2025-03-31. */
  current_period_end?: number | null;
}

export function stripePlanChange(sub: StripeSubscriptionFacts): PlanChange | null {
  const willRenew = !sub.cancel_at_period_end;
  const renewsAt = fromSeconds(sub.current_period_end);
  switch (sub.status) {
    case 'trialing':
      return { status: 'trial', willRenew, trialEndsAt: fromSeconds(sub.trial_end), renewsAt: fromSeconds(sub.trial_end) ?? renewsAt };
    case 'active':
      return { status: 'active', willRenew, trialEndsAt: null, renewsAt };
    case 'past_due':
      return { status: 'grace', willRenew, trialEndsAt: null, renewsAt };
    case 'unpaid':
    case 'incomplete_expired':
    case 'paused':
      return { status: 'expired', willRenew: false, trialEndsAt: null, renewsAt: null };
    case 'canceled':
      return { status: 'cancelled', willRenew: false, trialEndsAt: null, renewsAt: null };
    default:
      return null; // 'incomplete': the first payment has not gone through yet
  }
}

export interface RevenueCatEvent {
  type: string;
  period_type?: string | null;
  expiration_at_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  cancel_reason?: string | null;
}

export function revenueCatPlanChange(event: RevenueCatEvent): PlanChange | null {
  const inTrial = event.period_type === 'TRIAL';
  const until = fromMillis(event.expiration_at_ms);
  const running = (willRenew: boolean): PlanChange => ({
    status: inTrial ? 'trial' : 'active',
    willRenew,
    trialEndsAt: inTrial ? until : null,
    renewsAt: until,
  });
  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'SUBSCRIPTION_EXTENDED':
    case 'REFUND_REVERSED':
      return running(true);
    case 'CANCELLATION':
      // A customer turning off renewal keeps what they paid for. A refund ends it at once.
      if (event.cancel_reason === 'CUSTOMER_SUPPORT') {
        return { status: 'cancelled', willRenew: false, trialEndsAt: null, renewsAt: null };
      }
      return running(false);
    case 'BILLING_ISSUE':
      return {
        status: 'grace',
        willRenew: true,
        trialEndsAt: null,
        renewsAt: fromMillis(event.grace_period_expiration_at_ms) ?? until,
      };
    case 'EXPIRATION':
      return { status: 'expired', willRenew: false, trialEndsAt: null, renewsAt: until };
    default:
      return null;
  }
}

/** Play Console reports 'aywo_plus_yearly:base-plan'; App Store Connect the bare id. Anything else is not Plus. */
export function plusProductFromStore(productId: string | null | undefined): PlusProduct | null {
  const bare = (productId ?? '').split(':')[0];
  return bare === 'aywo_plus_monthly' || bare === 'aywo_plus_yearly' ? bare : null;
}

export function revenueCatStore(store: string | null | undefined): 'apple' | 'google' | null {
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'apple';
  if (store === 'PLAY_STORE') return 'google';
  return null;
}

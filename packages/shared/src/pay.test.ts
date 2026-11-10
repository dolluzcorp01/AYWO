import { describe, expect, it } from 'vitest';
import {
  plusProductFromStore,
  pricesFor,
  providerForPhone,
  razorpayPlanChange,
  revenueCatPlanChange,
  revenueCatStore,
  stripePlanChange,
  webMethodsFor,
} from './pay.ts';

describe('who pays through whom', () => {
  it('sends +91 to Razorpay and everyone else to Stripe', () => {
    expect(providerForPhone('+919800000001')).toBe('razorpay');
    expect(providerForPhone('+14155550100')).toBe('stripe');
    expect(providerForPhone(null)).toBe('stripe');
  });

  it('does not read +91 from the middle of a number', () => {
    expect(providerForPhone('+1919800000')).toBe('stripe');
  });

  it('has the frozen prices', () => {
    expect(pricesFor('razorpay').monthly.amount).toBe(29);
    expect(pricesFor('razorpay').yearly.amount).toBe(399);
    expect(pricesFor('stripe').monthly.amount).toBe(0.99);
    expect(pricesFor('stripe').yearly.amount).toBe(9.99);
    expect(pricesFor('stripe').yearly.trial_days).toBe(60);
  });

  it('offers the right methods', () => {
    expect(webMethodsFor('razorpay')).toEqual(['upi', 'debit', 'credit']);
    expect(webMethodsFor('stripe')).toEqual(['apple_pay', 'card']);
  });
});

describe('razorpayPlanChange', () => {
  const now = 1_800_000_000;

  it('starts the free months when a mandate is approved with a later first charge', () => {
    const later = now + 60 * 86400;
    const change = razorpayPlanChange('subscription.authenticated', { id: 's', start_at: later }, now);
    expect(change?.status).toBe('trial');
    expect(change?.trialEndsAt?.getTime()).toBe(later * 1000);
  });

  it('gives nothing for an approved mandate that charges today', () => {
    expect(razorpayPlanChange('subscription.authenticated', { id: 's', start_at: null }, now)).toBeNull();
    expect(razorpayPlanChange('subscription.authenticated', { id: 's', start_at: now + 30 }, now)).toBeNull();
  });

  it('maps the life of a subscription', () => {
    expect(razorpayPlanChange('subscription.charged', { id: 's', current_end: now }, now)?.status).toBe('active');
    expect(razorpayPlanChange('subscription.pending', { id: 's' }, now)?.status).toBe('grace');
    expect(razorpayPlanChange('subscription.halted', { id: 's' }, now)?.status).toBe('expired');
    expect(razorpayPlanChange('subscription.cancelled', { id: 's' }, now)?.status).toBe('cancelled');
    expect(razorpayPlanChange('subscription.updated', { id: 's' }, now)).toBeNull();
  });
});

describe('stripePlanChange', () => {
  it('maps statuses', () => {
    expect(stripePlanChange({ status: 'trialing', trial_end: 100 })?.status).toBe('trial');
    expect(stripePlanChange({ status: 'active' })?.status).toBe('active');
    expect(stripePlanChange({ status: 'past_due' })?.status).toBe('grace');
    expect(stripePlanChange({ status: 'canceled' })?.status).toBe('cancelled');
    expect(stripePlanChange({ status: 'unpaid' })?.status).toBe('expired');
  });

  it('does not grant Plus before the first payment', () => {
    expect(stripePlanChange({ status: 'incomplete' })).toBeNull();
  });

  it('keeps Plus until the period ends when renewal is turned off', () => {
    const change = stripePlanChange({ status: 'active', cancel_at_period_end: true, current_period_end: 100 });
    expect(change?.status).toBe('active');
    expect(change?.willRenew).toBe(false);
  });
});

describe('revenueCatPlanChange', () => {
  it('reads a trial purchase', () => {
    const change = revenueCatPlanChange({ type: 'INITIAL_PURCHASE', period_type: 'TRIAL', expiration_at_ms: 5000 });
    expect(change?.status).toBe('trial');
    expect(change?.trialEndsAt?.getTime()).toBe(5000);
  });

  it('keeps Plus when renewal is turned off, ends it on a refund', () => {
    const off = revenueCatPlanChange({ type: 'CANCELLATION', period_type: 'NORMAL', cancel_reason: 'UNSUBSCRIBE' });
    expect(off?.status).toBe('active');
    expect(off?.willRenew).toBe(false);
    expect(revenueCatPlanChange({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' })?.status).toBe('cancelled');
  });

  it('maps billing trouble and the end', () => {
    expect(revenueCatPlanChange({ type: 'BILLING_ISSUE' })?.status).toBe('grace');
    expect(revenueCatPlanChange({ type: 'EXPIRATION' })?.status).toBe('expired');
    expect(revenueCatPlanChange({ type: 'TEST' })).toBeNull();
  });
});

describe('store product names', () => {
  it('reads Play base plans', () => {
    expect(plusProductFromStore('aywo_plus_yearly:yearly-base')).toBe('aywo_plus_yearly');
    expect(plusProductFromStore('aywo_plus_monthly')).toBe('aywo_plus_monthly');
    expect(plusProductFromStore('aywo_premium_invite')).toBeNull();
  });

  it('reads stores', () => {
    expect(revenueCatStore('APP_STORE')).toBe('apple');
    expect(revenueCatStore('PLAY_STORE')).toBe('google');
    expect(revenueCatStore('PROMOTIONAL')).toBeNull();
  });
});

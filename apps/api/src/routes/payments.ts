// AYWO Plus and one-time purchases (LLD L10). Cards and UPI are entered on Razorpay's and Stripe's own pages:
// no card data ever reaches this server. Only the signed webhooks at the bottom change family_plans.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  isUuid,
  plusProductFromStore,
  pricesFor,
  providerForPhone,
  razorpayPlanChange,
  revenueCatPlanChange,
  revenueCatStore,
  stripePlanChange,
  TRIAL_DAYS,
  webMethodsFor,
} from '@aywo/shared';
import type { PlanChange, PlusProduct, RazorpaySubscription, RevenueCatEvent } from '@aywo/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { PoolClient } from 'pg';
import Stripe from 'stripe';
import { z } from 'zod';
import { requireUser } from '../auth-tokens.ts';
import { config, isProduction, isReviewerLogin } from '../config.ts';
import { asCaller, asServer } from '../db.ts';
import { ApiError } from '../errors.ts';
import { staffCall } from '../staff.ts';

const stripe = new Stripe(config.STRIPE_SECRET_KEY);

// One-time prices, in paise and cents. The server alone sets them. FOUNDER TO CONFIRM: the PRD has no prices yet.
const ORDER_PRICES = {
  tree_poster: { inr: 79900, usd: 1999, label: 'AYWO family tree poster' },
  family_book: { inr: 149900, usd: 3999, label: 'AYWO family book' },
  premium_invite: { inr: 4900, usd: 199, label: 'AYWO premium invite' },
} as const;
const STORE_INVITE_PRODUCT = 'aywo_premium_invite';
const STRIPE_SHIP_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'NZ', 'SG', 'MY', 'AE', 'DE', 'FR', 'NL', 'IE'] as const;

const plusBody = z.object({ product_id: z.enum(['aywo_plus_monthly', 'aywo_plus_yearly']) });

const shipping = z.object({
  name: z.string().min(1).max(120),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postal_code: z.string().min(3).max(12),
  country: z.string().length(2),
  phone: z.string().min(5).max(30),
});

const orderBody = z.object({
  product: z.enum(['tree_poster', 'family_book', 'premium_invite']),
  platform: z.enum(['web', 'ios', 'android']).default('web'),
  tree_id: z.guid().optional(),
  design_id: z.string().max(100).optional(),
  quantity: z.number().int().min(1).max(10).default(1),
  shipping: shipping.optional(),
  coupon: z.string().trim().max(20).optional(),
});

interface Buyer {
  phone: string | null;
  email: string | null;
  hasPlus: boolean;
  hadTrial: boolean;
}

async function loadBuyer(userId: string): Promise<Buyer> {
  return asCaller(userId, async (db) => {
    const { rows } = await db.query(
      `select p.login_phone, p.email, has_plus(p.id) as plus,
              exists (select 1 from family_plans f where f.payer_id = p.id and f.trial_ends_at is not null) as had_trial
       from profiles p where p.id = $1`,
      [userId],
    );
    if (!rows[0]) throw new ApiError(404, 'not_found');
    return { phone: rows[0].login_phone, email: rows[0].email, hasPlus: rows[0].plus, hadTrial: rows[0].had_trial };
  });
}

/** The caller's own subscription; its id is never taken from the app. */
async function payersLivePlan(userId: string): Promise<{ store: string; external_id: string; status: string }> {
  const plan = await asCaller(userId, async (db) => {
    const { rows } = await db.query(
      `select store, external_id, status from family_plans
       where payer_id = $1 and status in ('trial', 'active', 'grace')
       order by last_event_at desc nulls last limit 1`,
      [userId],
    );
    return rows[0];
  });
  if (!plan) throw new ApiError(404, 'no_active_subscription');
  return plan;
}

async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${config.RAZORPAY_KEY_ID}:${config.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new ApiError(502, 'payment_provider_error');
  return (await response.json()) as T;
}

/** Turns a Stripe failure into our error shape. The provider's message can hold details, so it stays out of replies. */
async function stripeCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch {
    throw new ApiError(502, 'payment_provider_error');
  }
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const buying = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  // ===== Plan =====
  app.get('/plan', async (req) => {
    const userId = await requireUser(req);
    const { summary, phone, bonus } = await asCaller(userId, async (db) => {
      const plan = await db.query(`select plan_summary() as summary`);
      const me = await db.query(`select login_phone, plus_bonus_until from profiles where id = $1`, [userId]);
      return {
        summary: plan.rows[0].summary as Record<string, unknown>,
        phone: (me.rows[0]?.login_phone ?? null) as string | null,
        bonus: (me.rows[0]?.plus_bonus_until ?? null) as Date | null,
      };
    });
    const provider = providerForPhone(phone);
    return {
      ...summary,
      profile_id: userId,
      // Free Plus days from referrals or support. They count as Plus without any store plan.
      bonus_until: bonus && bonus.getTime() > Date.now() ? bonus.toISOString() : null,
      country: phone ? (parsePhoneNumberFromString(phone)?.country ?? null) : null,
      provider,
      prices: pricesFor(provider),
      web_methods: webMethodsFor(provider),
    };
  });

  app.post('/plan/members', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
    const userId = await requireUser(req);
    const body = z
      .object({ phone: z.string().min(5).max(30).optional(), profile_id: z.guid().optional(), person_id: z.guid().optional() })
      .refine((b) => [b.phone, b.profile_id, b.person_id].filter(Boolean).length === 1)
      .parse(req.body);

    let phone: string | null = null;
    if (body.phone) {
      // A number typed without a country code is read in the payer's own country.
      const own = (await loadBuyer(userId)).phone;
      const country = own ? parsePhoneNumberFromString(own)?.country : undefined;
      const parsed = parsePhoneNumberFromString(body.phone, country);
      if (!parsed || !parsed.isValid()) throw new ApiError(422, 'phone_invalid');
      phone = parsed.number;
    }
    // In its own transaction, because a refused number rolls back the call below and would otherwise not be counted.
    const allowed = await asServer(async (db) => {
      const { rows } = await db.query(`select plan_member_try($1) as ok`, [userId]);
      return rows[0].ok as boolean;
    });
    if (!allowed) throw new ApiError(429, 'too_many_requests');
    return asCaller(userId, async (db) => {
      const { rows } = await db.query(`select plan_add_member($1, $2::uuid, $3::uuid) as added`, [
        phone,
        body.profile_id ?? null,
        body.person_id ?? null,
      ]);
      return rows[0].added;
    });
  });

  app.delete<{ Params: { profile_id: string } }>('/plan/members/:profile_id', async (req) => {
    const userId = await requireUser(req);
    const profileId = z.guid().parse(req.params.profile_id);
    await asCaller(userId, (db) => db.query(`select plan_remove_member($1)`, [profileId]));
    return { ok: true };
  });

  // ===== Razorpay: web, India =====
  app.post('/pay/razorpay/subscribe', buying, async (req) => {
    const userId = await requireUser(req);
    const { product_id: productId } = plusBody.parse(req.body);
    const buyer = await loadBuyer(userId);
    if (providerForPhone(buyer.phone) !== 'razorpay') throw new ApiError(422, 'wrong_payment_region');
    if (buyer.hasPlus) throw new ApiError(409, 'already_plus');

    const yearly = productId === 'aywo_plus_yearly';
    const giveTrial = yearly && !buyer.hadTrial;
    const created = await razorpay<{ id: string }>('/subscriptions', {
      plan_id: yearly ? config.RAZORPAY_PLAN_YEARLY : config.RAZORPAY_PLAN_MONTHLY,
      total_count: yearly ? 10 : 120,
      quantity: 1,
      customer_notify: 1,
      // A first charge 60 days away is how Razorpay does a free trial.
      ...(giveTrial ? { start_at: Math.floor(Date.now() / 1000) + TRIAL_DAYS * 86_400 } : {}),
      notes: { profile_id: userId, product_id: productId },
    });
    return { subscription_id: created.id, key_id: config.RAZORPAY_KEY_ID };
  });

  // Cancelling asks Razorpay; the plan changes when its signed webhook arrives. A trial has no paid period to run out,
  // so it ends straight away. Anything paid runs to the end of the period.
  app.post('/pay/razorpay/cancel', buying, async (req) => {
    const userId = await requireUser(req);
    const plan = await payersLivePlan(userId);
    if (plan.store !== 'razorpay') throw new ApiError(422, 'wrong_payment_region');
    await razorpay(`/subscriptions/${encodeURIComponent(plan.external_id)}/cancel`, {
      cancel_at_cycle_end: plan.status === 'trial' ? 0 : 1,
    });
    return { ok: true };
  });

  // ===== Stripe: web, overseas =====
  app.post('/pay/stripe/checkout', buying, async (req) => {
    const userId = await requireUser(req);
    const { product_id: productId } = plusBody.parse(req.body);
    const buyer = await loadBuyer(userId);
    if (providerForPhone(buyer.phone) !== 'stripe') throw new ApiError(422, 'wrong_payment_region');
    if (buyer.hasPlus) throw new ApiError(409, 'already_plus');

    const yearly = productId === 'aywo_plus_yearly';
    const session = await stripeCall(() =>
      stripe.checkout.sessions.create({
        mode: 'subscription',
        // 'card' covers Apple Pay and Google Pay on Stripe's own page, where the browser supports them.
        allowed_payment_method_types: ['card'],
        line_items: [{ price: yearly ? config.STRIPE_PRICE_YEARLY : config.STRIPE_PRICE_MONTHLY, quantity: 1 }],
        client_reference_id: userId,
        ...(buyer.email ? { customer_email: buyer.email } : {}),
        // Promotion codes are made in Stripe's dashboard and recorded in the staff Offers page.
        allow_promotion_codes: true,
        subscription_data: {
          metadata: { profile_id: userId, product_id: productId },
          ...(yearly && !buyer.hadTrial ? { trial_period_days: TRIAL_DAYS } : {}),
        },
        success_url: `${config.WEB_URL}/plus?checkout=success`,
        cancel_url: `${config.WEB_URL}/plus`,
      }),
    );
    if (!session.url) throw new ApiError(502, 'payment_provider_error');
    return { url: session.url };
  });

  app.post('/pay/stripe/portal', buying, async (req) => {
    const userId = await requireUser(req);
    const plan = await payersLivePlan(userId);
    if (plan.store !== 'stripe') throw new ApiError(422, 'wrong_payment_region');
    const portal = await stripeCall(async () => {
      const sub = await stripe.subscriptions.retrieve(plan.external_id);
      const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      return stripe.billingPortal.sessions.create({ customer, return_url: `${config.WEB_URL}/family-plan` });
    });
    return { url: portal.url };
  });

  // ===== One-time purchases =====
  // What the shop shows: the buyer's currency and the server's own prices, so the app never sets a price.
  app.get('/pay/products', async (req) => {
    const userId = await requireUser(req);
    const provider = providerForPhone((await loadBuyer(userId)).phone);
    const inr = provider === 'razorpay';
    return {
      provider,
      currency: inr ? 'INR' : 'USD',
      needs_address: inr,
      products: (Object.keys(ORDER_PRICES) as (keyof typeof ORDER_PRICES)[]).map((key) => ({
        product: key,
        amount_minor: inr ? ORDER_PRICES[key].inr : ORDER_PRICES[key].usd,
        physical: key !== 'premium_invite',
      })),
    };
  });

  app.post('/pay/order', buying, async (req) => {
    const userId = await requireUser(req);
    const body = orderBody.parse(req.body);
    const physical = body.product !== 'premium_invite';

    // Digital goods inside the apps must use store billing (contract: Payments).
    if (!physical && body.platform !== 'web') throw new ApiError(422, 'use_store_billing');
    if (physical && !body.tree_id) throw new ApiError(422, 'tree_required');
    if (body.tree_id) {
      const allowed = await asCaller(userId, async (db) => {
        const { rows } = await db.query(`select can_view_tree($1) as ok`, [body.tree_id]);
        return rows[0].ok as boolean;
      });
      if (!allowed) throw new ApiError(403, 'not_allowed');
    }

    const buyer = await loadBuyer(userId);
    const provider = providerForPhone(buyer.phone);
    if (provider === 'razorpay' && physical && !body.shipping) throw new ApiError(422, 'shipping_required');

    const price = ORDER_PRICES[body.product];
    const quantity = physical ? body.quantity : 1;
    const fullAmount = (provider === 'razorpay' ? price.inr : price.usd) * quantity;
    const currency = provider === 'razorpay' ? 'INR' : 'USD';
    const details = { quantity, design_id: body.design_id ?? null, shipping: body.shipping ?? null };

    // A coupon is checked by the database as the buyer, so its limits count this person's own orders.
    const quote = body.coupon
      ? await asCaller(userId, async (db) => {
          const { rows } = await db.query(`select coupon_quote($1, $2, $3, $4) as q`, [body.coupon, body.product, fullAmount, currency]);
          return rows[0].q as { coupon_id: string; discount_minor: number };
        })
      : null;
    const discount = quote ? Number(quote.discount_minor) : 0;
    const amount = fullAmount - discount;

    const orderId = await asServer(async (db) => {
      const { rows } = await db.query(
        `insert into one_time_orders (buyer_id, product, store, amount_minor, currency, tree_id, details, coupon_id, discount_minor)
         values ($1, $2, $3::store_t, $4, $5, $6, $7, $8, $9) returning id`,
        [userId, body.product, provider, amount, currency, body.tree_id ?? null, details, quote?.coupon_id ?? null, discount],
      );
      return rows[0].id as string;
    });

    const saveExternal = (external: string) =>
      asServer((db) => db.query(`update one_time_orders set external_id = $2 where id = $1`, [orderId, external]));
    const markFailed = () => asServer((db) => db.query(`update one_time_orders set status = 'failed' where id = $1`, [orderId]));

    try {
      const notes = { order_id: orderId, product: body.product, profile_id: userId };
      if (provider === 'razorpay' && body.platform !== 'web') {
        // The apps have no Razorpay Checkout, so physical goods open Razorpay's own hosted page.
        const link = await razorpay<{ id: string; short_url: string }>('/payment_links', {
          amount,
          currency,
          description: price.label,
          reference_id: orderId,
          reminder_enable: false,
          notes,
        });
        await saveExternal(link.id);
        return { provider, order_id: orderId, url: link.short_url };
      }
      if (provider === 'razorpay') {
        const order = await razorpay<{ id: string }>('/orders', { amount, currency, receipt: orderId, notes });
        await saveExternal(order.id);
        return { provider, order_id: orderId, razorpay_order_id: order.id, key_id: config.RAZORPAY_KEY_ID, amount, currency };
      }
      const session = await stripeCall(() =>
        stripe.checkout.sessions.create({
          mode: 'payment',
          allowed_payment_method_types: ['card'],
          // One line for the whole order, so a coupon's discount is exact whatever the quantity.
          line_items: [
            {
              quantity: 1,
              price_data: { currency: 'usd', unit_amount: amount, product_data: { name: quantity > 1 ? ` x ` : price.label } },
            },
          ],
          client_reference_id: userId,
          ...(buyer.email ? { customer_email: buyer.email } : {}),
          ...(physical ? { shipping_address_collection: { allowed_countries: [...STRIPE_SHIP_COUNTRIES] } } : {}),
          metadata: { order_id: orderId },
          payment_intent_data: { metadata: { order_id: orderId } },
          success_url: `${config.WEB_URL}/plus?order=success`,
          cancel_url: `${config.WEB_URL}/plus`,
        }),
      );
      await saveExternal(session.id);
      if (!session.url) throw new ApiError(502, 'payment_provider_error');
      return { provider, order_id: orderId, url: session.url };
    } catch (e) {
      await markFailed();
      throw e;
    }
  });

  // ===== Staff: refund a one-time order. The provider refunds first; only then is the order marked. =====
  app.post('/admin/orders/:id/refund', buying, async (req) => {
    const { id } = z.object({ id: z.guid() }).parse(req.params);
    const body = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
    // Checks the second step and the payments permission before anything is looked up.
    await staffCall(req, ['payments'], 'has_admin_permission', ['payments']);
    const order = await asServer(async (db) => {
      const { rows } = await db.query(`select store, status, payment_id, amount_minor from one_time_orders where id = $1`, [id]);
      return rows[0] as { store: string; status: string; payment_id: string | null; amount_minor: string } | undefined;
    });
    if (!order) throw new ApiError(404, 'admin_not_found');
    if (order.status !== 'paid' || !order.payment_id) throw new ApiError(409, 'order_not_refundable');
    if (order.store === 'razorpay') {
      await razorpay(`/payments/${encodeURIComponent(order.payment_id)}/refund`, { amount: Number(order.amount_minor), notes: { order_id: id } });
    } else if (order.store === 'stripe') {
      const paymentIntent = order.payment_id;
      await stripeCall(() => stripe.refunds.create({ payment_intent: paymentIntent, metadata: { order_id: id } }));
    } else {
      throw new ApiError(422, 'use_store_billing');
    }
    return staffCall(req, ['payments'], 'admin_order_refunded', [id, body.reason]);
  });

  // ===== Push tokens =====
  app.post('/devices', async (req) => {
    const userId = await requireUser(req);
    const body = z.object({ expo_push_token: z.string().max(200), platform: z.enum(['ios', 'android']) }).parse(req.body);
    await asCaller(userId, (db) => db.query(`select register_device($1, $2)`, [body.expo_push_token, body.platform]));
    return { ok: true };
  });

  // Call before signing out, so a shared phone stops getting the last person's notifications.
  app.post('/devices/remove', async (req) => {
    const userId = await requireUser(req);
    const body = z.object({ expo_push_token: z.string().max(200) }).parse(req.body);
    await asCaller(userId, (db) => db.query(`select unregister_device($1)`, [body.expo_push_token]));
    return { ok: true };
  });

  // ===== Webhooks =====
  // Registered as a child plugin so that this raw-body parser applies to these three routes and nothing else.
  await app.register(async (hooks) => {
    hooks.removeAllContentTypeParsers();
    hooks.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

    const webhook = { config: { rateLimit: { max: 1000, timeWindow: '1 minute' } } };

    hooks.post('/webhooks/razorpay', webhook, async (req) => {
      const secret = webhookSecret(config.RAZORPAY_WEBHOOK_SECRET);
      const raw = rawBody(req);
      const signature = headerOf(req, 'x-razorpay-signature');
      const expected = createHmac('sha256', secret).update(raw).digest('hex');
      if (!signature || !sameSecret(expected, signature)) throw new ApiError(401, 'bad_signature');

      const event = parseJson<RazorpayWebhook>(raw);
      // The same event keeps its id across Razorpay's retries.
      const eventId = headerOf(req, 'x-razorpay-event-id') ?? createHash('sha256').update(raw).digest('hex');
      await asServer(async (db) => {
        if (!(await firstTime(db, 'razorpay', eventId, event.event))) return;
        await handleRazorpay(db, event, req);
      });
      return { ok: true };
    });

    hooks.post('/webhooks/stripe', webhook, async (req) => {
      const secret = webhookSecret(config.STRIPE_WEBHOOK_SECRET);
      const signature = headerOf(req, 'stripe-signature');
      if (!signature) throw new ApiError(401, 'bad_signature');
      let event: Stripe.Event;
      try {
        // Checks the HMAC with a timing-safe compare and refuses a timestamp older than five minutes.
        event = stripe.webhooks.constructEvent(rawBody(req), signature, secret);
      } catch {
        throw new ApiError(401, 'bad_signature');
      }
      await asServer(async (db) => {
        if (!(await firstTime(db, 'stripe', event.id, event.type))) return;
        await handleStripe(db, event, req);
      });
      return { ok: true };
    });

    // RevenueCat does not sign its webhooks: the shared Authorization value set in its dashboard is the check.
    hooks.post('/webhooks/revenuecat', webhook, async (req) => {
      const secret = webhookSecret(config.REVENUECAT_WEBHOOK_AUTH);
      const given = headerOf(req, 'authorization');
      if (!given || !sameSecret(secret, given)) throw new ApiError(401, 'bad_signature');

      const event = parseJson<{ event?: RevenueCatWebhookEvent }>(rawBody(req)).event;
      if (!event?.id || !event.type) throw new ApiError(422, 'bad_input');
      await asServer(async (db) => {
        if (!(await firstTime(db, 'revenuecat', event.id, event.type))) return;
        await handleRevenueCat(db, event, req);
      });
      return { ok: true };
    });
  });
}

// ===== Webhook helpers =====

/**
 * A dummy secret is public knowledge, so in production it must refuse everything rather than accept forgeries.
 * The same goes for an empty one: anyone can compute an HMAC with an empty key, and an empty variable passes the config.
 */
function webhookSecret(value: string): string {
  if (isProduction && (value.trim() === '' || /dummy/i.test(value))) throw new ApiError(503, 'webhook_not_configured');
  return value;
}

function rawBody(req: FastifyRequest): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

function headerOf(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Hashing first gives equal lengths, so neither the content nor the length can be learnt from the timing. */
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

function parseJson<T>(raw: Buffer): T {
  try {
    return JSON.parse(raw.toString('utf8')) as T;
  } catch {
    throw new ApiError(422, 'bad_input');
  }
}

async function firstTime(db: PoolClient, provider: string, eventId: string, type: string | undefined): Promise<boolean> {
  const { rows } = await db.query(`select record_webhook_event($1, $2, $3) as first`, [provider, eventId, type ?? null]);
  return rows[0].first as boolean;
}

async function applyPlan(
  db: PoolClient,
  store: 'apple' | 'google' | 'razorpay' | 'stripe',
  externalId: string,
  payer: string | null,
  product: PlusProduct,
  change: PlanChange,
  eventAt: Date,
): Promise<string> {
  const { rows } = await db.query(
    `select apply_plan_event($1::store_t, $2, $3::uuid, $4, $5::plan_status_t, $6::timestamptz, $7::timestamptz, $8, $9::timestamptz) as result`,
    [store, externalId, payer, product, change.status, change.trialEndsAt, change.renewsAt, change.willRenew, eventAt],
  );
  return rows[0].result as string;
}

async function applyOrder(
  db: PoolClient,
  req: FastifyRequest,
  store: 'razorpay' | 'stripe',
  orderId: string | null,
  externalId: string | null,
  status: 'paid' | 'failed' | 'expired' | 'refunded',
  extra: { amount?: number | null; currency?: string | null; paymentId?: string | null; details?: unknown } = {},
): Promise<void> {
  const { rows } = await db.query(
    `select apply_order_event($1::store_t, $2::uuid, $3, $4, $5::bigint, $6, $7, $8::jsonb) as result`,
    [
      store,
      isUuid(orderId) ? orderId : null,
      externalId,
      status,
      extra.amount ?? null,
      extra.currency ?? null,
      extra.paymentId ?? null,
      extra.details ? JSON.stringify(extra.details) : null,
    ],
  );
  // Someone paid a different amount from the one we asked for: keep the order unpaid and leave a trace for staff.
  if (rows[0].result === 'amount_mismatch') req.log.error({ store, orderId }, 'order amount mismatch');
}

// ----- Razorpay -----
interface RazorpayOrderEntity {
  id?: string;
  amount?: number;
  currency?: string;
  receipt?: string;
}
interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string | null;
  refund_status?: string | null;
  notes?: Record<string, string> | unknown[] | null;
}
interface RazorpayWebhook {
  event?: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: RazorpaySubscription };
    order?: { entity?: RazorpayOrderEntity };
    payment?: { entity?: RazorpayPaymentEntity };
    payment_link?: { entity?: { id?: string; reference_id?: string; amount?: number; currency?: string } };
  };
}

function noteOf(notes: Record<string, string> | unknown[] | null | undefined, key: string): string | null {
  // Razorpay sends empty notes as an empty array.
  if (!notes || Array.isArray(notes)) return null;
  return notes[key] ?? null;
}

async function handleRazorpay(db: PoolClient, event: RazorpayWebhook, req: FastifyRequest): Promise<void> {
  const type = event.event ?? '';
  const createdAt = event.created_at ?? Math.floor(Date.now() / 1000);
  const payment = event.payload?.payment?.entity;

  if (type.startsWith('subscription.')) {
    const sub = event.payload?.subscription?.entity;
    if (!sub?.id) return;
    const change = razorpayPlanChange(type, sub, createdAt);
    if (!change) return;
    // Which product comes from the plan id on our own account.
    const product: PlusProduct | null =
      sub.plan_id === config.RAZORPAY_PLAN_YEARLY ? 'aywo_plus_yearly' : sub.plan_id === config.RAZORPAY_PLAN_MONTHLY ? 'aywo_plus_monthly' : null;
    if (!product) {
      req.log.warn({ type }, 'razorpay subscription on a plan this server does not sell');
      return;
    }
    const payer = noteOf(sub.notes, 'profile_id');
    await applyPlan(db, 'razorpay', sub.id, isUuid(payer) ? payer : null, product, change, new Date(createdAt * 1000));
    return;
  }

  if (type === 'order.paid') {
    const order = event.payload?.order?.entity;
    await applyOrder(db, req, 'razorpay', order?.receipt ?? null, order?.id ?? null, 'paid', {
      amount: order?.amount,
      currency: order?.currency,
      paymentId: payment?.id,
    });
    return;
  }
  if (type === 'payment_link.paid') {
    const link = event.payload?.payment_link?.entity;
    await applyOrder(db, req, 'razorpay', link?.reference_id ?? null, link?.id ?? null, 'paid', {
      amount: link?.amount,
      currency: link?.currency,
      paymentId: payment?.id,
    });
    return;
  }
  if (type === 'payment.failed') {
    await applyOrder(db, req, 'razorpay', noteOf(payment?.notes, 'order_id'), payment?.order_id ?? null, 'failed');
    return;
  }
  if ((type === 'refund.processed' || type === 'payment.refunded') && payment?.refund_status === 'full') {
    await applyOrder(db, req, 'razorpay', noteOf(payment.notes, 'order_id'), payment.order_id ?? null, 'refunded');
  }
}

// ----- Stripe -----
async function handleStripe(db: PoolClient, event: Stripe.Event, req: FastifyRequest): Promise<void> {
  const eventAt = new Date(event.created * 1000);
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const sub = event.data.object;
      const item = sub.items.data[0];
      const change = stripePlanChange({
        status: sub.status,
        cancel_at_period_end: sub.cancel_at_period_end,
        trial_end: sub.trial_end,
        current_period_end: item?.current_period_end,
      });
      if (!change) return;
      const priceId = item?.price.id;
      const product: PlusProduct | null =
        priceId === config.STRIPE_PRICE_YEARLY ? 'aywo_plus_yearly' : priceId === config.STRIPE_PRICE_MONTHLY ? 'aywo_plus_monthly' : null;
      if (!product) {
        req.log.warn({ type: event.type }, 'stripe subscription on a price this server does not sell');
        return;
      }
      const payer = sub.metadata?.profile_id;
      await applyPlan(db, 'stripe', sub.id, isUuid(payer) ? payer : null, product, change, eventAt);
      return;
    }
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'payment' || session.payment_status !== 'paid') return;
      const shippingDetails = session.collected_information?.shipping_details;
      await applyOrder(db, req, 'stripe', session.metadata?.order_id ?? null, session.id, 'paid', {
        amount: session.amount_total,
        currency: session.currency,
        paymentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
        details: shippingDetails ? { shipping: shippingDetails } : null,
      });
      return;
    }
    case 'checkout.session.expired': {
      const session = event.data.object;
      if (session.mode === 'payment') await applyOrder(db, req, 'stripe', session.metadata?.order_id ?? null, session.id, 'expired');
      return;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      if (charge.refunded) await applyOrder(db, req, 'stripe', charge.metadata?.order_id ?? null, null, 'refunded');
      return;
    }
    default:
  }
}

// ----- RevenueCat -----
interface RevenueCatWebhookEvent extends RevenueCatEvent {
  id: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  store?: string;
  environment?: string;
  event_timestamp_ms?: number;
  entitlement_ids?: string[] | null;
  transaction_id?: string;
  price_in_purchased_currency?: number | null;
  currency?: string | null;
  transferred_from?: string[];
  transferred_to?: string[];
}

async function handleRevenueCat(db: PoolClient, event: RevenueCatWebhookEvent, req: FastifyRequest): Promise<void> {
  if (event.type === 'TEST') return;
  const eventAt = new Date(event.event_timestamp_ms ?? Date.now());

  if (event.type === 'TRANSFER') {
    // A test purchase costs nothing, so it must not be able to move a real plan either.
    if (isProduction && event.environment === 'SANDBOX') return;
    const from = event.transferred_from?.find(isUuid);
    const to = event.transferred_to?.find(isUuid);
    if (from && to) await db.query(`select apply_plan_transfer($1::uuid, $2::uuid, $3::timestamptz)`, [from, to, eventAt]);
    return;
  }

  const payer = [event.app_user_id, event.original_app_user_id].find(isUuid);
  const store = revenueCatStore(event.store);
  if (!payer || !store) return;

  // Test purchases cost nothing, so in production they count only for the fixed App Review login.
  if (isProduction && event.environment === 'SANDBOX') {
    const { rows } = await db.query(`select login_phone from profiles where id = $1`, [payer]);
    if (!isReviewerLogin(rows[0]?.login_phone as string | null | undefined)) {
      req.log.info({ type: event.type }, 'ignored a sandbox purchase in production');
      return;
    }
  }

  if (event.type === 'NON_RENEWING_PURCHASE') {
    if (event.product_id?.split(':')[0] !== STORE_INVITE_PRODUCT) return;
    await db.query(`select record_store_order($1::uuid, $2::store_t, 'premium_invite', $3, $4::bigint, $5)`, [
      payer,
      store,
      event.transaction_id ?? event.id,
      Math.round((event.price_in_purchased_currency ?? 0) * 100),
      event.currency ?? 'USD',
    ]);
    return;
  }

  const product = plusProductFromStore(event.product_id);
  if (!product) return;
  if (event.entitlement_ids && !event.entitlement_ids.includes('plus')) return;
  const change = revenueCatPlanChange(event);
  if (!change) return;
  // LLD L3: for store purchases the external id is the RevenueCat app user id.
  await applyPlan(db, store, payer, payer, product, change, eventAt);
}

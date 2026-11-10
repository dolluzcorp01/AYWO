# AYWO payments setup

The code is complete and runs on dummy keys. Webhooks alone change `family_plans`. No card data ever touches our server.

| Where | AYWO Plus | Physical goods (poster, book) | Premium invite design |
|---|---|---|---|
| Android app | Google Play billing via RevenueCat | Razorpay or Stripe payment link | Google Play |
| iOS app | Apple billing via RevenueCat (Apple Pay is built in) | Razorpay or Stripe payment link | Apple |
| Web, India (+91) | Razorpay: UPI, debit, credit | Razorpay | Razorpay |
| Web, overseas | Stripe: cards, Apple Pay on Safari | Stripe | Stripe |

Store rules require Apple and Google billing for digital goods inside the apps.

Prices: Rs 29 or USD 0.99 a month; Rs 399 or USD 9.99 a year with a 2-month free trial everywhere; family plan of 6.

One-time prices in `ORDER_PRICES` (`apps/api/src/routes/payments.ts`) and shipping countries in `STRIPE_SHIP_COUNTRIES` are placeholders until the founder confirms them. Paid orders are recorded and the buyer is told, but printing and shipping are not built.

## Razorpay

1. Enable Subscriptions, UPI Autopay and automatic payment capture.
2. Create two plans: Rs 29 monthly, and Rs 399 yearly with no add-on (the server sets the 60-day trial through `start_at`). Put the ids in `RAZORPAY_PLAN_MONTHLY` and `RAZORPAY_PLAN_YEARLY`.
3. Webhook at `{PUBLIC_URL}/webhooks/razorpay`, secret in `RAZORPAY_WEBHOOK_SECRET`. Events: `subscription.authenticated`, `activated`, `charged`, `pending`, `halted`, `paused`, `resumed`, `cancelled`, `completed`, `order.paid`, `payment_link.paid`, `payment.failed`, `refund.processed`.
4. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `EXPO_PUBLIC_RAZORPAY_KEY_ID`.

## Stripe

1. Create a USD 0.99 monthly price and a USD 9.99 yearly price with no trial on the price (the server sets it). Put the ids in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY`.
2. Webhook at `{PUBLIC_URL}/webhooks/stripe`, secret in `STRIPE_WEBHOOK_SECRET`. Events: `customer.subscription.created`, `updated`, `deleted`, `paused`, `resumed`, `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`.
3. Enable Apple Pay, and turn on the Customer Portal with cancellation allowed.
4. Set `STRIPE_SECRET_KEY`.

## RevenueCat

1. Add the App Store and Play apps. Create entitlement `plus`, attach `aywo_plus_monthly` and `aywo_plus_yearly`, and make a current offering with Monthly and Annual packages. Add `aywo_premium_invite` as a non-subscription product.
2. Webhook at `{PUBLIC_URL}/webhooks/revenuecat`, with the Authorization header value equal to `REVENUECAT_WEBHOOK_AUTH`.
3. Set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`. RevenueCat needs a development build, not Expo Go.

## App Store Connect

Create a subscription group with the two product ids and country price tiers, a 2-month free introductory offer on yearly, and `aywo_premium_invite` as a consumable. Give RevenueCat the App Store In-App Purchase key and send server notifications to it. Apply for the Small Business Program.

## Play Console

Create the same subscriptions with base plans and a 2-month free offer on yearly, plus the one-time product. Give RevenueCat its service account and set up Real-time Developer Notifications.

## Safety built in

In production, any webhook secret still containing "dummy" gets a 503, so nobody can forge events with the known dummy value. Replays stop at `webhook_events`, late events at `last_event_at`.

## Known gaps

- If a provider gives up on a webhook there is no reconciliation job, so `family_plans` stays stale until the next event.
- Cancelling Razorpay during the free months ends Plus immediately. The screen warns about this.
- Adding a family member by phone tells the payer whether that number is on AYWO. It is limited to active payers at 30 tries an hour.

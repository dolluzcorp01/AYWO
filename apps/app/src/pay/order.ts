// One-time purchases, for the screens that sell them. Physical goods use Razorpay or Stripe on every platform;
// premium invites use store billing inside the apps (contract: Payments). A paid order shows in one_time_orders
// once the webhook arrives, so do not treat 'started' or 'bought' as proof of payment.
//
// What startOrder answers:
//   'started'      the payment page finished (web Razorpay) or the browser left for Stripe: being confirmed
//   'bought'       an in-app store purchase went through
//   'paid'         apps: the payment page closed and the server already shows the order as paid
//   'unconfirmed'  apps: the payment page closed and the server has seen no payment. The person most likely closed
//                  the page without paying, so the screen must not say "your payment is being confirmed"
//   'cancelled'    the person closed the payment box
import * as WebBrowser from 'expo-web-browser';
import { AppState, Platform } from 'react-native';
import { api } from '@/lib/api';
import { buyStoreInvite } from './store';
import type { WebMethod } from './usePlan';
import { goToHostedPage, openRazorpay } from './webCheckout';

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
}

export interface OrderRequest {
  product: 'tree_poster' | 'family_book' | 'premium_invite';
  tree_id?: string;
  design_id?: string;
  quantity?: number;
  /** Needed for physical goods in India. Stripe collects the address on its own page overseas. */
  shipping?: ShippingAddress;
  /** A coupon code from Offers. The server checks it and sets the price. */
  coupon?: string;
}

interface OrderReply {
  provider: 'razorpay' | 'stripe';
  order_id: string;
  url?: string;
  razorpay_order_id?: string;
  key_id?: string;
}

export interface OrderWords {
  description: string;
  methodLabel: string;
}

export type OrderResult = 'started' | 'bought' | 'paid' | 'unconfirmed' | 'cancelled';

const CHECK_EVERY_MS = 2000;
const CHECK_TIMES = 6;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves when the person is back in AYWO. On iOS the browser call itself waits; on Android it returns as soon as
 * the page opens, so this waits for the app to leave the front and come back.
 */
function backInApp(): Promise<void> {
  return new Promise((resolve) => {
    let left = AppState.currentState !== 'active';
    const done = () => {
      clearTimeout(giveUp);
      watching.remove();
      resolve();
    };
    const watching = AppState.addEventListener('change', (state) => {
      if (state !== 'active') left = true;
      else if (left) done();
    });
    // The page never opened (no browser on the phone): do not wait for ever.
    const giveUp = setTimeout(() => {
      if (!left) done();
    }, 5000);
  });
}

/** my_orders lists only paid and refunded orders, so finding the order there means the payment arrived. */
async function orderIsPaid(orderId: string): Promise<boolean> {
  for (let i = 0; i < CHECK_TIMES; i++) {
    if (i > 0) await pause(CHECK_EVERY_MS);
    const orders = await api.rpc<{ id: string }[]>('my_orders').catch(() => null);
    if (orders?.some((order) => order.id === orderId)) return true;
  }
  return false;
}

/** profileId is only needed for a premium invite inside the apps. onOrder hears the order's id as soon as it exists. */
export async function startOrder(
  request: OrderRequest,
  words: OrderWords,
  options: { method?: WebMethod; profileId?: string; onOrder?: (orderId: string) => void } = {},
): Promise<OrderResult> {
  if (request.product === 'premium_invite' && Platform.OS !== 'web') {
    return buyStoreInvite(options.profileId ?? '');
  }

  const reply = await api.post<OrderReply>('/pay/order', { ...request, platform: Platform.OS });
  options.onOrder?.(reply.order_id);
  if (reply.url) {
    if (Platform.OS === 'web') {
      goToHostedPage(reply.url);
      return 'started';
    }
    const opened = await WebBrowser.openBrowserAsync(reply.url);
    if (opened.type === 'opened') await backInApp();
    // Closing the page is not paying. Ask the server before telling the person anything about a payment.
    return (await orderIsPaid(reply.order_id)) ? 'paid' : 'unconfirmed';
  }
  const result = await openRazorpay({
    keyId: reply.key_id ?? '',
    orderId: reply.razorpay_order_id,
    method: options.method,
    ...words,
  });
  return result === 'paid' ? 'started' : 'cancelled';
}

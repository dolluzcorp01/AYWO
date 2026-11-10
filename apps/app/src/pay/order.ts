// One-time purchases, for the screens that sell them. Physical goods use Razorpay or Stripe on every platform;
// premium invites use store billing inside the apps (contract: Payments). A paid order shows in one_time_orders
// once the webhook arrives, so do not treat 'started' or 'bought' as proof of payment.
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
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

/** profileId is only needed for a premium invite inside the apps. */
export async function startOrder(
  request: OrderRequest,
  words: OrderWords,
  options: { method?: WebMethod; profileId?: string } = {},
): Promise<'started' | 'bought' | 'cancelled'> {
  if (request.product === 'premium_invite' && Platform.OS !== 'web') {
    return buyStoreInvite(options.profileId ?? '');
  }

  const reply = await api.post<OrderReply>('/pay/order', { ...request, platform: Platform.OS });
  if (reply.url) {
    if (Platform.OS === 'web') goToHostedPage(reply.url);
    else await WebBrowser.openBrowserAsync(reply.url);
    return 'started';
  }
  const result = await openRazorpay({
    keyId: reply.key_id ?? '',
    orderId: reply.razorpay_order_id,
    method: options.method,
    ...words,
  });
  return result === 'paid' ? 'started' : 'cancelled';
}

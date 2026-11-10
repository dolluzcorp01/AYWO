// Web only: Razorpay's and Stripe's own pages take the payment, so card details and UPI ids never touch our code.
// The script is added when someone pays, and nothing here runs on Android or iOS.
import { ApiFailure } from '@/lib/api';
import { colors } from '@/theme/tokens';
import type { WebMethod } from './usePlan';

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayInstance {
  open: () => void;
}
interface BrowserGlobals {
  Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  ApplePaySession?: unknown;
  location: { assign: (url: string) => void };
  document: {
    createElement: (tag: 'script') => { src: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null };
    head: { appendChild: (node: unknown) => void };
  };
}

const browser = () => globalThis as unknown as BrowserGlobals;

let loading: Promise<void> | null = null;

function loadRazorpay(): Promise<void> {
  if (browser().Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = browser().document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new ApiFailure(503, 'checkout_unavailable', 'errors.checkout_unavailable'));
    };
    browser().document.head.appendChild(script);
  });
  return loading;
}

/** Opens with the chosen method first. The other methods stay one tap away, in case the chosen one fails. */
function methodOptions(method: WebMethod | undefined, label: string): Record<string, unknown> {
  if (method !== 'upi' && method !== 'debit' && method !== 'credit') return {};
  const instrument = method === 'upi' ? { method: 'upi' } : { method: 'card', types: [method] };
  return {
    prefill: { method: method === 'upi' ? 'upi' : 'card' },
    config: {
      display: {
        blocks: { chosen: { name: label, instruments: [instrument] } },
        sequence: ['block.chosen'],
        preferences: { show_default_blocks: true },
      },
    },
  };
}

interface RazorpayRequest {
  keyId: string;
  description: string;
  method?: WebMethod;
  methodLabel: string;
  /** One of these two. */
  subscriptionId?: string;
  orderId?: string;
}

/** 'paid' only means Checkout finished. The plan or order changes when the signed webhook arrives. */
export async function openRazorpay(request: RazorpayRequest): Promise<'paid' | 'dismissed'> {
  await loadRazorpay();
  const Razorpay = browser().Razorpay;
  if (!Razorpay) throw new ApiFailure(503, 'checkout_unavailable', 'errors.checkout_unavailable');
  return new Promise((resolve) => {
    new Razorpay({
      key: request.keyId,
      name: 'AYWO',
      description: request.description,
      ...(request.subscriptionId ? { subscription_id: request.subscriptionId } : {}),
      ...(request.orderId ? { order_id: request.orderId } : {}),
      ...methodOptions(request.method, request.methodLabel),
      theme: { color: colors.logoPurple },
      handler: () => resolve('paid'),
      modal: { ondismiss: () => resolve('dismissed') },
    }).open();
  });
}

export function goToHostedPage(url: string): void {
  browser().location.assign(url);
}

/** Stripe's page shows Apple Pay by itself on Safari; this only decides whether to offer the choice here. */
export function applePayPossible(): boolean {
  return !!browser().ApplePaySession;
}

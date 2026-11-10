// Shapes of the operations-release answers the people's app reads.

export interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: 'open' | 'waiting' | 'closed';
  updated_at: string;
  last: { from_staff: boolean; body: string; at: string } | null;
  messages?: { id: number; from_staff: boolean; body: string; created_at: string; author: string }[];
}

export const TICKET_CATEGORIES = ['account', 'tree', 'payment', 'order', 'privacy', 'safety', 'bug', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export type Product = 'tree_poster' | 'family_book' | 'premium_invite';

export interface Offer {
  code: string;
  title: string;
  description: string | null;
  kind: 'percent' | 'amount';
  value: number;
  currency: string | null;
  products: Product[];
  ends_at: string | null;
}

export interface MyOrder {
  id: string;
  product: Product;
  amount_minor: number;
  currency: string;
  discount_minor: number;
  status: 'paid' | 'refunded';
  fulfilment: 'none' | 'queued' | 'printing' | 'shipped' | 'delivered' | 'cancelled';
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  created_at: string;
  paid_at: string | null;
  quantity: number;
}

export interface Products {
  provider: 'razorpay' | 'stripe';
  currency: 'INR' | 'USD';
  needs_address: boolean;
  products: { product: Product; amount_minor: number; physical: boolean }[];
}

export interface CouponQuote {
  coupon_id: string;
  code: string;
  title: string;
  discount_minor: number;
  final_minor: number;
}

export interface Referral {
  code: string;
  joined: number;
  rewarded: number;
  bonus_until: string | null;
  reward_days: number;
}

export interface EmergencyCard {
  blood_group: string | null;
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
  note: string | null;
  updated_at?: string;
}

export interface MyExtras {
  marketing_opt_in: boolean;
  email_verified: boolean;
  plus_bonus_until: string | null;
  has_emergency_card: boolean;
  blocked: number;
  open_tickets: number;
}

export interface FamilyDate {
  kind: 'birthday' | 'anniversary';
  person_id: string;
  tree_id: string;
  name: string;
  date: string;
  days: number;
  turns: number | null;
  photo_path: string | null;
}

export interface OnThisDay {
  id: string;
  body: string | null;
  happened_on: string;
  years: number;
  author_name: string;
}

export function formatMoney(minor: number, currency: string, language: string): string {
  return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: currency === 'INR' ? 0 : 2 }).format(minor / 100);
}

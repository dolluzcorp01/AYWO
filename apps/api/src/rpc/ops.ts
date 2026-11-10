import type { RpcList } from './types.ts';

// Operations release, the people's side. Each function checks the caller itself.
// Not listed on purpose: app_config_public and announcements_public have cached, rate-limited routes (routes/ops.ts).
export const opsRpc: RpcList = {
  report_content: { args: ['p_type', 'p_id', 'p_reason', 'p_note'] },
  block_user: { args: ['p_profile'] },
  unblock_user: { args: ['p_profile'] },
  blocked_list: { args: [] },
  social_hidden_people: { args: [] },

  ticket_create: { args: ['p_subject', 'p_category', 'p_body'] },
  ticket_list: { args: [] },
  ticket_detail: { args: ['p_ticket'] },
  ticket_reply: { args: ['p_ticket', 'p_body'] },
  ticket_close: { args: ['p_ticket'] },

  referral_my: { args: [] },
  referral_claim: { args: ['p_code'] },
  my_extras: { args: [] },
  marketing_set: { args: ['p_on'] },

  emergency_card_get: { args: [] },
  emergency_card_save: { args: ['p_card'] },
  emergency_card_delete: { args: [] },
  sos_emergency_card: { args: ['p_event'] },

  upcoming_dates: { args: ['p_days'] },
  on_this_day: { args: [] },

  coupon_quote: { args: ['p_code', 'p_product', 'p_amount_minor', 'p_currency'] },
  offers_list: { args: [] },
  my_orders: { args: [] },

  announcements_for_me: { args: ['p_placement'] },
  announcement_event: { args: ['p_id', 'p_event'] },

  chat_remove_member: { args: ['p_chat', 'p_profile'] },
};

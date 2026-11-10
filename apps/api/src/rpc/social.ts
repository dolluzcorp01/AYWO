import type { RpcList } from './types.ts';

// Not listed on purpose: send_message, chat_messages, post_feed and post_detail go through routes that sign file links;
// sos_start and sos_stop go through routes that send SMS; sos_page and sos_location have their own open routes.
export const socialRpc: RpcList = {
  social_people: { args: ['p_tree', 'p_group', 'p_q'] },
  social_circles: { args: [] },
  social_home_counts: { args: [] },

  group_create: { args: ['p_name', 'p_members'] },
  group_list: { args: [] },
  group_detail: { args: ['p_group'] },
  group_add_members: { args: ['p_group', 'p_members'] },
  group_remove_member: { args: ['p_group', 'p_profile'] },
  group_join_preview: { args: ['p_token'] },
  group_join: { args: ['p_token'] },
  group_new_link: { args: ['p_group'] },

  chat_open_direct: { args: ['p_other'] },
  chat_create_group: { args: ['p_name', 'p_audience'] },
  chat_add_members: { args: ['p_chat', 'p_members'] },
  chat_leave: { args: ['p_chat'] },
  chat_list: { args: [] },
  chat_members_list: { args: ['p_chat'] },
  chat_mark_read: { args: ['p_chat'] },
  message_delete: { args: ['p_message'] },

  post_create: { args: ['p_tree', 'p_group', 'p_body', 'p_happened_on', 'p_media', 'p_tag_people', 'p_tag_profiles', 'p_collaborators'] },
  post_add_media: { args: ['p_post', 'p_media'] },
  post_add_tags: { args: ['p_post', 'p_tag_people', 'p_tag_profiles'] },
  post_add_collaborators: { args: ['p_post', 'p_collaborators'] },
  post_set_closed: { args: ['p_post', 'p_closed'] },
  post_delete: { args: ['p_post'] },
  post_comment: { args: ['p_post', 'p_body'] },
  comment_delete: { args: ['p_comment'] },
  react: { args: ['p_target_type', 'p_target_id', 'p_emoji'] },

  event_create: { args: ['p_kind', 'p_title', 'p_starts_at', 'p_audience', 'p_place', 'p_note', 'p_canva_url', 'p_design'] },
  event_update: { args: ['p_event', 'p_title', 'p_starts_at', 'p_place', 'p_note', 'p_canva_url'] },
  event_cancel: { args: ['p_event'] },
  event_add_invitees: { args: ['p_event', 'p_audience'] },
  event_list: { args: [] },
  event_detail: { args: ['p_event'] },
  rsvp_set: { args: ['p_event', 'p_answer', 'p_guests'] },
  event_set_design: { args: ['p_event', 'p_design'] },
  pop_party_create: { args: ['p_title', 'p_audience', 'p_dates', 'p_venues', 'p_menus', 'p_note'] },
  poll_vote: { args: ['p_poll', 'p_option'] },
  pop_party_decide: { args: ['p_event', 'p_starts_at', 'p_place', 'p_menu'] },

  send_alert: { args: ['p_kind', 'p_body', 'p_audience', 'p_blood_group'] },
  alerts_list: { args: [] },
  alert_mark_seen: { args: ['p_alert'] },

  sos_contacts_list: { args: [] },
  sos_contact_add: { args: ['p_contact_profile', 'p_phone', 'p_name'] },
  sos_contact_remove: { args: ['p_id'] },
  sos_contacts_reorder: { args: ['p_ids'] },
  sos_active: { args: [] },
  sos_incoming: { args: [] },
  sos_view: { args: ['p_event'] },
};

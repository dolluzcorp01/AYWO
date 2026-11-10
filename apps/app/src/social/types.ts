// Shapes of what the social API sends back.

export interface PersonRow {
  profile_id: string;
  name: string;
}

export type Audience =
  | { type: 'tree'; tree_id: string }
  | { type: 'branch'; tree_id: string; person_id: string }
  | { type: 'people'; profile_ids: string[] }
  | { type: 'group'; group_id: string };

export interface Circles {
  trees: { id: string; name: string; whole_tree: boolean }[];
  groups: { id: string; name: string }[];
}

export interface HomeCounts {
  unread_chats: number;
  unseen_alerts: number;
  open_invites: number;
  incoming_sos: { id: string; name: string; started_at: string; ends_at: string }[];
}

// ===== Chat =====
export interface ChatRow {
  id: string;
  kind: 'group' | 'direct';
  name: string | null;
  other_id: string | null;
  last_message_at: string | null;
  last: { body: string | null; media_kind: 'photo' | 'voice' | null; deleted: boolean } | null;
  unread: number;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string | null;
  sender_name: string;
  created_at: string;
  deleted: boolean;
  body?: string | null;
  media_url?: string | null;
  media_kind?: 'photo' | 'voice' | null;
  media_ms?: number | null;
  client_id?: string | null;
  reply?: { id: string; sender_name: string; body: string | null; media_kind: 'photo' | 'voice' | null } | null;
}

export interface ChatPage {
  chat: { id: string; kind: 'group' | 'direct'; name: string | null; members: number };
  messages: Message[];
}

// ===== Memories =====
export interface ReactionCount {
  emoji: string;
  count: number;
}

export interface Comment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  mine: boolean;
  reactions: ReactionCount[];
  my_reaction: string | null;
}

export interface Post {
  id: string;
  author_id: string;
  author_name: string;
  tree_id: string | null;
  group_id: string | null;
  scope_name: string | null;
  body: string | null;
  happened_on: string;
  closed: boolean;
  created_at: string;
  is_mine: boolean;
  can_edit: boolean;
  media: { id: string; url: string | null }[];
  tags: { person_id: string | null; profile_id: string | null; name: string }[];
  collaborators: PersonRow[];
  reactions: ReactionCount[];
  my_reaction: string | null;
  comment_count: number;
  comments: Comment[] | null;
}

// ===== Groups =====
export interface GroupRow {
  id: string;
  name: string;
  members: number;
}

export interface GroupDetail {
  id: string;
  name: string;
  is_mine: boolean;
  invite_token: string;
  members: (PersonRow & { started_it: boolean })[];
}

// ===== Invites =====
export const EVENT_KINDS = ['housewarming', 'engagement', 'wedding', 'birthday', 'sixtieth', 'eightieth', 'get_together', 'death_anniversary'] as const;
export type EventKind = (typeof EVENT_KINDS)[number] | 'pop_party';
export type RsvpAnswer = 'yes' | 'no' | 'maybe';
export type Design = 'classic' | 'marigold' | 'gold' | 'midnight';
export const FREE_DESIGNS: Design[] = ['classic', 'marigold'];
export const PREMIUM_DESIGNS: Design[] = ['gold', 'midnight'];

export interface EventRow {
  id: string;
  host_id: string;
  host_name: string;
  kind: EventKind;
  title: string;
  starts_at: string | null;
  place: string | null;
  menu: string | null;
  note: string | null;
  canva_url: string | null;
  design: Design;
  cancelled: boolean;
  decided: boolean;
  is_mine: boolean;
  my_answer: RsvpAnswer | null;
  yes: number;
  invited: number;
}

export interface PollRow {
  id: string;
  topic: 'date' | 'venue' | 'menu';
  closed: boolean;
  my_option: string | null;
  options: { id: string; label: string; votes: number }[];
}

export interface EventDetail extends EventRow {
  owned_designs: Design[];
  spare_designs: number;
  people: (PersonRow & { answer: RsvpAnswer | null; guests: number })[];
  polls: PollRow[];
}

// ===== Alerts =====
export const ALERT_KINDS = ['death', 'hospital', 'blood', 'help', 'news'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

export interface AlertRow {
  id: string;
  kind: AlertKind;
  body: string;
  blood_group: string | null;
  created_at: string;
  sender_id: string;
  sender_name: string;
  is_mine: boolean;
  recipients: number | null;
  seen: boolean;
}

// ===== SOS =====
export interface SosContact {
  id: string;
  position: number;
  contact_profile_id: string | null;
  phone: string | null;
  name: string;
}

export interface SosActive {
  id: string;
  started_at: string;
  ends_at: string;
  last_at: string | null;
}

export interface SosStart {
  id: string;
  write_token: string;
  ends_at: string;
  call_phone: string | null;
  /** Phones where the AYWO alarm went off. */
  app_alarms: number;
  sms_sent: number;
  sms_failed: number;
}

export interface SosView {
  id: string;
  name: string;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  active: boolean;
  last: { lat: number; lng: number; at: string } | null;
  trail: { lat: number; lng: number; at: string }[];
}

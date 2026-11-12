export const GRANTABLE = [
  'support', 'users', 'moderation', 'takedowns', 'dictionary', 'trees', 'orders', 'payments', 'marketing', 'analytics', 'settings',
] as const;
export type Grantable = (typeof GRANTABLE)[number];
export type Permission = Grantable | 'staff' | 'audit';
export type StaffRole = 'aywo_admin' | 'sub_admin';

export interface Page<T> {
  total: number;
  rows: T[];
}

export interface AdminMe {
  role: StaffRole;
  team_role: string | null;
  permissions: Permission[];
  open_work: number;
}

export interface Dashboard {
  work?: { open: number; mine: number; unassigned: number; overdue: number };
  support?: { open: number; waiting: number };
  moderation?: { open: number; urgent: number };
  orders?: { queued: number; printing: number; shipped: number };
  marketing?: { coupons_running: number; banners_running: number; opted_in: number };
  health?: { errors_24h: number; maintenance: boolean };
  users?: { total: number; active_30d: number; new_7d: number; blocked: number };
  trees?: { total: number; people: number };
  dictionary?: { pending_terms: number; open_reports: number };
  takedowns?: { open: number };
  payments?: { active: number; trial: number; grace: number };
  staff?: { admins: number; sub_admins: number; without_two_step: number };
}

export interface UserRow {
  id: string;
  display_name: string;
  phone_masked: string | null;
  email_masked: string | null;
  created_at: string;
  last_active_at: string | null;
  deleted: boolean;
  blocked_at: string | null;
  trees_created: number;
  plus: boolean;
  staff_role: StaffRole | null;
}

export interface TreeRow {
  id: string;
  name: string;
  creator_id: string;
  creator_name: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
  people: number;
  shares: number;
}

export interface TreePersonRow {
  id: string;
  display_name: string;
  name_unknown: boolean;
  living: 'living' | 'deceased' | 'unknown';
  has_account: boolean;
}

export interface KinTermRow {
  id: string;
  term: string;
  term_native: string | null;
  path_code: string;
  path_description: string;
  language_code: string;
  language_name: string;
  speaker_gender: 'male' | 'female' | null;
  status: string;
  submitted_by_name: string | null;
  created_at: string;
}

export interface TermReportRow {
  id: string;
  kin_term_id: string;
  term: string;
  term_native: string | null;
  path_description: string;
  language_name: string;
  suggestion: string | null;
  status: string;
  reporter_name: string | null;
  created_at: string;
}

export interface TakedownRow {
  id: string;
  requester_contact: string;
  reason: string;
  status: 'open' | 'removed' | 'dismissed';
  subject_name: string | null;
  person_id: string | null;
  person_name: string | null;
  tree_id: string | null;
  tree_name: string | null;
  decision_note: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  created_at: string;
}

export interface PlanRow {
  id: string;
  payer_id: string;
  payer_name: string;
  payer_phone_masked: string | null;
  store: string;
  product_id: string;
  status: string;
  trial_ends_at: string | null;
  renews_at: string | null;
  external_id: string;
  members: number;
}

export interface PaymentsOverview extends Page<PlanRow> {
  summary: {
    plans: number;
    members: number;
    by_status: Record<string, number>;
    by_store: Record<string, number>;
    by_product: Record<string, number>;
  };
  orders: { total: number; by_status: Record<string, number>; paid_minor_by_currency: Record<string, number> } | null;
}

export interface StaffRow {
  profile_id: string;
  display_name: string;
  phone_masked: string | null;
  role: StaffRole;
  team_role_id: string | null;
  team_role: string | null;
  permissions: Grantable[];
  two_step: boolean;
  open_work: number;
  last_active_at: string | null;
  created_at: string;
  blocked_at: string | null;
  is_me: boolean;
}

export interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface StaffInvite {
  phone_masked: string;
  phone_key: string;
  role: StaffRole;
  team_role: string | null;
  expires_at: string;
  expired: boolean;
}

export interface StaffPage extends Page<StaffRow> {
  invites: StaffInvite[];
}

export interface TeamRole {
  id: string;
  name: string;
  description: string | null;
  permissions: Grantable[];
  members: number;
  updated_at: string;
}

export type WorkKind = 'takedown' | 'report' | 'ticket' | 'order' | 'term_report';
export type WorkStatus = 'open' | 'in_progress' | 'waiting' | 'done';
export type WorkPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface WorkItem {
  id: string;
  kind: WorkKind;
  ref_id: string;
  title: string;
  status: WorkStatus;
  priority: WorkPriority;
  assignee_id: string | null;
  assignee_name: string | null;
  due_at: string;
  overdue: boolean;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  notes: number;
}

export interface WorkPage extends Page<WorkItem> {
  counts: { open: number; mine: number; unassigned: number; overdue: number };
}

export interface WorkDetail extends WorkItem {
  history: { id: number; author_name: string | null; body: string; created_at: string }[];
  assignable: { profile_id: string; name: string }[];
}

export interface ReportRow {
  id: string;
  target_type: 'post' | 'post_comment' | 'message' | 'person_comment' | 'profile';
  target_id: string;
  reason: string;
  note: string | null;
  status: 'open' | 'removed' | 'dismissed';
  created_at: string;
  reporter_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_reports: number;
  owner_blocked: boolean | null;
  same_target: number;
  target: { text: string | null; gone: boolean; photos?: number; media?: string | null } | null;
  decision_note: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  work_id: string | null;
}

export interface TicketMessage {
  id: number;
  from_staff: boolean;
  body: string;
  created_at: string;
  author: string;
}

export interface TicketRow {
  id: string;
  subject: string;
  category: string;
  status: 'open' | 'waiting' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  last: { from_staff: boolean; body: string; at: string } | null;
  profile_id: string;
  name: string | null;
  work_id: string | null;
  assignee_name?: string | null;
}

export interface TicketDetail extends TicketRow {
  messages: TicketMessage[];
  plus: boolean;
  language: string;
}

export type Fulfilment = 'none' | 'queued' | 'printing' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderRow {
  id: string;
  product: 'tree_poster' | 'family_book' | 'premium_invite';
  store: string;
  amount_minor: number;
  currency: string;
  discount_minor: number;
  coupon: string | null;
  status: string;
  fulfilment: Fulfilment;
  carrier: string | null;
  tracking_number: string | null;
  quantity: number;
  city: string | null;
  country: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  created_at: string;
  paid_at: string | null;
  can_refund: boolean;
  work_id: string | null;
}

export interface OrderPage extends Page<OrderRow> {
  counts: Record<string, number>;
}

export interface OrderAddress {
  shipping: { name: string; line1: string; line2?: string; city: string; state: string; postal_code: string; country: string; phone: string } | null;
  quantity: number;
  design_id: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description: string | null;
  kind: 'percent' | 'amount';
  value: number;
  currency: 'INR' | 'USD' | null;
  products: string[];
  starts_at: string;
  ends_at: string | null;
  max_uses: number | null;
  per_user_limit: number;
  new_users_only: boolean;
  min_amount_minor: number;
  public: boolean;
  active: boolean;
  uses: number;
  discount_given_minor: number;
  running: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  link_label: string | null;
  style: 'info' | 'offer' | 'celebration' | 'warning';
  placements: ('app_banner' | 'web_banner' | 'home_card')[];
  audience: 'everyone' | 'plus' | 'free' | 'visitors';
  languages: string[] | null;
  region: 'all' | 'india' | 'overseas';
  starts_at: string;
  ends_at: string | null;
  priority: number;
  dismissible: boolean;
  active: boolean;
  seen: number;
  clicked: number;
  dismissed: number;
  visitor_views: number;
  running: boolean;
}

export interface Campaign {
  id: string;
  title: string;
  body: string;
  link_path: string | null;
  audience: string;
  language: string | null;
  region: string;
  recipients: number;
  sent_at: string;
  sent_by_name: string | null;
  opened: number;
}

export interface Analytics {
  days: number;
  daily: { day: string; signups: number; trees: number; people: number; memories: number; messages: number; plus_started: number; orders: number; sos: number }[];
  totals: {
    users: number; active_1d: number; active_7d: number; active_30d: number; plus: number; plus_rate: number; trees: number; people: number;
    marketing_opt_in: number; referrals: number; revenue_minor: Record<string, number>;
  };
  funnel: { signed_up: number; built_tree: number; added_5: number; shared: number; plus: number };
  plans: Record<string, number>;
  languages: Record<string, number>;
  devices: Record<string, number>;
}

export interface AppHealth {
  errors: { fingerprint: string; message: string; count: number; people: number; last_seen: string; first_seen: string; platforms: string[]; versions: (string | null)[]; routes: (string | null)[]; stack: string | null }[];
  total: number;
  job_status: { name: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null; failures_in_row: number }[];
  backups: { id: number; started_at: string; finished_at: string | null; ok: boolean | null; object_key: string | null; bytes: number | null; error: string | null }[];
  last_good_backup: string | null;
  server_errors: { route: string; message: string; count: number; last_seen: string }[];
  server_error_total: number;
}

export type ConfigKey = 'min_version' | 'latest_version' | 'maintenance' | 'features' | 'whats_new' | 'support';
export type AdminConfig = Record<ConfigKey, { value: Record<string, unknown>; updated_at: string; updated_by_name: string | null }>;

export interface UserDetail {
  id: string;
  display_name: string;
  phone_masked: string | null;
  email_masked: string | null;
  email_verified: boolean;
  language: string;
  is_minor: boolean;
  created_at: string;
  last_active_at: string | null;
  deleted: boolean;
  blocked_at: string | null;
  staff_role: StaffRole | null;
  plus: boolean;
  plus_bonus_until: string | null;
  marketing_opt_in: boolean;
  plans: { store: string; product_id: string; status: string; renews_at: string | null; trial_ends_at: string | null; payer: boolean }[];
  trees: { id: string; name: string; creator: boolean; people: number }[];
  counts: Record<string, number>;
  devices: { platform: string; last_seen_at: string }[];
  orders: { id: string; product: string; status: string; fulfilment: string; amount_minor: number; currency: string; created_at: string }[];
  tickets: { id: string; subject: string; status: string; updated_at: string }[];
  history: { action: string; actor_name: string | null; reason: string | null; at: string }[];
}
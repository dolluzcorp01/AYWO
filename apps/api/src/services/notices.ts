// A person's notifications as the app shows them: words in their language, and the screen a tap opens.
//
// The same rows are sent as push, email or SMS by jobs/delivery.ts. Until phone push is set up, and for anyone who
// turned it off, the list inside the app is the only place this news is seen: an answer to an invitation, a new
// invitation, a comment on a memory. So the app reads the same rows, with the same words.
import { isUuid } from '@aywo/shared';
import { config } from '../config.ts';
import { asServer } from '../db.ts';
import { notificationText } from './email.ts';
import type { NotificationFacts } from './email.ts';

/** Chat messages have their own unread numbers and their own pop-up; listing them here too would bury the rest. */
export const NOT_LISTED = ['chat_message'];
/**
 * A request to answer already counts on the bell through "Needs you". Counting its notification as well showed 2 for
 * one request. It stays in the list; it is only left out of the unread number.
 */
const COUNTED_ELSEWHERE = ['request_created', 'request_routed', 'merge_candidate'];

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Where a tap or an email button goes. Fixed routes and ids only. */
export function pathFor(kind: string, payload: Record<string, unknown> | null): string {
  if (kind.startsWith('staff_')) return '/admin/work';
  if (kind === 'ticket_reply' && isUuid(payload?.ticket_id)) return `/help/${payload?.ticket_id}`;
  if (kind.startsWith('order_')) return '/orders';
  if (kind === 'plus_gift' || kind === 'referral_reward') return '/family-plan';
  // A promotional message may open one screen of the app, never an outside address.
  if (kind === 'promo') return typeof payload?.path === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(payload.path) ? payload.path : '/offers';
  if (kind === 'trial_ending' || kind.startsWith('plan_')) return '/family-plan';
  if (kind.startsWith('chat_') && isUuid(payload?.chat_id)) return `/social/chat/${payload?.chat_id}`;
  if (kind.startsWith('memory_') && isUuid(payload?.post_id)) return `/social/memories/${payload?.post_id}`;
  if ((kind.startsWith('invite') || kind === 'rsvp' || kind === 'poll_vote') && isUuid(payload?.event_id)) return `/social/invites/${payload?.event_id}`;
  // Birthdays and remembrance days open the family calendar on today.
  if (kind === 'birthdays_today' || kind === 'remembrance_today') return '/calendar';
  if (kind === 'alert') return '/social/alerts';
  if (kind === 'group_added') return '/social/groups';
  // An alarm opens the page that shows where the person is. It used to open Home, with nothing about the alarm.
  if ((kind === 'sos' || kind === 'sos_ended') && isUuid(payload?.event_id)) return `/social/sos/watch/${payload?.event_id}`;
  if (kind === 'request_created' || kind === 'request_routed' || kind === 'merge_candidate') return '/activity?tab=needs_you';
  const person = payload?.person_id;
  const tree = payload?.tree_id;
  if (isUuid(person) && isUuid(tree)) return `/person/${person}?treeId=${tree}`;
  if (isUuid(tree)) return `/tree/${tree}`;
  return '/home';
}

export function formatNoticeDate(value: unknown, language: string): string | null {
  const text = str(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language.startsWith('ta') ? 'ta-IN' : 'en-IN', { dateStyle: 'long', timeZone: 'Asia/Kolkata' }).format(date);
}

export interface NoticeRow {
  kind: string;
  payload: Record<string, unknown> | null;
  language_code: string;
  by_name: string | null;
  person_name: string | null;
}

/** The words and the link for one notification, in the reader's language. */
export function noticeWords(row: NoticeRow): { title: string; body: string; path: string; facts: NotificationFacts } {
  const path = pathFor(row.kind, row.payload);
  const facts: NotificationFacts = {
    by_name: row.by_name,
    person_name: row.person_name,
    date: formatNoticeDate(row.payload?.ends_at, row.language_code),
    note: str(row.payload?.body) ?? str(row.payload?.title),
    title: str(row.payload?.title),
    alert_kind: str(row.payload?.alert_kind),
    blood_group: str(row.payload?.blood_group),
    step: str(row.payload?.step),
    answer: str(row.payload?.answer),
    url: `${config.WEB_URL}${path}`,
  };
  const text = notificationText(row.kind, facts, row.language_code);
  return { title: text.title, body: text.body, path, facts };
}

export interface Notice {
  id: string;
  recipient_id: string;
  kind: string;
  title: string;
  body: string;
  path: string;
  read_at: string | null;
  created_at: string;
}

// payload values are compared as text, so a malformed id in a payload cannot break the query.
const SELECT = `select n.id, n.recipient_id, n.kind, n.payload, n.read_at, n.created_at, p.language_code,
       (select b.display_name from profiles b where b.id::text = n.payload ->> 'by') as by_name,
       (select c.display_name from persons c where c.id::text = n.payload ->> 'person_id' and c.deleted_at is null) as person_name
  from notifications n join profiles p on p.id = n.recipient_id`;

type Stored = NoticeRow & { id: string; recipient_id: string; read_at: Date | null; created_at: Date };

function shape(row: Stored): Notice {
  const words = noticeWords(row);
  return {
    id: row.id,
    recipient_id: row.recipient_id,
    kind: row.kind,
    title: words.title,
    body: words.body,
    path: words.path,
    read_at: row.read_at ? row.read_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
  };
}

/** The newest hundred for one person. Always asked for by the signed-in person's own id. */
export async function noticesFor(recipientId: string): Promise<Notice[]> {
  const rows = await asServer(async (db) => {
    const { rows } = await db.query(`${SELECT} where n.recipient_id = $1 and n.kind <> all($2::text[]) order by n.created_at desc limit 100`, [recipientId, NOT_LISTED]);
    return rows as Stored[];
  });
  return rows.map(shape);
}

export async function unreadNoticeCount(recipientId: string): Promise<number> {
  return asServer(async (db) => {
    const { rows } = await db.query(`select count(*)::int as n from notifications where recipient_id = $1 and read_at is null and kind <> all($2::text[])`, [recipientId, [...NOT_LISTED, ...COUNTED_ELSEWHERE]]);
    return rows[0].n as number;
  });
}

/** One notification, for sending to its reader's open apps the moment it is made. Null for a kind that is not listed. */
export async function noticeById(id: string): Promise<Notice | null> {
  const rows = await asServer(async (db) => {
    const { rows } = await db.query(`${SELECT} where n.id = $1 and n.kind <> all($2::text[])`, [id, NOT_LISTED]);
    return rows as Stored[];
  });
  return rows[0] ? shape(rows[0]) : null;
}

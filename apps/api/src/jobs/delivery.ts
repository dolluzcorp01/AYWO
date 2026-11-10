// LLD L11. Other areas only insert into notifications; this job sends them, as notification_prefs says, and records
// the channels used. A row with channels_sent null has not been dealt with yet.
import { isUuid } from '@aywo/shared';
import { config } from '../config.ts';
import { asServer } from '../db.ts';
import type { Job } from '../jobs.ts';
import { notificationText, sendEmail } from '../services/email.ts';
import type { NotificationFacts } from '../services/email.ts';
import { checkPushReceipts, sendPush } from '../services/push.ts';
import { sendSms } from '../services/sms.ts';

const BATCH = 200;
const MAX_ATTEMPTS = 10;
const SMS_MAX_LENGTH = 300;
const PUSH_ONLY_BY_DEFAULT = new Set(['chat_message', 'memory_comment', 'rsvp', 'promo', 'birthdays_today']);

// HLD: 'Push for normal, SMS for alerts and SOS'. Only the server inserts notifications, so the payload flag is safe.
const URGENT_KIND = /^(sos|alert|help_request|blood_)/;
export function isUrgent(kind: string, payload: Record<string, unknown> | null): boolean {
  return URGENT_KIND.test(kind) || payload?.urgent === true;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Where a tap or an email button goes. Fixed routes and ids only. */
function pathFor(kind: string, payload: Record<string, unknown> | null): string {
  if (kind.startsWith('staff_')) return '/admin/work';
  if (kind === 'ticket_reply' && isUuid(payload?.ticket_id)) return `/help/${payload?.ticket_id}`;
  if (kind.startsWith('order_')) return '/orders';
  if (kind === 'plus_gift' || kind === 'referral_reward') return '/family-plan';
  // A promotional message may open one screen of the app, never an outside address.
  if (kind === 'promo') return typeof payload?.path === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(payload.path) ? payload.path : '/offers';
  if (kind === 'trial_ending' || kind.startsWith('plan_')) return '/family-plan';
  if (kind.startsWith('chat_') && isUuid(payload?.chat_id)) return `/social/chat/${payload?.chat_id}`;
  if (kind.startsWith('memory_') && isUuid(payload?.post_id)) return `/social/memories/${payload?.post_id}`;
  if ((kind.startsWith('invite') || kind === 'rsvp') && isUuid(payload?.event_id)) return `/social/invites/${payload?.event_id}`;
  if (kind === 'alert') return '/social/alerts';
  if (kind === 'group_added') return '/social/groups';
  if (kind === 'request_created' || kind === 'request_routed' || kind === 'merge_candidate') return '/activity';
  const person = payload?.person_id;
  const tree = payload?.tree_id;
  if (isUuid(person) && isUuid(tree)) return `/person/${person}?treeId=${tree}`;
  if (isUuid(tree)) return `/tree/${tree}`;
  return '/home';
}

function formatDate(value: unknown, language: string): string | null {
  const text = str(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language.startsWith('ta') ? 'ta-IN' : 'en-IN', {
    dateStyle: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

interface Pending {
  id: string;
  recipient_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  delivery_attempts: number;
  language_code: string;
  email: string | null;
  login_phone: string | null;
  profile_deleted: boolean;
  by_name: string | null;
  person_name: string | null;
  want_push: boolean;
  want_email: boolean | null;
  want_sms: boolean | null;
}

async function record(id: string, channels: string[]): Promise<void> {
  await asServer((db) => db.query(`update notifications set channels_sent = $2 where id = $1`, [id, channels]));
}

async function deliverOne(row: Pending): Promise<void> {
  if (row.profile_deleted) {
    await record(row.id, []);
    return;
  }

  const path = pathFor(row.kind, row.payload);
  const facts: NotificationFacts = {
    by_name: row.by_name,
    person_name: row.person_name,
    date: formatDate(row.payload?.ends_at, row.language_code),
    note: str(row.payload?.body) ?? str(row.payload?.title),
    title: str(row.payload?.title),
    alert_kind: str(row.payload?.alert_kind),
    blood_group: str(row.payload?.blood_group),
    step: str(row.payload?.step),
    url: `${config.WEB_URL}${path}`,
  };
  const text = notificationText(row.kind, facts, row.language_code);

  const sent: string[] = [];
  let failed = false;
  const attempt = async (channel: string, send: () => Promise<boolean>) => {
    try {
      if (await send()) sent.push(channel);
    } catch {
      // Provider errors can quote the address or number, so they are not logged.
      failed = true;
    }
  };

  if (row.want_push) {
    await attempt('push', async () => {
      const result = await sendPush(row.recipient_id, {
        title: text.title,
        body: text.body,
        data: { notification_id: row.id, kind: row.kind, url: path },
      });
      return result === 'sent';
    });
  }
  // Frequent kinds are push only unless the person asked for email, so a busy chat never fills an inbox.
  if ((row.want_email ?? !PUSH_ONLY_BY_DEFAULT.has(row.kind)) && row.email) {
    await attempt('email', () => sendEmail(row.email as string, text, facts.url, row.language_code));
  }
  // SMS costs money: urgent kinds only, on by default there unless the person turned it off.
  if (isUrgent(row.kind, row.payload) && row.want_sms !== false && row.login_phone) {
    await attempt('sms', async () => {
      await sendSms(row.login_phone as string, `${text.title}: ${text.body}`.slice(0, SMS_MAX_LENGTH));
      return true;
    });
  }

  // Try again only if nothing got through, so nobody receives the same news twice on a channel that worked.
  if (failed && sent.length === 0 && row.delivery_attempts + 1 < MAX_ATTEMPTS) {
    await asServer((db) => db.query(`update notifications set delivery_attempts = delivery_attempts + 1 where id = $1`, [row.id]));
    return;
  }
  await record(row.id, sent);
}

async function deliverPending(): Promise<void> {
  // After an outage, week-old news is no longer worth a message. It stays in the app's own list.
  await asServer((db) =>
    db.query(`update notifications set channels_sent = '{}' where channels_sent is null and created_at < now() - interval '7 days'`),
  );

  // payload values are compared as text, so a malformed id in a payload cannot break the whole batch.
  const { rows } = await asServer((db) =>
    db.query(
      `select n.id, n.recipient_id, n.kind, n.payload, n.delivery_attempts,
              p.language_code, case when p.email_verified_at is not null then p.email end as email, p.login_phone, p.deleted_at is not null as profile_deleted,
              coalesce(np.push, true) as want_push, np.email as want_email, np.sms as want_sms,
              (select b.display_name from profiles b where b.id::text = n.payload ->> 'by') as by_name,
              (select c.display_name from persons c where c.id::text = n.payload ->> 'person_id' and c.deleted_at is null) as person_name
       from notifications n
       join profiles p on p.id = n.recipient_id
       left join notification_prefs np on np.profile_id = n.recipient_id and np.kind = n.kind
       where n.channels_sent is null
       order by n.created_at
       limit $1`,
      [BATCH],
    ),
  );
  for (const row of rows as Pending[]) await deliverOne(row);
}

export const deliveryJobs: Job[] = [
  { name: 'deliver_notifications', everyMinutes: 1, run: deliverPending },
  {
    name: 'trial_ending_reminders',
    everyMinutes: 60,
    run: async () => {
      await asServer((db) => db.query(`select queue_trial_reminders()`));
    },
  },
  { name: 'push_receipts', everyMinutes: 30, run: checkPushReceipts },
  {
    name: 'payments_tidy_up',
    everyMinutes: 60,
    run: async () => {
      await asServer(async (db) => {
        // Expo drops receipts after a day. A replayed webhook older than a year is still stopped by last_event_at.
        await db.query(`delete from push_tickets where created_at < now() - interval '2 days'`);
        await db.query(`delete from webhook_events where received_at < now() - interval '400 days'`);
      });
    },
  },
];

// Expo Push. Dead tokens are removed as soon as Expo reports them, either at once on the ticket or later on the receipt.
import { Expo } from 'expo-server-sdk';
import type { ExpoPushMessage } from 'expo-server-sdk';
import { asServer } from '../db.ts';

const expo = new Expo();

export interface PushContent {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** SOS: the alarm sound on the SOS channel. On iOS it also rings through silent mode once Apple grants Critical Alerts. */
  alarm?: boolean;
}

export const ALARM_SOUND = 'sos_alarm.wav';

function message(to: string, content: PushContent): ExpoPushMessage {
  if (!content.alarm) {
    return { to, title: content.title, body: content.body, data: content.data, sound: 'default', channelId: 'default' };
  }
  return {
    to,
    title: content.title,
    body: content.body,
    data: content.data,
    // Without Apple's entitlement iOS treats this as a normal sound, so it is safe to send before approval.
    sound: { critical: true, name: ALARM_SOUND, volume: 1 },
    channelId: 'sos-alarm',
    priority: 'high',
    interruptionLevel: 'critical',
    ttl: 600,
  } as ExpoPushMessage;
}

async function removeTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await asServer((db) => db.query(`delete from device_tokens where expo_push_token = any($1)`, [tokens]));
}

/** 'none' means this person has no device; that is not a failure. Throws when Expo cannot be reached. */
export async function sendPush(profileId: string, content: PushContent): Promise<'sent' | 'none'> {
  const { rows } = await asServer((db) => db.query(`select expo_push_token from device_tokens where profile_id = $1`, [profileId]));
  const tokens = rows.map((r) => r.expo_push_token as string);
  const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
  await removeTokens(tokens.filter((t) => !valid.includes(t)));
  if (valid.length === 0) return 'none';

  const messages: ExpoPushMessage[] = valid.map((to) => message(to, content));

  const dead: string[] = [];
  const tickets: { id: string; token: string }[] = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    const results = await expo.sendPushNotificationsAsync(chunk);
    results.forEach((ticket, i) => {
      const token = chunk[i].to as string;
      if (ticket.status === 'ok') tickets.push({ id: ticket.id, token });
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(token);
    });
  }
  await removeTokens(dead);
  if (tickets.length > 0) {
    await asServer((db) =>
      db.query(
        `insert into push_tickets (ticket_id, expo_push_token)
         select * from unnest($1::text[], $2::text[]) on conflict do nothing`,
        [tickets.map((t) => t.id), tickets.map((t) => t.token)],
      ),
    );
  }
  return tickets.length > 0 ? 'sent' : 'none';
}

/** Expo keeps receipts for a day and asks that they be read after 15 minutes. */
export async function checkPushReceipts(): Promise<void> {
  const { rows } = await asServer((db) =>
    db.query(
      `select ticket_id, expo_push_token from push_tickets
       where created_at < now() - interval '15 minutes' order by created_at limit 1000`,
    ),
  );
  if (rows.length === 0) return;
  const tokenOf = new Map<string, string>(rows.map((r) => [r.ticket_id as string, r.expo_push_token as string]));

  const dead: string[] = [];
  const finished: string[] = [];
  for (const chunk of expo.chunkPushNotificationReceiptIds([...tokenOf.keys()])) {
    const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    for (const id of chunk) {
      finished.push(id);
      const receipt = receipts[id];
      if (receipt?.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
        dead.push(tokenOf.get(id) as string);
      }
    }
  }
  await removeTokens(dead);
  await asServer((db) => db.query(`delete from push_tickets where ticket_id = any($1)`, [finished]));
}

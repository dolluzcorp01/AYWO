// Social area: live chat over WebSocket, routes that need signed file links, and the SOS path (immediate push and SMS).
// Everything else in this area is a database function reached through POST /rpc/<name> (rpc/social.ts).
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { jwtVerify } from 'jose';
import pg from 'pg';
import type { Client as PgClient } from 'pg';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { isUserBlocked, requireUser } from '../auth-tokens.ts';
import { config } from '../config.ts';
import { asCaller, asServer, databaseSsl } from '../db.ts';
import { ApiError, safeError } from '../errors.ts';
import { sendPush } from '../services/push.ts';
import { sendSms } from '../services/sms.ts';
import { signedReadUrls } from '../services/storage.ts';

const id = z.guid();

// ===== Files: stored paths become short-lived links just before leaving the server =====

interface MessageRow {
  media_path?: string | null;
  [key: string]: unknown;
}

async function signMessages(list: MessageRow[]): Promise<Record<string, unknown>[]> {
  const urls = await signedReadUrls(list.map((m) => m.media_path ?? null));
  return list.map(({ media_path, ...rest }) => ({ ...rest, media_url: media_path ? (urls.get(media_path) ?? null) : null }));
}

interface PostRow {
  media: { id: string; path: string; can_remove?: boolean }[];
  [key: string]: unknown;
}

async function signPosts(list: PostRow[]): Promise<Record<string, unknown>[]> {
  const urls = await signedReadUrls(list.flatMap((p) => p.media.map((m) => m.path)));
  return list.map((p) => ({ ...p, media: p.media.map((m) => ({ id: m.id, url: urls.get(m.path) ?? null, can_remove: m.can_remove ?? false })) }));
}

// ===== Live chat =====
// Postgres NOTIFY tells every API instance about a committed message, so this keeps working with more than one server.

const secret = new TextEncoder().encode(config.JWT_SECRET);
const AUTH_WAIT_MS = 10_000;
const PING_MS = 30_000;
const LISTEN_RETRY_MS = 5_000;
const MAX_CLIENT_MESSAGE = 4_096;
const SOCKET_OPEN = 1;
const MAX_SOCKETS_PER_USER = 10;
const SOS_NAME_MAX = 40;

const socketsByUser = new Map<string, Set<WebSocket>>();
let listener: PgClient | null = null;

function addSocket(userId: string, socket: WebSocket): void {
  const set = socketsByUser.get(userId) ?? new Set<WebSocket>();
  // One account cannot hold the server's memory open with endless sockets. The oldest gives way.
  if (set.size >= MAX_SOCKETS_PER_USER) {
    const oldest = set.values().next().value;
    if (oldest) {
      set.delete(oldest);
      oldest.close(4429, 'too_many_sockets');
    }
  }
  set.add(socket);
  socketsByUser.set(userId, set);
}

function removeSocket(userId: string, socket: WebSocket): void {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) socketsByUser.delete(userId);
}

/** Current members with Plus only, asked again for every message, so someone removed stops receiving at once. */
async function deliverMessage(messageId: string): Promise<void> {
  if (socketsByUser.size === 0) return;
  const { rows } = await asServer((db) =>
    db.query(
      `select social_message_json(m) as message,
              array(select r::text from social_chat_recipients(m.chat_id) r) as recipients
       from messages m where m.id = $1`,
      [messageId],
    ),
  );
  const row = rows[0] as { message: MessageRow & { chat_id: string }; recipients: string[] } | undefined;
  if (!row || !row.recipients.some((r) => socketsByUser.has(r))) return;
  const [message] = await signMessages([row.message]);
  const text = JSON.stringify({ type: 'message', chat_id: row.message.chat_id, message });
  for (const recipient of row.recipients) {
    for (const socket of socketsByUser.get(recipient) ?? []) {
      if (socket.readyState === SOCKET_OPEN) socket.send(text);
    }
  }
}

function scheduleListen(log: FastifyBaseLogger): void {
  setTimeout(() => {
    if (socketsByUser.size > 0) void startListener(log);
  }, LISTEN_RETRY_MS).unref();
}

/**
 * A connection of its own for LISTEN. Needs a direct database link: a connection pool in transaction mode drops LISTEN.
 * If this link is down, messages still save and the app keeps up by fetching (useChatSocket falls back).
 */
async function startListener(log: FastifyBaseLogger): Promise<void> {
  if (listener) return;
  const client = new pg.Client({
    connectionString: config.DATABASE_URL,
    ssl: databaseSsl(),
  });
  listener = client;
  const lost = (err?: Error) => {
    if (listener !== client) return;
    listener = null;
    if (err) log.error(safeError(err), 'chat listener lost');
    client.end().catch(() => undefined);
    scheduleListen(log);
  };
  client.on('error', lost);
  client.on('end', () => lost());
  client.on('notification', (note) => {
    try {
      const { message_id: messageId } = JSON.parse(note.payload ?? '{}') as { message_id?: string };
      if (messageId) deliverMessage(messageId).catch((err) => log.error(safeError(err), 'chat delivery failed'));
    } catch (err) {
      log.error(safeError(err), 'chat notification unreadable');
    }
  });
  try {
    await client.connect();
    await client.query('listen aywo_chat');
  } catch (err) {
    lost(err as Error);
  }
}

// ===== SOS words. Sentences use the name, never he or she =====

type Lang = 'en' | 'ta';
const langOf = (code: string | null | undefined): Lang => (code?.toLowerCase().startsWith('ta') ? 'ta' : 'en');

const SOS_WORDS: Record<Lang, {
  someone: string;
  smsStart: (name: string, link: string) => string;
  smsStop: (name: string) => string;
  stopBody: string;
  pushTitle: (name: string) => string;
  pushBody: string;
  pageTitle: string;
  needsHelp: (name: string) => string;
  lastSeen: string;
  noLocation: string;
  openMap: string;
  refreshes: string;
  notEmergency: string;
  ended: string;
  endedHelp: string;
}> = {
  en: {
    someone: 'A family member',
    smsStart: (name, link) => `AYWO SOS: ${name} needs help. Live location: ${link} Please call now. If in danger, call the local emergency number.`,
    smsStop: (name) => `AYWO: ${name} has ended the SOS.`,
    stopBody: 'No alarm any more. A quick call is still kind.',
    pushTitle: (name) => `SOS from ${name}`,
    pushBody: 'Open AYWO for the live location, and call now.',
    pageTitle: 'AYWO SOS live location',
    needsHelp: (name) => `${name} needs help`,
    lastSeen: 'Location last updated',
    noLocation: 'No location has reached us yet. This page refreshes by itself.',
    openMap: 'Open in maps',
    refreshes: 'This page refreshes every 20 seconds.',
    notEmergency: 'AYWO does not replace emergency services. If someone is in danger, call the local emergency number.',
    ended: 'This live location has ended',
    endedHelp: 'The SOS was stopped, or its time ran out.',
  },
  ta: {
    someone: 'குடும்ப உறுப்பினர் ஒருவர்',
    smsStart: (name, link) => `AYWO SOS: ${name} அவர்களுக்கு உதவி தேவை. நேரலை இருப்பிடம்: ${link} உடனே அழைக்கவும். ஆபத்து எனில் அவசர எண்ணை அழைக்கவும்.`,
    smsStop: (name) => `AYWO: ${name} SOS-ஐ முடித்துவிட்டார்.`,
    stopBody: 'இனி அலாரம் இல்லை. ஒரு அழைப்பு இன்னும் நல்லது.',
    pushTitle: (name) => `${name} அனுப்பிய SOS`,
    pushBody: 'நேரலை இருப்பிடத்திற்கு AYWO-வைத் திறந்து, உடனே அழைக்கவும்.',
    pageTitle: 'AYWO SOS நேரலை இருப்பிடம்',
    needsHelp: (name) => `${name} அவர்களுக்கு உதவி தேவை`,
    lastSeen: 'இருப்பிடம் கடைசியாகப் புதுப்பிக்கப்பட்டது',
    noLocation: 'இருப்பிடம் இன்னும் வரவில்லை. இந்தப் பக்கம் தானாகவே புதுப்பிக்கப்படும்.',
    openMap: 'வரைபடத்தில் திற',
    refreshes: 'இந்தப் பக்கம் 20 விநாடிக்கு ஒருமுறை புதுப்பிக்கப்படும்.',
    notEmergency: 'AYWO அவசர சேவைகளுக்கு மாற்று அல்ல. ஆபத்து எனில் உள்ளூர் அவசர எண்ணை அழைக்கவும்.',
    ended: 'இந்த நேரலை இருப்பிடம் முடிந்தது',
    endedHelp: 'SOS நிறுத்தப்பட்டது, அல்லது நேரம் முடிந்தது.',
  },
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

interface SosPageData {
  active: boolean;
  name?: string;
  language?: string;
  lat?: number | null;
  lng?: number | null;
  last_at?: string | null;
}

function sosPageHtml(data: SosPageData | null, lang: Lang): string {
  const w = SOS_WORDS[lang];
  const style = `body{margin:0;padding:24px;background:#FCFBFF;color:#17153A;font-family:Manrope,Arial,sans-serif}
main{max-width:480px;margin:0 auto}h1{font-size:26px;line-height:1.25;margin:0 0 12px}
p{font-size:16px;line-height:1.5;color:#55516F}
a.map{display:block;text-align:center;padding:16px;margin:18px 0;border-radius:28px;background:#8E26E1;color:#FFFFFF;font-weight:800;text-decoration:none}
.sos{color:#E94057;font-weight:800;letter-spacing:1.5px;font-size:14px}.note{font-size:13px}`;
  let body: string;
  let refresh = '';
  if (!data?.active) {
    body = `<h1>${escapeHtml(w.ended)}</h1><p>${escapeHtml(w.endedHelp)}</p>`;
  } else {
    refresh = '<meta http-equiv="refresh" content="20">';
    const name = data.name?.trim() || w.someone;
    const hasPlace = typeof data.lat === 'number' && typeof data.lng === 'number';
    body = `<div class="sos">SOS</div><h1>${escapeHtml(w.needsHelp(name))}</h1>`;
    if (hasPlace) {
      const when = data.last_at ? new Date(data.last_at).toISOString() : '';
      body += `<p>${escapeHtml(w.lastSeen)}: <time id="t" datetime="${when}">${when}</time></p>
<a class="map" rel="noreferrer" href="https://www.google.com/maps?q=${data.lat},${data.lng}">${escapeHtml(w.openMap)}</a>`;
    } else {
      body += `<p>${escapeHtml(w.noLocation)}</p>`;
    }
    body += `<p class="note">${escapeHtml(w.refreshes)}</p>`;
  }
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${refresh}
<title>${escapeHtml(w.pageTitle)}</title><style>${style}</style></head>
<body><main>${body}<p class="note">${escapeHtml(w.notEmergency)}</p></main>
<script>var t=document.getElementById('t');if(t&&t.dateTime){t.textContent=new Date(t.dateTime).toLocaleString()}</script>
</body></html>`;
}

/** Leaves out memories and comments by people the caller blocked, or who blocked the caller. */
function withoutHidden(posts: PostRow[], hiddenIds: string[]): PostRow[] {
  if (hiddenIds.length === 0) return posts;
  const hidden = new Set(hiddenIds);
  return posts
    .filter((p) => !hidden.has(String((p as { author_id?: string }).author_id)))
    .map((p) => {
      const comments = (p as { comments?: { author_id?: string }[] }).comments;
      return Array.isArray(comments) ? { ...p, comments: comments.filter((c) => !hidden.has(String(c.author_id))) } : p;
    });
}

interface SosTarget {
  owner_name: string;
  owner_language: string;
  position_no: number;
  profile_id: string | null;
  phone: string | null;
}

/** The name goes into a text to people who may not know AYWO, so it cannot carry a link or a long message. */
function nameForSms(name: string | null | undefined, fallback: string): string {
  const clean = (name ?? '').replace(/(https?:\/\/|www\.)\S*/gi, '').replace(/\s+/g, ' ').trim().slice(0, SOS_NAME_MAX).trim();
  return clean || fallback;
}

async function sosTargets(eventId: string): Promise<SosTarget[]> {
  const { rows } = await asServer((db) => db.query(`select * from sos_targets($1::uuid)`, [eventId]));
  return rows as SosTarget[];
}

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  // ===== WebSocket =====
  // The token comes in the first message, never in the address, so it stays out of server and proxy logs.
  // Server to app only: sending goes through POST /chats/:id/messages, which checks everything in one transaction.
  app.get('/ws', { websocket: true }, (socket, req) => {
    let userId: string | null = null;
    let authStarted = false;
    let alive = true;
    let expiry: NodeJS.Timeout | undefined;

    const authWait = setTimeout(() => socket.close(4401, 'not_signed_in'), AUTH_WAIT_MS);
    const ping = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      if (socket.readyState === SOCKET_OPEN) socket.ping();
    }, PING_MS);

    socket.on('pong', () => {
      alive = true;
    });
    socket.on('error', (err) => req.log.warn({ err }, 'chat socket error'));
    socket.on('close', () => {
      clearTimeout(authWait);
      clearInterval(ping);
      if (expiry) clearTimeout(expiry);
      if (userId) removeSocket(userId, socket);
    });

    socket.on('message', async (raw) => {
      const text = String(raw);
      if (text.length > MAX_CLIENT_MESSAGE) {
        socket.close(1009, 'too_big');
        return;
      }
      let message: { type?: unknown; token?: unknown };
      try {
        message = JSON.parse(text) as { type?: unknown; token?: unknown };
      } catch {
        socket.close(4400, 'bad_input');
        return;
      }
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (message.type !== 'auth' || typeof message.token !== 'string' || authStarted) {
        socket.close(4400, 'bad_input');
        return;
      }
      authStarted = true;
      try {
        const { payload } = await jwtVerify(message.token, secret, { algorithms: ['HS256'] });
        if (!payload.sub || !payload.exp) throw new Error('no subject');
        if (await isUserBlocked(payload.sub)) throw new Error('blocked');
        if (socket.readyState !== SOCKET_OPEN) return;
        userId = payload.sub;
        clearTimeout(authWait);
        addSocket(userId, socket);
        // The app reconnects with a fresh token after this close.
        expiry = setTimeout(() => socket.close(4401, 'token_expired'), Math.max(payload.exp * 1000 - Date.now(), 0));
        expiry.unref();
        await startListener(req.log);
        socket.send(JSON.stringify({ type: 'ready' }));
      } catch {
        socket.close(4401, 'not_signed_in');
      }
    });
  });

  // ===== Chat =====
  app.get<{ Params: { id: string }; Querystring: { before?: string; limit?: string } }>('/chats/:id/messages', async (req) => {
    const userId = await requireUser(req);
    const chatId = id.parse(req.params.id);
    const query = z
      .object({ before: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(100).optional() })
      .parse(req.query);
    const result = await asCaller(userId, async (db) => {
      const { rows } = await db.query(`select chat_messages($1::uuid, $2::timestamptz, $3::int) as r, social_hidden_people() as hidden`, [
        chatId,
        query.before ?? null,
        query.limit ?? 50,
      ]);
      // Messages from people the caller blocked, or who blocked the caller, are left out.
      const hidden = new Set(rows[0].hidden as string[]);
      const answer = rows[0].r as { chat: unknown; messages: MessageRow[] };
      return { chat: answer.chat, messages: answer.messages.filter((m) => !hidden.has(String((m as { sender_id?: string }).sender_id))) };
    });
    return { chat: result.chat, messages: await signMessages(result.messages) };
  });

  app.post<{ Params: { id: string } }>('/chats/:id/messages', async (req) => {
    const userId = await requireUser(req);
    const chatId = id.parse(req.params.id);
    const body = z
      .object({
        body: z.string().max(4000).nullish(),
        media_path: z.string().max(300).nullish(),
        media_kind: z.enum(['photo', 'voice']).nullish(),
        media_ms: z.number().int().min(0).max(3_600_000).nullish(),
        reply_to: id.nullish(),
        client_id: id.nullish(),
      })
      .parse(req.body);
    const message = await asCaller(userId, async (db) => {
      const { rows } = await db.query(
        `select send_message($1::uuid, $2::text, $3::text, $4::message_media_t, $5::int, $6::uuid, $7::uuid) as r`,
        [chatId, body.body ?? null, body.media_path ?? null, body.media_kind ?? null, body.media_ms ?? null, body.reply_to ?? null, body.client_id ?? null],
      );
      return rows[0].r as MessageRow;
    });
    const [signed] = await signMessages([message]);
    return signed;
  });

  // ===== Memories =====
  app.get<{ Querystring: Record<string, string> }>('/posts', async (req) => {
    const userId = await requireUser(req);
    const query = z
      .object({
        tree_id: id.optional(),
        group_id: id.optional(),
        before: z.iso.datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .parse(req.query);
    const posts = await asCaller(userId, async (db) => {
      const { rows } = await db.query(`select post_feed($1::uuid, $2::uuid, $3::timestamptz, $4::int) as r, social_hidden_people() as hidden`, [
        query.tree_id ?? null,
        query.group_id ?? null,
        query.before ?? null,
        query.limit ?? 20,
      ]);
      return withoutHidden(rows[0].r as PostRow[], rows[0].hidden as string[]);
    });
    return signPosts(posts);
  });

  app.get<{ Params: { id: string } }>('/posts/:id', async (req) => {
    const userId = await requireUser(req);
    const postId = id.parse(req.params.id);
    const post = await asCaller(userId, async (db) => {
      const { rows } = await db.query(`select post_detail($1::uuid) as r, social_hidden_people() as hidden`, [postId]);
      const [visible] = withoutHidden([rows[0].r as PostRow], rows[0].hidden as string[]);
      if (!visible) throw new ApiError(404, 'not_found');
      return visible;
    });
    const [signed] = await signPosts([post]);
    return signed;
  });

  // ===== SOS: sends directly, as the contract allows =====
  app.post('/sos/start', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const userId = await requireUser(req);
    const body = z
      .object({
        minutes: z.number().int().min(15).max(480),
        lat: z.number().min(-90).max(90).nullish(),
        lng: z.number().min(-180).max(180).nullish(),
      })
      .parse(req.body);
    const { started, callPhone } = await asCaller(userId, async (db) => {
      const { rows } = await db.query(`select sos_start($1::int, $2::float8, $3::float8) as r`, [body.minutes, body.lat ?? null, body.lng ?? null]);
      // Only a number this person typed in themselves. Handing back a family member's login number let anyone in a tree
      // or a joined group read it by naming them as first contact and pressing SOS.
      const first = await db.query(`select phone from sos_contacts where profile_id = $1 order by position, created_at limit 1`, [userId]);
      return {
        started: rows[0].r as { id: string; token: string; write_token: string; ends_at: string },
        callPhone: (first.rows[0]?.phone ?? null) as string | null,
      };
    });

    // From here the event is saved. A failure on one contact must not stop the others, or the answer to the phone.
    const targets = await sosTargets(started.id);
    const lang = langOf(targets[0]?.owner_language);
    const words = SOS_WORDS[lang];
    const name = nameForSms(targets[0]?.owner_name, words.someone);
    const link = `${config.PUBLIC_URL}/sos/live/${started.token}`;

    // Every contact with AYWO hears an alarm straight away, before the person is shown any choice, so even a press by
    // mistake gets a family member checking in. Contacts known only by number get the text.
    const smsTargets = targets.filter((t) => t.phone);
    const [sms, pushes] = await Promise.all([
      Promise.allSettled(smsTargets.map((t) => sendSms(t.phone as string, words.smsStart(name, link)))),
      Promise.allSettled(
        targets
          .filter((t) => t.profile_id)
          .map((t) =>
            sendPush(t.profile_id as string, {
              title: words.pushTitle(name),
              body: words.pushBody,
              data: { kind: 'sos', event_id: started.id, url: `/social/sos/watch/${started.id}` },
              alarm: true,
            }),
          ),
      ),
    ]);
    const failed = sms.filter((r) => r.status === 'rejected').length;
    if (failed > 0) req.log.error({ failed, event: started.id }, 'sos sms failed');   // no numbers in logs
    const ringing = pushes.filter((r) => r.status === 'fulfilled' && r.value === 'sent').length;

    return {
      id: started.id,
      write_token: started.write_token,
      ends_at: started.ends_at,
      call_phone: callPhone,
      app_alarms: ringing,
      sms_sent: smsTargets.length - failed,
      sms_failed: failed,
    };
  });

  app.post<{ Params: { id: string } }>('/sos/:id/stop', async (req) => {
    const userId = await requireUser(req);
    const eventId = id.parse(req.params.id);
    const changed = await asCaller(userId, async (db) => {
      const { rows } = await db.query(`select sos_stop($1::uuid) as r`, [eventId]);
      return rows[0].r as boolean;
    });
    if (changed) {
      // People on AYWO hear through the delivery job. Those known only by a typed number get a text here.
      const targets = await sosTargets(eventId);
      const words = SOS_WORDS[langOf(targets[0]?.owner_language)];
      const name = nameForSms(targets[0]?.owner_name, words.someone);
      // Straight away, so an alarm set off by mistake is called off on every phone it rang on.
      const results = await Promise.allSettled([
        ...targets.filter((t) => t.phone && !t.profile_id).map((t) => sendSms(t.phone as string, words.smsStop(name))),
        ...targets
          .filter((t) => t.profile_id)
          .map((t) =>
            sendPush(t.profile_id as string, {
              title: words.smsStop(name),
              body: words.stopBody,
              data: { kind: 'sos_stopped', event_id: eventId, url: `/social/sos/watch/${eventId}` },
            }),
          ),
      ]);
      // Pushed just now, so the delivery job must not send the 'sos_ended' rows again, by push or by text.
      await asServer((db) =>
        db.query(
          `update notifications set channels_sent = '{push}'
           where kind = 'sos_ended' and payload ->> 'event_id' = $1 and channels_sent is null`,
          [eventId],
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) req.log.error({ failed, event: eventId }, 'sos stop sms failed');
    }
    return { ok: true };
  });

  // From the phone's background task, which may run with the phone locked, when the sign-in token cannot be read.
  // The event's own long random key is the only thing that can add a location, and it cannot read anything.
  app.post('/sos/location', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const body = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100_000).nullish(),
      })
      .parse(req.body);
    const active = await asCaller(null, async (db) => {
      const { rows } = await db.query(`select sos_location($1::text, $2::float8, $3::float8, $4::real) as r`, [
        body.token,
        body.lat,
        body.lng,
        body.accuracy ?? null,
      ]);
      return rows[0].r as boolean;
    });
    return { active };
  });

  // Public, with no sign-in: the long random token is the key, and it stops working when the event ends.
  app.get<{ Params: { token: string } }>('/sos/live/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = req.params.token;
    const data = /^[a-f0-9]{64}$/.test(token)
      ? await asCaller(null, async (db) => {
          const { rows } = await db.query(`select sos_page($1) as r`, [token]);
          return rows[0].r as SosPageData | null;
        })
      : null;
    const lang = langOf(data?.language ?? req.headers['accept-language']);
    reply
      .status(data ? 200 : 404)
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Robots-Tag', 'noindex')
      .type('text/html; charset=utf-8');
    return sosPageHtml(data, lang);
  });
}

// AYWO staff console API (LLD S-19 to S-21, L5 no. 20, operations release), and the public takedown request.
// Every /admin route runs as the caller, checks the second sign-in step and the permission here, and the database
// function checks the permission again.
import type { FastifyInstance } from 'fastify';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { forgetBlockMemory, optionalUser, requireUser } from '../auth-tokens.ts';
import { isReviewerLogin } from '../config.ts';
import { asCaller, asServer } from '../db.ts';
import { ApiError } from '../errors.ts';
import { GRANTABLE, matchStep, newTotpSecret, openSecret, sealSecret, signStaffProof, staffCall, twoStepRequired } from '../staff.ts';

const paging = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};
const idParam = z.object({ id: z.string().uuid() });
const reason = z.string().trim().min(5).max(500);
const role = z.enum(['aywo_admin', 'sub_admin']);
const permissions = z.array(z.enum(GRANTABLE)).max(GRANTABLE.length).default([]);
const rolePermissions = z.array(z.enum(GRANTABLE)).min(1).max(GRANTABLE.length);
const code = z.string().regex(/^\d{6}$/);
const strict = { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } };

function e164(input: string): string {
  const parsed = parsePhoneNumberFromString(input);
  if (!parsed || !parsed.isValid()) throw new ApiError(422, 'phone_invalid');
  return parsed.number;
}

const coupon = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/),
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().max(300).nullable(),
    kind: z.enum(['percent', 'amount']),
    value: z.number().int().positive(),
    currency: z.enum(['INR', 'USD']).nullable(),
    products: z.array(z.enum(['tree_poster', 'family_book', 'premium_invite'])).min(1).max(3),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }).nullable(),
    max_uses: z.number().int().positive().nullable(),
    per_user_limit: z.number().int().min(1).max(100),
    new_users_only: z.boolean(),
    min_amount_minor: z.number().int().min(0),
    public: z.boolean(),
    active: z.boolean(),
  })
  .partial()
  .strict();

const announcement = z
  .object({
    title: z.string().trim().min(3).max(80),
    body: z.string().trim().max(200).nullable(),
    link_url: z.string().trim().max(300).nullable(),
    link_label: z.string().trim().max(30).nullable(),
    style: z.enum(['info', 'offer', 'celebration', 'warning']),
    placements: z.array(z.enum(['app_banner', 'web_banner', 'home_card'])).min(1).max(3),
    audience: z.enum(['everyone', 'plus', 'free', 'visitors']),
    languages: z.array(z.string().max(10)).max(20).nullable(),
    region: z.enum(['all', 'india', 'overseas']),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }).nullable(),
    priority: z.number().int().min(0).max(100),
    dismissible: z.boolean(),
    active: z.boolean(),
  })
  .partial()
  .strict();

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ----- Public: someone added to a tree without consent asks for removal. No sign-in. -----
  app.post('/takedown', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const body = z
      .object({
        person_id: z.string().uuid().optional(),
        subject_name: z.string().trim().min(1).max(200).optional(),
        requester_contact: z.string().trim().min(3).max(200),
        reason: z.string().trim().min(10).max(2000),
      })
      .refine((b) => b.person_id || b.subject_name)
      .parse(req.body);
    await asCaller(await optionalUser(req), (db) =>
      db.query(`select public.takedown_submit($1, $2, $3, $4)`, [
        body.person_id ?? null,
        body.subject_name ?? null,
        body.requester_contact,
        body.reason,
      ]),
    );
    return { ok: true };
  });

  // ----- Second sign-in step. These alone work before it is done. -----
  async function staffOnly(userId: string): Promise<{ confirmed: boolean; secret: string | null; last_step: number }> {
    return asServer(async (db) => {
      const { rows } = await db.query(
        `select m.confirmed_at is not null as confirmed, m.secret, coalesce(m.last_step, 0)::text as last_step
         from app_admins a join auth.users u on u.id = a.profile_id and u.banned_at is null
         left join admin_mfa m on m.profile_id = a.profile_id where a.profile_id = $1`,
        [userId],
      );
      if (!rows[0]) throw new ApiError(403, 'admin_not_allowed');
      return { confirmed: rows[0].confirmed as boolean, sealed: rows[0].secret as string | null, last_step: Number(rows[0].last_step) };
    }).then(async (row) => ({ confirmed: row.confirmed, secret: row.sealed ? await openSecret(row.sealed) : null, last_step: row.last_step }));
  }

  app.get('/admin/two-step', async (req) => {
    const userId = await requireUser(req);
    const state = await staffOnly(userId);
    return { set_up: state.confirmed, required: twoStepRequired || state.confirmed };
  });

  // A new secret each time until it is confirmed. Shown once; never sent again after that.
  app.post('/admin/two-step/setup', strict, async (req) => {
    const userId = await requireUser(req);
    const state = await staffOnly(userId);
    if (state.confirmed) throw new ApiError(409, 'admin_two_step_already');
    const secret = newTotpSecret();
    const label = await asServer(async (db) => {
      await db.query(
        `insert into admin_mfa (profile_id, secret) values ($1, $2)
         on conflict (profile_id) do update set secret = excluded.secret, last_step = 0, created_at = now()`,
        [userId, await sealSecret(secret)],
      );
      const { rows } = await db.query(`select display_name from profiles where id = $1`, [userId]);
      return String(rows[0]?.display_name ?? 'staff');
    });
    const account = encodeURIComponent(`AYWO staff:${label}`);
    return { secret, otpauth_url: `otpauth://totp/${account}?secret=${secret}&issuer=AYWO&digits=6&period=30` };
  });

  async function checkCode(userId: string, typed: string, confirming: boolean) {
    const state = await staffOnly(userId);
    if (!state.secret || state.confirmed === confirming) throw new ApiError(409, confirming ? 'admin_two_step_already' : 'admin_two_step_setup');
    const step = matchStep(state.secret, typed, state.last_step);
    if (step === null) throw new ApiError(422, 'admin_two_step_wrong');
    await asServer(async (db) => {
      await db.query(
        `update admin_mfa set last_step = $2, confirmed_at = coalesce(confirmed_at, now()) where profile_id = $1`,
        [userId, step],
      );
      if (confirming) {
        await db.query(`insert into admin_audit_log (actor_id, action, target_type, target_id) values ($1::uuid, 'staff.two_step_set_up', 'user', $1::text)`, [userId]);
      }
    });
    return signStaffProof(userId);
  }

  app.post('/admin/two-step/confirm', strict, async (req) => {
    const userId = await requireUser(req);
    return checkCode(userId, z.object({ code }).parse(req.body).code, true);
  });
  app.post('/admin/two-step/verify', strict, async (req) => {
    const userId = await requireUser(req);
    return checkCode(userId, z.object({ code }).parse(req.body).code, false);
  });

  // ----- Who am I, and the dashboard -----
  app.get('/admin/me', (req) => staffCall(req, null, 'admin_me'));
  app.get('/admin/dashboard', (req) => staffCall(req, null, 'admin_dashboard'));

  // ----- Work queue: everything waiting for staff, with an owner and a deadline -----
  app.get('/admin/work', (req) => {
    const q = z
      .object({
        view: z.enum(['open', 'mine', 'unassigned', 'overdue', 'done']).default('open'),
        kind: z.enum(['takedown', 'report', 'ticket', 'order', 'term_report']).optional(),
        ...paging,
      })
      .parse(req.query);
    return staffCall(req, null, 'admin_work_list', [q.view, q.kind ?? null, q.limit, q.offset]);
  });
  app.get('/admin/work/:id', (req) => staffCall(req, null, 'admin_work_detail', [idParam.parse(req.params).id]));
  app.patch('/admin/work/:id', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        status: z.enum(['open', 'in_progress', 'waiting', 'done']).optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        assignee_id: z.string().uuid().nullable().optional(),
        due_at: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(req.body);
    return staffCall(req, null, 'admin_work_update', [
      id,
      body.status ?? null,
      body.priority ?? null,
      body.assignee_id ?? null,
      body.assignee_id === null,
      body.due_at ?? null,
    ]);
  });
  app.post('/admin/work/:id/notes', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    return staffCall(req, null, 'admin_work_note', [id, body.body]);
  });

  // ----- Users -----
  app.get('/admin/users', (req) => {
    const q = z.object({ q: z.string().trim().max(200).optional(), ...paging }).parse(req.query);
    return staffCall(req, ['users', 'support'], 'admin_users_list', [q.q || null, q.limit, q.offset]);
  });
  // POST because it writes to the audit log, and the reason stays out of the address.
  app.post('/admin/users/:id/view', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    return staffCall(req, ['users', 'support'], 'admin_user_detail', [id, body.reason]);
  });
  app.post('/admin/users/:id/block', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    const answer = await staffCall(req, ['users'], 'admin_user_block', [id, body.reason]);
    forgetBlockMemory(id);
    return answer;
  });
  app.post('/admin/users/:id/unblock', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    const answer = await staffCall(req, ['users'], 'admin_user_unblock', [id, body.reason]);
    forgetBlockMemory(id);
    return answer;
  });
  app.post('/admin/users/:id/end-sessions', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    return staffCall(req, ['users'], 'admin_user_end_sessions', [id, body.reason]);
  });
  app.post('/admin/users/:id/give-plus', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ days: z.number().int().min(1).max(365), reason }).parse(req.body);
    return staffCall(req, ['payments', 'support'], 'admin_user_give_plus', [id, body.days, body.reason]);
  });

  // ----- Abuse reports -----
  app.get('/admin/reports', (req) => {
    const q = z.object({ status: z.enum(['open', 'removed', 'dismissed']).default('open'), ...paging }).parse(req.query);
    return staffCall(req, ['moderation'], 'admin_reports_list', [q.status, q.limit, q.offset]);
  });
  app.post('/admin/reports/:id/decide', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ decision: z.enum(['remove', 'dismiss']), note: reason, block_owner: z.boolean().default(false) }).parse(req.body);
    return staffCall(req, ['moderation'], 'admin_report_decide', [id, body.decision, body.note, body.block_owner]);
  });

  // ----- Help tickets -----
  app.get('/admin/tickets', (req) => {
    const q = z.object({ status: z.enum(['open', 'waiting', 'closed']).default('open'), ...paging }).parse(req.query);
    return staffCall(req, ['support'], 'admin_tickets_list', [q.status, q.limit, q.offset]);
  });
  app.get('/admin/tickets/:id', (req) => staffCall(req, ['support'], 'admin_ticket_detail', [idParam.parse(req.params).id]));
  app.post('/admin/tickets/:id/reply', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ body: z.string().trim().min(1).max(4000), close: z.boolean().default(false) }).parse(req.body);
    return staffCall(req, ['support'], 'admin_ticket_reply', [id, body.body, body.close]);
  });

  // ----- Orders: printing and shipping (refunds are in payments.ts, next to the providers) -----
  app.get('/admin/orders', (req) => {
    const q = z
      .object({
        fulfilment: z.enum(['none', 'queued', 'printing', 'shipped', 'delivered', 'cancelled']).optional(),
        q: z.string().trim().max(100).optional(),
        ...paging,
      })
      .parse(req.query);
    return staffCall(req, ['orders', 'payments'], 'admin_orders_list', [q.fulfilment ?? null, q.q || null, q.limit, q.offset]);
  });
  app.post('/admin/orders/:id/address', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    return staffCall(req, ['orders'], 'admin_order_detail', [id, body.reason]);
  });
  app.post('/admin/orders/:id/step', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        fulfilment: z.enum(['printing', 'shipped', 'delivered', 'cancelled']),
        carrier: z.string().trim().max(60).optional(),
        tracking_number: z.string().trim().max(80).optional(),
        tracking_url: z.string().trim().url().max(300).optional(),
      })
      .parse(req.body);
    return staffCall(req, ['orders'], 'admin_order_update', [
      id,
      body.fulfilment,
      body.carrier || null,
      body.tracking_number || null,
      body.tracking_url || null,
    ]);
  });

  // ----- Offers: coupons, banners, promotional messages -----
  app.get('/admin/coupons', (req) => {
    const q = z.object({ view: z.enum(['active', 'ended', 'all']).default('active') }).parse(req.query);
    return staffCall(req, ['marketing'], 'admin_coupons_list', [q.view]);
  });
  app.post('/admin/coupons', (req) => {
    const body = coupon.required({ code: true, title: true, kind: true, value: true, products: true }).parse(req.body);
    return staffCall(req, ['marketing'], 'admin_coupon_save', [null, JSON.stringify(body)]);
  });
  app.patch('/admin/coupons/:id', (req) => {
    const { id } = idParam.parse(req.params);
    return staffCall(req, ['marketing'], 'admin_coupon_save', [id, JSON.stringify(coupon.parse(req.body))]);
  });

  app.get('/admin/announcements', (req) => {
    const q = z.object({ view: z.enum(['active', 'ended', 'all']).default('active') }).parse(req.query);
    return staffCall(req, ['marketing'], 'admin_announcements_list', [q.view]);
  });
  app.post('/admin/announcements', (req) => {
    const body = announcement.required({ title: true, placements: true }).parse(req.body);
    return staffCall(req, ['marketing'], 'admin_announcement_save', [null, JSON.stringify(body)]);
  });
  app.patch('/admin/announcements/:id', (req) => {
    const { id } = idParam.parse(req.params);
    return staffCall(req, ['marketing'], 'admin_announcement_save', [id, JSON.stringify(announcement.parse(req.body))]);
  });

  const audience = {
    audience: z.enum(['everyone', 'plus', 'free']),
    language: z.string().max(10).optional(),
    region: z.enum(['all', 'india', 'overseas']).default('all'),
  };
  app.get('/admin/campaigns', (req) => staffCall(req, ['marketing'], 'admin_campaigns_list'));
  app.get('/admin/campaigns/count', (req) => {
    const q = z.object(audience).parse(req.query);
    return staffCall(req, ['marketing'], 'admin_campaign_count', [q.audience, q.language || null, q.region]);
  });
  app.post('/admin/campaigns', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, (req) => {
    const body = z
      .object({
        title: z.string().trim().min(3).max(60),
        body: z.string().trim().min(5).max(180),
        link: z.string().trim().regex(/^\/[A-Za-z0-9/_-]*$/).max(100).optional(),
        reason,
        ...audience,
      })
      .parse(req.body);
    return staffCall(req, ['marketing'], 'admin_campaign_send', [
      body.title,
      body.body,
      body.link ?? null,
      body.audience,
      body.language || null,
      body.region,
      body.reason,
    ]);
  });

  // ----- System notices: AYWO Admin only. Safety and service news, never marketing (PRD). -----
  app.post('/admin/broadcast', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, (req) => {
    const body = z
      .object({ title: z.string().trim().min(3).max(80), body: z.string().trim().min(10).max(500), reason })
      .parse(req.body);
    return staffCall(req, ['staff'], 'admin_broadcast', [body.title, body.body, body.reason]);
  });

  // ----- App settings, analytics, app health -----
  app.get('/admin/config', (req) => staffCall(req, ['settings'], 'admin_config_get'));
  app.patch('/admin/config/:key', (req) => {
    const { key } = z.object({ key: z.enum(['min_version', 'latest_version', 'maintenance', 'features', 'whats_new', 'support']) }).parse(req.params);
    const body = z.object({ value: z.record(z.string(), z.unknown()), reason }).parse(req.body);
    return staffCall(req, ['settings'], 'admin_config_set', [key, JSON.stringify(body.value), body.reason]);
  });
  app.get('/admin/analytics', (req) => {
    const q = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }).parse(req.query);
    return staffCall(req, ['analytics'], 'admin_analytics', [q.days]);
  });
  app.get('/admin/health', (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) }).parse(req.query);
    return staffCall(req, ['settings', 'analytics'], 'admin_app_health', [q.days]);
  });

  // ----- Trees -----
  app.get('/admin/trees', (req) => {
    const q = z.object({ q: z.string().trim().max(200).optional(), ...paging }).parse(req.query);
    return staffCall(req, ['trees'], 'admin_trees_list', [q.q || null, q.limit, q.offset]);
  });
  app.post('/admin/trees/:id/people', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason, ...paging }).parse(req.body);
    return staffCall(req, ['trees'], 'admin_tree_people', [id, body.reason, body.limit, body.offset]);
  });

  // ----- Dictionary -----
  app.get('/admin/kin-terms', (req) => {
    const q = z
      .object({ status: z.enum(['pending', 'verified', 'ai_seeded', 'rejected']).default('pending'), ...paging })
      .parse(req.query);
    return staffCall(req, ['dictionary'], 'admin_kin_terms_list', [q.status, q.limit, q.offset]);
  });
  app.post('/admin/kin-review', (req) => {
    const body = z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'reject']) }).parse(req.body);
    return staffCall(req, ['dictionary'], 'admin_kin_review', [body.id, body.decision]);
  });
  app.get('/admin/term-reports', (req) => {
    const q = z.object({ status: z.enum(['open', 'accepted', 'dismissed']).default('open'), ...paging }).parse(req.query);
    return staffCall(req, ['dictionary'], 'admin_term_reports_list', [q.status, q.limit, q.offset]);
  });
  app.post('/admin/term-reports/:id/decide', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        decision: z.enum(['accept', 'dismiss']),
        term: z.string().trim().max(120).optional(),
        term_native: z.string().trim().max(120).optional(),
      })
      .parse(req.body);
    return staffCall(req, ['dictionary'], 'admin_term_report_decide', [id, body.decision, body.term || null, body.term_native || null]);
  });

  // ----- Takedowns -----
  app.get('/admin/takedowns', (req) => {
    const q = z.object({ status: z.enum(['open', 'removed', 'dismissed']).default('open'), ...paging }).parse(req.query);
    return staffCall(req, ['takedowns'], 'admin_takedowns_list', [q.status, q.limit, q.offset]);
  });
  app.post('/admin/takedowns/:id/decide', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ decision: z.enum(['remove', 'dismiss']), note: reason, person_id: z.string().uuid().optional() })
      .parse(req.body);
    return staffCall(req, ['takedowns'], 'admin_takedown_decide', [id, body.decision, body.note, body.person_id ?? null]);
  });

  // ----- Payments -----
  app.get('/admin/payments', (req) => {
    const q = z
      .object({ status: z.enum(['trial', 'active', 'grace', 'expired', 'cancelled']).optional(), ...paging })
      .parse(req.query);
    return staffCall(req, ['payments'], 'admin_payments_overview', [q.status ?? null, q.limit, q.offset]);
  });

  // ----- Staff and team roles: AYWO Admin only -----
  app.get('/admin/roles', (req) => staffCall(req, ['staff'], 'admin_roles_list'));
  app.post('/admin/roles', (req) => {
    const body = z
      .object({ name: z.string().trim().min(2).max(40), description: z.string().trim().max(200).optional(), permissions: rolePermissions })
      .parse(req.body);
    return staffCall(req, ['staff'], 'admin_role_save', [null, body.name, body.description ?? null, body.permissions]);
  });
  app.patch('/admin/roles/:id', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ name: z.string().trim().min(2).max(40), description: z.string().trim().max(200).optional(), permissions: rolePermissions })
      .parse(req.body);
    return staffCall(req, ['staff'], 'admin_role_save', [id, body.name, body.description ?? null, body.permissions]);
  });
  app.delete('/admin/roles/:id', (req) => staffCall(req, ['staff'], 'admin_role_delete', [idParam.parse(req.params).id]));

  app.get('/admin/staff', (req) => {
    const q = z.object(paging).parse(req.query);
    return staffCall(req, ['staff'], 'admin_staff_list', [q.limit, q.offset]);
  });
  app.post('/admin/staff', (req) => {
    const body = z
      .object({ phone: z.string().max(30), role, permissions, team_role_id: z.string().uuid().nullable().optional() })
      .parse(req.body);
    const phone = e164(body.phone);
    // The reviewers' code is public, so their number can never become staff, now or by invite.
    if (isReviewerLogin(phone)) throw new ApiError(422, 'not_allowed');
    return staffCall(req, ['staff'], 'admin_staff_add', [phone, body.role, body.permissions, body.team_role_id ?? null]);
  });
  app.patch('/admin/staff/:id', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ role, permissions, team_role_id: z.string().uuid().nullable().optional() }).parse(req.body);
    return staffCall(req, ['staff'], 'admin_staff_update', [id, body.role, body.permissions, body.team_role_id ?? null]);
  });
  app.delete('/admin/staff/:id', (req) => {
    const { id } = idParam.parse(req.params);
    return staffCall(req, ['staff'], 'admin_staff_remove', [id]);
  });
  app.delete('/admin/staff-invites/:key', (req) => {
    const { key } = z.object({ key: z.string().regex(/^[0-9a-f]{32}$/) }).parse(req.params);
    return staffCall(req, ['staff'], 'admin_staff_invite_cancel', [key]);
  });
  app.post('/admin/staff/:id/two-step-reset', (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    return staffCall(req, ['staff'], 'admin_mfa_reset', [id, body.reason]);
  });

  // ----- Audit log: AYWO Admin only -----
  app.get('/admin/audit', (req) => {
    const q = z
      .object({ action: z.string().trim().max(100).optional(), actor: z.string().uuid().optional(), ...paging })
      .parse(req.query);
    return staffCall(req, ['audit'], 'admin_audit_list', [q.action || null, q.actor ?? null, q.limit, q.offset]);
  });
}

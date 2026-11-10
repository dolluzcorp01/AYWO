# AYWO build contract

Rules every part of this codebase follows. Read this first.

## Stack

- Monorepo, pnpm. `apps/app` Expo (Android, iOS, web; Expo SDK 58, expo-router). `apps/api` Node + Fastify + TypeScript, run with tsx. `db/` plain Postgres for DigitalOcean managed Postgres. `packages/*` pure TypeScript.
- Files go to DigitalOcean Spaces with signed links (`apps/api/src/services/storage.ts`, `uploadFile` in `apps/app/src/lib/api.ts`).
- There is no Supabase. The migrations keep `auth.uid()` and row rules because the API runs each request as role `authenticated` or `anon` (`asCaller` in `apps/api/src/db.ts`).

## API rules

- Default to `asCaller(userId, ...)`, so row rules apply. `asServer` is only for webhooks, jobs and places where the route has already decided what is allowed.
- `requireUser(req)` / `optionalUser(req)` from `auth-tokens.ts`. Validate every body with zod.
- Errors: throw `new ApiError(status, 'code')`. In SQL: `raise exception 'code' using errcode = 'PT403'` (the number is the HTTP status). Replies are `{code, message_key}`, and the app shows `errors.<code>`, so every new code needs an `errors` entry in that area's locale file.
- Work that writes several rows belongs in one database function, or in one `asCaller` block. A listed function is callable at `POST /rpc/<name>` once it is in that area's `apps/api/src/rpc/<area>.ts`.
- Database functions: `security definer set search_path = public`, check `auth.uid()` and rights themselves, then `revoke all on function ... from public, anon, authenticated; grant execute ... to authenticated;`.
- Every new table: `alter table ... enable row level security`, explicit column grants, explicit policies. No policy and no grant means clients cannot touch it. Migrations run inside a transaction: no `create index concurrently`, and do not `alter type add value` then use it in the same file.
- Contact values never appear in history, logs, notifications or list endpoints (LLD L4.3).
- Notifications: insert a row into `notifications (recipient_id, kind, payload)`. The delivery job sends push, SMS and email according to `notification_prefs`. Nothing else sends directly, except OTP and SOS.
- Never log phone numbers, OTPs, tokens or contact values.

## App rules

- Follow the screen patterns in `apps/app/app/person/[personId].tsx`, `apps/app/src/tree/useCard.ts` and `apps/app/src/components/ui.tsx`. Data through TanStack Query and `api` from `@/lib/api`.
- Colours, gradients, fonts and tap size only from `@/theme/tokens`. Frozen design: LLD L9. One or two neon panels per screen. Red only for warnings and the alert badge. WhatsApp green is the only other colour.
- No hard-coded text: every string goes through `t()`, in BOTH `locales/en-US.<area>.json` and `locales/ta.<area>.json`, under top-level keys unique to that area. Tamil is a first draft for the founder to check.
- Handle loading, error and empty states on every screen. Minimum tap size 44. Add accessibility roles and labels.
- Never guess someone's gender in a sentence: no he, she, his, her in the interface. Use the name.
- Never call a tree's Creator 'owner' or 'admin'. Tree roles: Viewer, Commenter, Editor, Co-creator, Creator. 'AYWO Admin' and 'Sub-admin' are the app's own staff.
- No real family names in code or tests. Use made-up names.
- Imports in `packages/*` and `apps/api` use explicit `.ts` extensions; `apps/app` uses `@/...` with none.

## Who owns what

Touch only your own files. If you need something from another area, use the endpoints below and leave a note in your report.

| Area | Owns |
|---|---|
| **tree** | `apps/api/src/routes/tree-edit.ts`, `rpc/tree-edit.ts`, `jobs/tree.ts`, `db/migrations/0006_*.sql`, `db/tests/004_*.sql`, `packages/gedcom` |
| **screens** | All of `apps/app/app/` except the routes others own, `apps/app/src/` except `pay`, `admin` and `social`, `locales/*.p1.json` |
| **pay** | `routes/payments.ts`, `rpc/payments.ts`, `jobs/delivery.ts`, `services/email.ts`, `services/push.ts`, `db/migrations/0007_*.sql`, `db/tests/005_*.sql`, `apps/app/app/plus.tsx`, `family-plan.tsx`, `apps/app/src/pay/`, `locales/*.pay.json` |
| **admin** | `routes/admin.ts`, `rpc/admin.ts`, `jobs/admin.ts`, `db/migrations/0008_*.sql`, `db/tests/006_*.sql`, `apps/app/app/admin/`, `apps/app/src/admin/`, `locales/*.admin.json` |
| **social** | `routes/social.ts`, `rpc/social.ts`, `jobs/social.ts`, `db/migrations/0009_*.sql`, `db/tests/007_*.sql`, `apps/app/app/social/`, `apps/app/src/social/`, `locales/*.social.json` |

## Endpoints shared between areas

Owned by **tree**, used by **screens**:

```
GET    /me                                 {id, display_name, login_phone, email, language_code, large_text, plus, plus_until, admin_role}
PATCH  /me                                 {display_name?, email?, language_code?, large_text?}
POST   /me/consents                        {kind, version}
GET    /trees                              [{id, name, people, role, joined}]   mine and shared with me
POST   /trees                              {name} -> {id}
PATCH  /trees/:id                          {name?, successor_id?}
DELETE /trees/:id
GET    /trees/:id/search?q=                [{id, name, relation?}]              name match, respects row rules
PATCH  /persons/:id                        {version, ...fields, photo_path?}    409 version_conflict on a clash
DELETE /persons/:id                        soft delete
GET    /persons/:id/contacts-for-edit      contacts for those who can edit
GET    /persons/:id/comments               POST {body}
GET    /trees/:id/shares                   POST {scope_person_id?, grantee_person_id?, grantee_phone?, role, edit_mode, contacts_visible, expires_at?} -> {id, link_url}
PATCH  /shares/:id                         DELETE /shares/:id (revoke)
GET    /activity?tab=needs_you|changes|access|all     merged feed for wireframe E4
POST   /requests/:id/decide                {decision: 'approve'|'decline', edited_payload?}
GET    /trees/:id/history?person_id=       POST /history/revert {history_id? , batch_id?}
POST   /trees/:id/merge-scan               GET /merge/:request_id    POST /merge/:request_id/apply
GET    /trees/:id/export.ged?include_living=0|1      GEDCOM file
GET    /trees/:id/export-link?format=gedcom|pdf      {url}
GET    /kin/suggest?lang=&q=               POST /kin/terms {path_code, language_code, term}    POST /kin/reports {kin_term_id, suggestion}
GET    /notifications                      POST /notifications/:id/read       GET/PATCH /notification-prefs
POST   /account/export -> {url}            POST /account/delete
```

Already built: `POST /auth/otp/send`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`, `POST /tree-view`, `GET /view-by-link/:token`, `POST /uploads/presign`, `POST /import/upload` (source lighten or gedcom), `POST /rpc/<name>`.

Owned by **pay**, used by **screens** and **social**:

```
GET  /plan                     {plus, status, store, renews_at, trial_ends_at, is_payer, members, country, prices, web_methods}
POST /plan/members             {phone? , profile_id?}      DELETE /plan/members/:profile_id
POST /pay/razorpay/subscribe   {product_id} -> {subscription_id, key_id}
POST /pay/stripe/checkout      {product_id} -> {url}
POST /pay/order                {product: 'tree_poster'|'family_book'|'premium_invite', ...} -> razorpay order or stripe url
POST /devices                  {expo_push_token, platform}
```

SQL `has_plus(profile)` is the only check for Plus. `/plus` and `/family-plan` are the routes to link to.

Owned by **social**: `apps/app/src/social/HomeEntries.tsx` exports `<SocialHomeEntries />`, which **screens** renders on Home. `apps/app/src/social/SosButton.tsx` exports `<SosButton />`, which **screens** renders on Me.

**screens** owns `/after-login`: goes to 'Is this you?' when `claim_candidates` returns any, to the profile step when `display_name` is empty, otherwise Home.

## Payments

- Inside the Android and iOS apps, AYWO Plus goes through Google Play and Apple billing, via RevenueCat (Apple Pay works automatically on iOS). This is a store rule.
- Web in India: Razorpay Checkout with UPI, debit card and credit card. Web overseas: Stripe Checkout with cards and Apple Pay on Safari.
- Physical goods (tree poster, family book) may use Razorpay or Stripe inside the apps too. Premium invite designs are digital, so inside the apps they use store billing.
- Prices: Rs 29 or USD 0.99 a month; Rs 399 or USD 9.99 a year with a 2-month free trial everywhere; family plan of 6. Webhooks alone change `family_plans`.

## Checking your work

This laptop has no Node, so nothing can be run or compiled here. Read your code back carefully for type errors, wrong imports and wrong SQL. Say plainly in your report what could not be checked. Do not install anything.

# AYWO deployment

Order agreed with the founder: web first, then Android, then iOS, with the backend and admin alongside. GitHub, then DigitalOcean.

## 1. GitHub

Repo: `dolluzcorp01/AYWO` (make it private before real data goes in). CI (`.github/workflows/ci.yml`) runs type checks, unit tests and database rule tests on each pull request.

## 2. DigitalOcean

| Resource | Use | Notes |
|---|---|---|
| Managed Postgres 17 (Bangalore) | Database | Use the **direct** connection for `DATABASE_URL`: chat uses LISTEN/NOTIFY, which a transaction-mode pool drops. The API's database user must be allowed to `create role`, or create the roles `anon` and `authenticated` first. Check that the extensions `pg_trgm` and `pgcrypto` install. |
| Spaces (Bangalore) | Files | Private bucket `aywo`. Add a CORS rule for `https://aywo.in`, methods GET and PUT, or web uploads fail. |
| App Platform, or a Droplet running `apps/api/Dockerfile` | API on `api.aywo.in`, web on `aywo.in` | `.do/app.yaml` describes it, including a migration step before each deploy. More than one API instance is safe: jobs take an advisory lock and chat fan-out goes through Postgres NOTIFY. |

First deploy: set every value from `.env.example`. The migration step in `.do/app.yaml` runs `migrate.ts --seed` before every deploy; seeds only add missing rows, so staff edits to the dictionary are kept. On a Droplet run it yourself:

```bash
pnpm --filter @aywo/api exec tsx src/migrate.ts --seed
```

`DATABASE_CA_CERT`: paste the cluster's CA certificate (Databases > your cluster > Download CA certificate). With `DATABASE_SSL=true` the API refuses to start in production without it, because an unchecked certificate lets anyone in the middle pretend to be the database.

```bash
pnpm --filter @aywo/api exec tsx src/create-admin.ts +91XXXXXXXXXX
```

`JWT_SECRET` and `OTP_SECRET`: `openssl rand -base64 48`. The API refuses to start in production on the dummy values.

`CLIENT_IP_HEADER`: rate limits count visitors by this header. Confirm `do-connecting-ip` really arrives on App Platform. On a bare Droplet with nothing in front, set it empty, or the limits can be escaped.

Spaces: add a lifecycle rule to expire `exports/` and `imports/` after 30 days. Files are not removed when an account is deleted, so add a sweep job before launch.

## 3. Outside services

Everything starts on dummy keys, and only `.env` changes:

- **SMS for OTP:** `SMS_PROVIDER=msg91` or `twilio`. India needs a DLT-registered template for MSG91. `console` refuses to run in production.
- **SendGrid:** API key, and a verified sender domain for `EMAIL_FROM`.
- **Razorpay, Stripe, RevenueCat:** see `docs/PAYMENTS.md`.

## 4. Web

Built by `.do/app.yaml` (`expo export --platform web`). The admin app is on the same site at `/admin`.

## 5. Android, then iOS

Expo generates the native projects, so there is no separate Android or iOS code to maintain:

```bash
cd apps/app
```

```bash
npx eas build --profile preview --platform android
```

```bash
npx eas build --profile production --platform ios
```

```bash
npx eas submit --profile production --platform ios
```

SOS alarms. When someone starts an SOS, every contact with AYWO gets a push on the `sos-alarm` channel with the sound `assets/sounds/sos_alarm.wav`. Android rings through Do Not Disturb once the contact allows it (the SOS screen has the button). For iPhones to ring on silent, apply to Apple for the Critical Alerts entitlement now, because it takes weeks: developer.apple.com/contact/request/notifications-critical-alerts-entitlement. Reason to give: a family safety app whose SOS must reach relatives at once. After approval, add this to `ios` in `app.json`, then rebuild:

```json
"entitlements": { "com.apple.developer.usernotifications.critical-alerts": true }
```

Do not add it before approval: the build would fail to sign. The server already sends the alarm as critical, which iOS treats as a normal sound until then.

Before submitting: set the EAS project id and replace the placeholders in `eas.json`, set up store products `aywo_plus_monthly` and `aywo_plus_yearly`, and set `OTP_TEST_PHONE`, `OTP_TEST_CODE` and `OTP_TEST_UNTIL` for reviewers. Apple and Google require privacy answers and a delete-account path (the app has one).

## 6. Operations release (Nov 2026)

Migration `0012_operations.sql` runs with the others (`pnpm migrate`). It adds the staff work queue, team roles, two-step sign-in records, abuse reports and blocking, help tickets, order fulfilment, coupons, banners, promotional messages, app settings, crash reports, referrals, emergency cards and storage clean-up. Its tests are `db/tests/010_operations.test.sql`.

1. **Staff second step.** Production asks every staff member for an authenticator app code (Google or Microsoft Authenticator) every 12 hours. Leave `STAFF_TWO_STEP` unset. Only in an emergency set it to `off`. The first AYWO Admin sets it up at their first sign-in to `/admin`; a lost phone is reset by another AYWO Admin on the Staff page. Set `STAFF_SECRET_KEY` to 32 or more random characters before the first staff sign-in: it seals the authenticator secrets in the database. Changing it later means every staff member sets up again.
2. **CORS.** The API now accepts the `X-Staff-Proof` header from `WEB_URL`. Nothing to configure.
3. **Jobs.** Six new jobs run inside the API (work deadlines, referral rewards, birthday reminders at 8 am India time, storage clean-up, upload size check, tidy-up). One API instance runs them, as before.
4. **Spaces permissions.** The key needs delete and head (size) rights on the bucket, for the clean-up and size-check jobs.
5. **Phone links.** Fill in `apps/app/public/.well-known/` (see GO-LIVE-PLACEHOLDERS.md) and check both files are served as JSON over https with no redirect.
6. **Email.** Notification emails now go only to confirmed addresses. People confirm with a 6-digit code under Me > Notifications. SendGrid must be live for codes to arrive.
7. **After deploy,** in the staff panel: App settings > App versions should match `app.json` (0.1.0 at launch). Raise the minimum only when an old version must stop.

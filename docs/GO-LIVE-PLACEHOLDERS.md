# Public pages: what to fill in before going live

The pages are at `/faq`, `/terms`, `/privacy`, `/refunds` and `/contact`. They open without signing in. Fill everything in one file, `apps/app/src/legal/publisher.ts`, then run `pnpm legal:check`. It fails until the list below is done.

| Value | What goes there |
|---|---|
| `company` | Legal name of the company that publishes AYWO |
| `cin` | Its Corporate Identity Number |
| `gstin` | Its GST number |
| `address` | Registered office |
| `email`, `phone`, `supportHours` | Customer support, as shown to customers |
| `grievanceOfficer`, `grievanceEmail` | Named Grievance Officer. Indian rules require this |
| `courtCity` | City whose courts hear disputes |
| `deliveryDays` | Delivery time for the poster and book |

Draft numbers to confirm: `refundDays`, `damageDays` and `refundWorkingDays` are all 7.

Then:

1. Have a lawyer review all the pages. The wording is a draft, not legal advice.
2. Have a native speaker check the Tamil. Run `pnpm locales:translate` for other languages.
3. Set `LEGAL_DRAFT` to `false` to remove the draft notice.
4. If the Terms or Privacy policy changed after people have signed up, change `LEGAL_VERSION`, so consent is recorded again.

The poster and book now have a print and ship workflow in the staff panel (Orders). Before selling them, agree a printer and courier, confirm the prices in `apps/api/src/routes/payments.ts` (`ORDER_PRICES`), and give an Operations staff member the Orders permission.

## Operations release: values to fill in

| Where | What |
|---|---|
| `apps/app/public/.well-known/apple-app-site-association` | Replace `XXXTEAMID` with the Apple Developer Team ID (two places). |
| `apps/app/public/.well-known/assetlinks.json` | Replace the fingerprint with the SHA-256 of the Play App Signing key (Play Console, App integrity). |
| `apps/app/src/ops/appConfig.tsx` `STORE_LINKS.ios` | Replace `idXXX` with the App Store id once the app is listed. |
| Staff panel, App settings, Support | Support email and hours shown to people (seeded as `XXX`). |
| Staff panel, App settings, App versions | Raise the minimum version when an old version must stop working. Seeded at 0.1.0, the version in `app.json`. |
| DigitalOcean app settings | `BACKUP_KEY` (copy kept outside DigitalOcean) and `OPS_ALERT_EMAIL`. See `docs/runbook-backups.md`. |
| DigitalOcean, Apps, aywo, Settings, Alerts | Emails for deploy failed, domain failed, CPU, memory and restart alerts (rules are in `.do/app.yaml`). |
| After going live | One practice restore into an empty database (`docs/runbook-backups.md`, step 4). |

Both `.well-known` files must be served from `https://aywo.in/.well-known/` as `application/json`, with no redirect. Check after each web deploy:
`curl -I https://aywo.in/.well-known/apple-app-site-association`

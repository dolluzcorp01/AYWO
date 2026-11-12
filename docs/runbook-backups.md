# Backups, alerts and restoring AYWO

Two kinds of database backup run at the same time:

| | DigitalOcean's own | AYWO's nightly backup |
|---|---|---|
| Made by | DigitalOcean (managed database) | The API, every night from 2 am India time |
| Kept | 7 days, can restore to any minute | 30 daily + 12 monthly (one per month) |
| Where | DigitalOcean | Our Spaces bucket `<SPACES_BUCKET>-backups`, encrypted |
| Good for | "Undo the last few hours" | Anything older, or if the DigitalOcean account itself has a problem |

Photos and files live in Spaces and are not in the database backup.

## 1. Setting it up (once, before going live)

1. Make a key: `openssl rand -base64 32`
2. Put it in the DigitalOcean app settings as `BACKUP_KEY` (encrypted secret).
3. **Save a copy of the key outside DigitalOcean** (a password manager Shoban controls). Without the key, no backup can ever be opened. If DigitalOcean is the problem, the copy there does not help.
4. Set `OPS_ALERT_EMAIL` to the address that should get alert emails.
5. In DigitalOcean, Apps, aywo, Settings, Alerts: add the same emails, so deploy failures, high CPU/memory and restarts reach you too.
6. After the next deploy, open Admin, App settings, App health. By the next morning "Database backups" should show a good backup. Or make one right away (step 3 below).

## 2. What sends an alert email

At most one email per problem every 6 hours:
- A background job fails 3 times in a row
- A nightly backup fails
- No good backup for 36 hours
- More than 20 server errors in an hour
- In production, `BACKUP_KEY` is not set (daily reminder)

Plus DigitalOcean's own: deploy failed, domain failed, CPU over 80% or memory over 85% for 10 minutes, more than 3 restarts in 5 minutes.

For an outside uptime monitor (for example UptimeRobot, free), watch `https://api.aywo.in/health/deep`. It answers 503 when the database cannot be reached.

## 3. Commands

On a laptop (reads `.env`):

```
pnpm backup:now                      # make a backup now
pnpm backup:list                     # list backups, newest first
pnpm backup:restore --latest --to <empty database url>
pnpm backup:restore --key db/daily/<name>.dump.enc --to <empty database url>
pnpm backup:restore --latest --file ./aywo.dump     # only download and open it
```

In the DigitalOcean console of the `api` component (there is no `.env` there; settings come from the app):

```
pnpm exec tsx src/backup-now.ts
pnpm exec tsx src/backup-now.ts --list
pnpm exec tsx src/restore-backup.ts --latest --to <empty database url>
```

The laptop needs the same `BACKUP_KEY`, `SPACES_*` settings as production to open production backups.

## 4. Restoring after a problem

Never restore over the live database. The script refuses to. Restore into a new database, check it, then switch.

1. **Decide which copy.** Lost the last few hours? Use DigitalOcean's point-in-time restore (Databases, aywo, Backups, Restore): it makes a new database cluster at the minute you choose. Anything older, or DigitalOcean's copy is gone: use AYWO's nightly backup.
2. **Stop changes.** Admin, App settings, turn on maintenance, so nobody adds data that would be lost in the switch.
3. **Make an empty database.** In DigitalOcean: Databases, aywo, Users & Databases, add a database (for example `aywo_restore`). Copy its connection string.
4. **Restore.** `pnpm exec tsx src/restore-backup.ts --latest --to "<connection string of aywo_restore>"`. It creates the app's database roles if needed, then restores data, security rules and permissions in one go. Any error stops it and leaves nothing half-done.
5. **Check it.** Point a laptop's `.env` `DATABASE_URL` at `aywo_restore`, run `pnpm dev`, sign in with a test account, open a tree. Compare a few numbers in Admin, Analytics with what you expect.
6. **Switch.** Change `DATABASE_URL` in the DigitalOcean app settings to `aywo_restore` and deploy. Turn maintenance off.
7. **Afterwards.** Keep the old database for a week before deleting it. Write down what happened.

## 5. Tested

On 12 Nov 2026 (PR 16): a backup was restored into an empty database. Every one of 88 tables had the same row count as the live one, along with the same 71 security rules, 216 function permissions and 58 table permissions. The API was then run on the restored copy and an account signed in and opened its tree with all 5 people. A wrong key and a changed file are refused, and the script refuses to restore over the live database.

Not yet tested: the Docker image with `pg_dump` 17 (built on the first DigitalOcean deploy), and a restore into a DigitalOcean managed database. Do one practice restore (steps 3 to 5) soon after going live, and then every few months.

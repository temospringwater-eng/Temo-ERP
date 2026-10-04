# TEMO ERP HTTPS Staging Deployment

Branch: `integration/water-club-api`

This is the existing TEMO ERP prepared for a staging deployment. It is **not** a second ERP/backend.

## Required runtime

- Node.js 20+
- HTTPS public URL supplied by the hosting platform
- Persistent volume mounted at `/data`
- `DB_PATH=/data/hayrila.db`
- `STORAGE_ROOT=/data/storage` (defaults to storage beside DB_PATH)
- Set `BOOTSTRAP_SUPERADMIN_PASSWORD` to a unique secret of at least 12 characters only for initial provisioning. Optional `BOOTSTRAP_ADMIN_PASSWORD` uses the same rule. Never commit these values. Bootstrap inserts missing accounts only and requires first-login password change. Existing accounts are not rotated automatically.
- For recovery: configure SMTP_HOST, SMTP_PORT, SMTP_FROM and provider credentials using host secrets, and `PASSWORD_RESET_URL=https://<erp-host>/`. Until SMTP and the HTTPS page are configured, recovery returns a generic response and creates no token.
- `PORT` supplied by the host (defaults to 3000)

## Source required before deployment

The branch must contain the current runtime source:
- `server.js`
- `services/`
- `public/`
- `package.json`
- `package-lock.json`

Do not deploy local `.env`, `node_modules`, production/debug SQLite databases, payment-proof uploads, logs or backups.

## Staging database

Use a fresh staging SQLite database on the persistent volume. Do not upload the production/local database merely to make staging work.

After startup, create/provision one staging company/customer portal account for Step 4B integration tests only.

## Health check

Use:

`GET /api/health`

Expected success:

```json
{"ok":true,"service":"temo-aquaflow","database":"reachable"}
```

## Water Club connection

After the staging URL is available, set the website Worker environment variable:

`ERP_API_BASE_URL=https://<staging-erp-host>`

Then run login, logout, session-expiry and tenant-isolation tests.

## Go-live rule

This staging configuration does not authorize production deployment or merge to `main`. Final owner approval is required.

## Persistent files and existing installations

Payment proofs are under STORAGE_ROOT/subscription-payment-proofs; local backup exports are under STORAGE_ROOT/backups. If moving an existing installation, copy its old storage/subscription-payment-proofs and backups into these directories while the app is stopped. A fresh staging database requires no migration. Do not copy business files into fresh staging.

## Restore drill after hosting

Stop the staging service before replacement. Retain a copy of its current database. Restore a trusted complete SQLite backup to a temporary database; run PRAGMA integrity_check and verify companies, customers, orders, and totals. Replace the staging DB only after that check, retaining accompanying WAL files when appropriate. Restart and verify login, customer isolation, and records. Test restart/redeploy with payment proof uploads as well. JSON backup exports redact credentials and exclude global tables for tenant scope; they are audit/data exports, not complete database restore images. Off-site backup is still unconfigured. No automatic destructive restore is enabled.

## Launch preparation checklist

- Owner confirms product names, current prices, bottle deposit/refill rules and initial stock. Seed examples are not approved live inventory.
- Owner confirms delivery areas, fees, days/cutoff, returns and payment instructions.
- Provision named admin and customer accounts; change temporary passwords. Rotate any old default credentials in existing databases.
- Customer instructions: sign in at /customer.html; place orders, check invoices/payment and bottle balance, update profile, and submit support requests. ERP administrators sign in at /.
- Configure HTTPS host, Worker ERP_API_BASE_URL and secrets after billing. Verify real website-to-ERP order flow, login/logout, expired session, cross-company rejection, real email delivery and database/upload persistence.
- Obtain final owner approval before production go-live.
